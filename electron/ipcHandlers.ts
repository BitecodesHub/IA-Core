// ipcHandlers.ts

import { ipcMain, app, clipboard } from "electron"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { AppState } from "./main"
import { SettingsService, DeepPartial } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import type { AppSettings } from "./config/schema"
import type { ShortcutActionId, Binding } from "./config/schema"
import { openPrivacySettings } from "./permissions"
import { BitecodesAuth, BITECODES_PROVIDER_ID } from "./bitecodesAuth"
import { UpdateChecker } from "./updateCheck"

// Stealth: screenshot paths embed the OS username (via userData) and activity
// timing is a forensic signal. Keep such logs out of production stdout/stderr.
const isDev = process.env.NODE_ENV === "development"

/**
 * Normalise a resolved path for containment comparison.
 *
 * Windows paths are case-insensitive, so a plain case-sensitive `startsWith`
 * rejects legitimate paths whose drive letter or directory casing differs from
 * `app.getPath("userData")` (e.g. "C:\\Users\\..." vs "c:\\users\\..."). Casing is
 * folded on win32 only — POSIX filesystems are genuinely case-sensitive and
 * folding there would loosen the check.
 */
function comparablePath(p: string): string {
  const resolved = path.resolve(p) + path.sep
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isWithin(candidate: string, roots: string[]): boolean {
  const target = comparablePath(candidate)
  return roots.some((root) => target.startsWith(comparablePath(root)))
}

/**
 * Resolve and confirm a renderer-supplied path lives inside one of the app's
 * screenshot directories. Prevents path-traversal (e.g. "../../etc/passwd")
 * through the screenshot/image IPC channels.
 */
function assertWithinScreenshotDirs(p: string): string {
  const userData = app.getPath("userData")
  const allowedRoots = [
    path.join(userData, "screenshots"),
    path.join(userData, "extra_screenshots"),
  ]
  if (!isWithin(p, allowedRoots)) {
    throw new Error("Access denied: path is outside the allowed directories")
  }
  return path.resolve(p)
}

/**
 * Confirm a renderer-supplied audio path lives inside the app's audio temp dir or
 * userData. Prevents handing an arbitrary path (e.g. ~/.ssh/id_rsa) to ffmpeg via
 * the analyze-audio-file channel.
 */
function assertWithinAudioDirs(p: string): string {
  const allowedRoots = [path.join(os.tmpdir(), "ia-core-audio"), app.getPath("userData")]
  if (!isWithin(p, allowedRoots)) {
    throw new Error("Access denied: audio path is outside the allowed directories")
  }
  return path.resolve(p)
}

export function initializeIpcHandlers(appState: AppState): void {
  const settings = SettingsService.getInstance()
  const secrets = SecretStore.getInstance()
  ipcMain.handle("update-content-dimensions", async (_event, payload: unknown) => {
    // Validate: a malformed payload must not reach setWindowDimensions.
    if (typeof payload !== "object" || payload === null) return
    const { width, height, center } = payload as { width?: unknown; height?: unknown; center?: unknown }
    if (
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      appState.setWindowDimensions(width, height, center === true)
    }
  })

  // Click-through toggle: renderer enables capture only while the cursor is over
  // interactive UI; otherwise clicks pass through the transparent overlay.
  ipcMain.on("set-ignore-mouse-events", (_e, ignore: boolean) => {
    appState.setIgnoreMouseEvents(ignore)
  })

  ipcMain.handle("delete-screenshot", async (event, filePath: string) => {
    try {
      const safe = assertWithinScreenshotDirs(filePath)
      return appState.deleteScreenshot(safe)
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error: any) {
      console.error("Error taking screenshot:", error)
      const win = appState.getMainWindow()
      win?.webContents.send("screenshot-error", {
        message: error?.message ?? String(error),
        code: error?.code,
        // Whether an OS privacy pane exists for this failure. False on Windows,
        // which has no screen-capture permission at all.
        actionable: error?.actionable === true,
      })
      throw error
    }
  })

  // Screen-capture + microphone availability.
  //
  // On macOS this reflects the real TCC permission. On Windows there is NO
  // screen-capture permission, so "granted" would be a guess: instead the
  // startup check probes the capture pipeline, and this returns that result.
  ipcMain.handle("get-screen-permission", async () => {
    const cached = appState.getPermissionReport()
    if (cached) return cached.screenCapture
    const report = await appState.refreshPermissions()
    return report.screenCapture
  })

  /** Full report (both capabilities + whether a settings pane exists). */
  ipcMain.handle("get-permissions", async () => {
    return appState.getPermissionReport() ?? appState.refreshPermissions()
  })

  ipcMain.handle("refresh-permissions", async () => appState.refreshPermissions())

  // Deep-link to the OS privacy pane, where one exists. Returns ok:false on
  // Windows for "screen" because Windows has no such setting — the renderer
  // must not claim otherwise.
  ipcMain.handle("open-privacy-settings", async (_event, kind: unknown) => {
    const target = kind === "microphone" ? "microphone" : "screen"
    return openPrivacySettings(target)
  })

  // Retained channel name for the existing renderer call site.
  ipcMain.handle("open-screen-recording-settings", async () => openPrivacySettings("screen"))

  // Silent clipboard write — used to auto-copy generated code from a completed
  // response. No UI, no focus change; runs entirely in the main process.
  ipcMain.handle("clipboard:write", async (_event, text: unknown) => {
    try {
      clipboard.writeText(typeof text === "string" ? text : String(text ?? ""))
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message }
    }
  })

  // Blink positional dots on a stealth full-screen overlay to convey a detected
  // multiple-choice answer (A=top-left … E=centre). Renderer-supplied letters are
  // sanitised to the A–E set here before reaching the overlay.
  ipcMain.on("mcq:hint", (_event, letters: unknown) => {
    if (!Array.isArray(letters)) return
    const valid = letters.filter(
      (l): l is "A" | "B" | "C" | "D" | "E" =>
        typeof l === "string" && ["A", "B", "C", "D", "E"].includes(l)
    )
    if (valid.length > 0) appState.showMcqHint(valid)
  })

  ipcMain.handle("get-screenshots", async () => {
    if (isDev) console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          }))
        )
      }
      if (isDev) previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      if (isDev) console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // IPC handler for analyzing audio from base64 data
  ipcMain.handle("analyze-audio-base64", async (event, data: unknown, mimeType: unknown) => {
    try {
      if (typeof data !== "string" || typeof mimeType !== "string") {
        throw new Error("Invalid audio payload.")
      }
      const result = await appState.processingHelper.processAudioBase64(data, mimeType)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-base64 handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing audio from file path
  ipcMain.handle("analyze-audio-file", async (event, filePath: string) => {
    try {
      const safe = assertWithinAudioDirs(filePath)
      const result = await appState.processingHelper.processAudioFile(safe)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-file handler:", error)
      throw error
    }
  })

  // IPC handler for getting image as base64
  ipcMain.handle("get-image-base64", async (event, filePath: string) => {
    try {
      const safe = assertWithinScreenshotDirs(filePath)
      const imageData = await fs.promises.readFile(safe)
      return imageData.toString("base64")
    } catch (error: any) {
      console.error("Error in get-image-base64 handler:", error)
      throw error
    }
  })

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama(),
      }
    } catch (error: any) {
      console.error("Error getting current LLM config:", error)
      throw error
    }
  })

  ipcMain.handle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      const models = await llmHelper.getOllamaModels()
      return models
    } catch (error: any) {
      console.error("Error getting Ollama models:", error)
      throw error
    }
  })

  // Models with capability flags (vision) for the Settings UI.
  ipcMain.handle("get-ollama-models-detailed", async () => {
    try {
      return await appState.processingHelper.getLLMHelper().getOllamaModelsDetailed()
    } catch (error: any) {
      console.error("Error getting detailed Ollama models:", error)
      return []
    }
  })

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      await llmHelper.switchToOllama(model, url)
      return { success: true }
    } catch (error: any) {
      console.error("Error switching to Ollama:", error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("test-llm-connection", async (_e, providerId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper()
      const result = await llmHelper.testConnection(providerId)
      return result
    } catch (error: any) {
      console.error("Error testing LLM connection:", error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("get-ai-provider-models", async (_e, providerId?: string) => {
    // Returns a typed ModelDiscoveryResult so the renderer can distinguish a real
    // discovery error from a reachable-but-empty catalog.
    const id = typeof providerId === "string" ? providerId : undefined
    return appState.processingHelper.getLLMHelper().discoverModelsResult(id)
  })

  ipcMain.handle("get-ai-provider-health", async (_e, providerId?: string) => {
    return appState.processingHelper.getLLMHelper().getProviderHealth(providerId)
  })

  ipcMain.handle("get-ai-providers-health", async () => {
    return appState.processingHelper.getLLMHelper().getProvidersHealth()
  })

  ipcMain.handle("ai-provider:set-api-key", async (_e, providerId: unknown, apiKey: unknown) => {
    // Coerce defensively: a non-string apiKey would otherwise throw on .trim()
    // inside SecretStore and reject the IPC.
    if (typeof providerId !== "string") return { ok: false, error: "Invalid provider id." }
    // The Bitecodes token is only ever written by the sign-in flow in the main
    // process. Letting the renderer store one would let it fake a sign-in.
    if (providerId === BITECODES_PROVIDER_ID) {
      return { ok: false, error: "Use “Sign in with Bitecodes” instead." }
    }
    return secrets.setProviderApiKey(providerId, String(apiKey ?? ""))
  })

  ipcMain.handle("ai-provider:secret-status", async (_e, providerId: string) => {
    return {
      providerId,
      hasApiKey: secrets.hasProviderApiKey(providerId),
      secureStorageAvailable: secrets.isEncryptionAvailable(),
    }
  })

  // Key presence for every configured provider in one round trip. The provider
  // picker needs this to mark providers as ready or "no key"; asking per
  // provider would mean one IPC call per row on every render.
  // Only booleans cross the boundary — never the keys themselves.
  // "Sign in with Bitecodes". The renderer only ever sees the sign-in state and
  // the short confirmation code — never the device token.
  const bitecodes = BitecodesAuth.getInstance()
  bitecodes.onChange((state) => {
    // The token changed (signed in/out): drop cached discovery/health for it.
    appState.processingHelper.getLLMHelper().invalidateProviderCache("bitecodes")
    const win = appState.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send("bitecodes:changed", state)
  })
  ipcMain.handle("bitecodes:status", async () => bitecodes.status())
  ipcMain.handle("bitecodes:login", async () => bitecodes.login())
  ipcMain.handle("bitecodes:cancel", async () => bitecodes.cancel())
  ipcMain.handle("bitecodes:reopen", async () => bitecodes.reopenBrowser())
  ipcMain.handle("bitecodes:privacy", async () => bitecodes.openPrivacyPolicy())

  // Update feed: state to the renderer (never the raw URL), download via main.
  const updates = UpdateChecker.getInstance()
  updates.onChange((state) => {
    const win = appState.getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send("update:changed", state)
  })
  ipcMain.handle("update:status", async () => updates.get())
  ipcMain.handle("update:check", async () => updates.check())
  ipcMain.handle("update:download", async () => updates.download())
  updates.start()
  ipcMain.handle("bitecodes:logout", async () => bitecodes.logout())

  ipcMain.handle("ai-provider:secret-status-all", async () => {
    const secureStorageAvailable = secrets.isEncryptionAvailable()
    const providers = settings.get("ai").providers
    return Object.keys(providers).map((providerId) => ({
      providerId,
      hasApiKey: secrets.hasProviderApiKey(providerId),
      secureStorageAvailable,
    }))
  })

  // IPC handler for screenshot analysis with user choice
  ipcMain.handle(
    "process-screenshot-with-choice",
    async (event, analysisType: "analyze" | "answer") => {
      try {
        await appState.processingHelper.processScreenshotWithChoice(analysisType)
        return { success: true }
      } catch (error: any) {
        console.error("Error in process-screenshot-with-choice handler:", error)
        return { success: false, error: error.message }
      }
    }
  )

  // IPC handler to cancel screenshot processing
  ipcMain.handle("cancel-screenshot-processing", async () => {
    try {
      appState.processingHelper.cancelOngoingRequests()
      return { success: true }
    } catch (error: any) {
      console.error("Error in cancel-screenshot-processing handler:", error)
      return { success: false, error: error.message }
    }
  })

  // --- Settings -----------------------------------------------------------
  ipcMain.handle("settings:getAll", async () => settings.getAll())

  ipcMain.handle("settings:set", async (_e, patch: DeepPartial<AppSettings>) => {
    return settings.set(patch)
  })

  ipcMain.handle("settings:reset", async (_e, section?: keyof AppSettings) => {
    return settings.reset(section)
  })

  // Import/export are object-based only (settings:export / settings:import).
  // The former native-dialog variants (showSaveDialog/showOpenDialog) were removed:
  // OS file pickers are separate windows NOT covered by content protection and
  // would appear in a screen share. The renderer now does an in-overlay copy/paste
  // flow (see useImportExport), which stays inside the content-protected window.
  ipcMain.handle("settings:export", async () => settings.exportSettings())

  ipcMain.handle("settings:import", async (_e, data: unknown) => settings.importSettings(data))

  // --- Shortcuts ----------------------------------------------------------
  ipcMain.handle("shortcuts:getAll", async () => appState.shortcutsHelper.getSnapshot())

  ipcMain.handle("shortcuts:validate", async (_e, accel: string, excludeId?: ShortcutActionId) => {
    return appState.shortcutsHelper.validate(accel, excludeId)
  })

  ipcMain.handle("shortcuts:set", async (_e, id: ShortcutActionId, accel: Binding) => {
    return appState.shortcutsHelper.setShortcut(id, accel)
  })

  ipcMain.handle("shortcuts:resetOne", async (_e, id: ShortcutActionId) => {
    return appState.shortcutsHelper.resetOne(id)
  })

  ipcMain.handle("shortcuts:resetAll", async () => appState.shortcutsHelper.resetAll())

  ipcMain.handle("shortcuts:setMoveStep", async (_e, px: number) => {
    return appState.shortcutsHelper.setMoveStep(px)
  })

  ipcMain.handle("shortcuts:export", async () => appState.shortcutsHelper.exportShortcuts())

  ipcMain.handle("shortcuts:import", async (_e, data: unknown) => {
    return appState.shortcutsHelper.importShortcuts(data)
  })
  // Native-dialog shortcuts import/export removed for the same stealth reason as
  // settings above; the renderer uses the in-overlay copy/paste flow.

  // --- Streaming chat: renderer never talks to Ollama directly; tokens are
  // streamed back over per-request channels so the renderer needs no network. ---
  const chatControllers = new Map<number, AbortController>()
  ipcMain.on("llm:chatStream", (event, payload: { id: number; message: string }) => {
    const { id, message } = payload
    const controller = new AbortController()
    chatControllers.set(id, controller)
    const llm = appState.processingHelper.getLLMHelper()
    llm
      .chatStream(message, (t) => event.sender.send(`llm:token:${id}`, t), controller.signal)
      .then((full) => event.sender.send(`llm:done:${id}`, full))
      .catch((err: any) => event.sender.send(`llm:error:${id}`, err?.message ?? String(err)))
      .finally(() => chatControllers.delete(id))
  })
  ipcMain.on("llm:chatCancel", (_e, id: number) => {
    chatControllers.get(id)?.abort()
    chatControllers.delete(id)
  })
}
