// ipcHandlers.ts

import { ipcMain, app, shell, systemPreferences, clipboard } from "electron"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { AppState } from "./main"
import { SettingsService, DeepPartial } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import type { AppSettings } from "./config/schema"
import type { ShortcutActionId, Binding } from "./config/schema"

// Stealth: screenshot paths embed the OS username (via userData) and activity
// timing is a forensic signal. Keep such logs out of production stdout/stderr.
const isDev = process.env.NODE_ENV === "development"

/**
 * Resolve and confirm a renderer-supplied path lives inside one of the app's
 * screenshot directories. Prevents path-traversal (e.g. "../../etc/passwd")
 * through the screenshot/image IPC channels.
 */
function assertWithinScreenshotDirs(p: string): string {
  const resolved = path.resolve(p)
  const userData = app.getPath("userData")
  const allowedRoots = [
    path.join(userData, "screenshots"),
    path.join(userData, "extra_screenshots"),
  ].map((r) => path.resolve(r) + path.sep)
  const ok = allowedRoots.some((root) => (resolved + path.sep).startsWith(root))
  if (!ok) {
    throw new Error("Access denied: path is outside the allowed directories")
  }
  return resolved
}

/**
 * Confirm a renderer-supplied audio path lives inside the app's audio temp dir or
 * userData. Prevents handing an arbitrary path (e.g. ~/.ssh/id_rsa) to ffmpeg via
 * the analyze-audio-file channel.
 */
function assertWithinAudioDirs(p: string): string {
  const resolved = path.resolve(p)
  const allowedRoots = [path.join(os.tmpdir(), "ia-core-audio"), app.getPath("userData")].map(
    (r) => path.resolve(r) + path.sep
  )
  const ok = allowedRoots.some((root) => (resolved + path.sep).startsWith(root))
  if (!ok) {
    throw new Error("Access denied: audio path is outside the allowed directories")
  }
  return resolved
}

export function initializeIpcHandlers(appState: AppState): void {
  const settings = SettingsService.getInstance()
  const secrets = SecretStore.getInstance()
  ipcMain.handle("update-content-dimensions", async (_event, payload: unknown) => {
    // Validate: a malformed payload must not reach setWindowDimensions.
    if (typeof payload !== "object" || payload === null) return
    const { width, height } = payload as { width?: unknown; height?: unknown }
    if (
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      appState.setWindowDimensions(width, height)
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
      })
      throw error
    }
  })

  // Screen Recording permission status + helper to open the right settings pane.
  ipcMain.handle("get-screen-permission", async () => {
    if (process.platform !== "darwin") return "granted"
    try {
      return systemPreferences.getMediaAccessStatus("screen")
    } catch {
      return "unknown"
    }
  })

  ipcMain.handle("open-screen-recording-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      )
    }
    return { ok: true }
  })

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
    return secrets.setProviderApiKey(providerId, String(apiKey ?? ""))
  })

  ipcMain.handle("ai-provider:secret-status", async (_e, providerId: string) => {
    return {
      providerId,
      hasApiKey: secrets.hasProviderApiKey(providerId),
      secureStorageAvailable: secrets.isEncryptionAvailable(),
    }
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
