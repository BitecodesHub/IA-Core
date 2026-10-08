import { app, BrowserWindow, Tray, Menu, nativeImage, protocol } from "electron"
import path from "node:path"
import fs from "node:fs"
import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts/ShortcutsHelper"
import { ProcessingHelper } from "./ProcessingHelper"
import { HintOverlayHelper, type HintLetter } from "./HintOverlayHelper"
import { SettingsService } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import { shouldSeedProviderKey } from "./config/seed"
import { PROCESSING_EVENTS } from "./events"
import {
  installPermissionHandlers,
  readPermissions,
  requestStartupPermissions,
  type PermissionReport,
} from "./permissions"

// The app:// scheme must be registered as standard + secure BEFORE app ready so
// the production renderer loads from a real origin (see the protocol.handle in
// whenReady). standard gives it a normal origin; secure lets it run like https.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

// Stealth: keep usage/activity logs out of production stdout.
const isDev = process.env.NODE_ENV === "development"

// Stealth: an unhandled error in the main process would otherwise trigger
// Electron's native "A JavaScript error occurred in the main process" dialog,
// which is NOT content-protected and would appear in a screen share. Swallow it
// (log only in development) so nothing ever pops outside the overlay.
process.on("uncaughtException", (err) => {
  if (isDev) console.error("[uncaughtException]", err)
})
process.on("unhandledRejection", (reason) => {
  if (isDev) console.error("[unhandledRejection]", reason)
})

/**
 * Tray icon bitmap. Empty on macOS (a deliberately blank menu-bar slot, still
 * clickable); the bundled icon on Windows/Linux, where an empty image produces
 * an invisible — and therefore unusable — tray entry.
 */
function resolveTrayImage(): Electron.NativeImage {
  if (process.platform === "darwin") return nativeImage.createEmpty()

  const file = process.platform === "win32" ? "icons/win/icon.ico" : "icons/png/256x256.png"
  const candidates = [
    // Packaged: assets/ is copied via extraResources.
    process.resourcesPath ? path.join(process.resourcesPath, "assets", file) : "",
    // Dev: __dirname is dist-electron/.
    path.join(__dirname, "..", "assets", file),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image
    } catch {
      /* try the next candidate */
    }
  }
  // Last resort: an empty image. The tray entry will be invisible on
  // Windows/Linux, but Tray construction still succeeds rather than throwing on
  // a missing icon file and taking the whole tray feature down.
  return nativeImage.createEmpty()
}

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper
  private hintOverlay: HintOverlayHelper
  private tray: Tray | null = null

  // View management
  private view: "queue" | "solutions" = "queue"

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false

  /** Result of the startup permission/capability check; surfaced over IPC. */
  private permissionReport: PermissionReport | null = null

  // Processing events (single source of truth in ./events.ts).
  public readonly PROCESSING_EVENTS = PROCESSING_EVENTS

  constructor() {
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper(this.view)

    // Initialize ProcessingHelper
    this.processingHelper = new ProcessingHelper(this)

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)

    // MCQ answer hint overlay. Positions onto whichever display currently holds
    // the main overlay window; falls back to the primary display.
    this.hintOverlay = new HintOverlayHelper(() => this.getMainWindow()?.getBounds() ?? null)
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    // Stealth: queue counts reveal usage/timing — dev only.
    if (isDev) {
      console.log(
        "Screenshots: ",
        this.screenshotHelper.getScreenshotQueue().length,
        "Extra screenshots: ",
        this.screenshotHelper.getExtraScreenshotQueue().length
      )
    }
    this.windowHelper.toggleMainWindow()
  }

  public setWindowDimensions(width: number, height: number, center = false): void {
    this.windowHelper.setWindowDimensions(width, height, center)
  }

  public setIgnoreMouseEvents(ignore: boolean): void {
    this.windowHelper.setIgnoreMouseEvents(ignore)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  // Screenshot management methods
  public async takeScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    // The overlay is hidden during capture so it never appears in the shot. Only
    // restore it afterward if it was visible BEFORE — taking a screenshot must not
    // reveal a hidden overlay. The window is opened solely via the toggle (B).
    const wasVisible = this.isVisible()
    this.hintOverlay.destroy()
    const screenshotPath = await this.screenshotHelper.takeScreenshot(
      () => this.hideMainWindow(),
      () => {
        if (wasVisible) this.showMainWindow()
      }
    )

    return screenshotPath
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(path: string): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public setMoveStep(px: number): void {
    this.windowHelper.setMoveStep(px)
  }

  public applyWindowSettings(): void {
    this.windowHelper.applyWindowSettings()
  }

  public createTray(): void {
    // Tray visibility is a stealth setting; when disabled, no menu-bar/system-tray
    // footprint is created and the reveal shortcut is the only entry point.
    if (!SettingsService.getInstance().get("window").trayEnabled) {
      this.destroyTray()
      return
    }
    if (this.tray) return

    // macOS renders an empty template image as a blank (stealthy) menu-bar slot
    // that is still clickable. Windows and Linux do NOT: an empty image yields
    // an invisible tray entry the user cannot find or click, which would make an
    // explicitly-enabled tray useless. Load the real icon there.
    this.tray = new Tray(resolveTrayImage())

    const contextMenu = Menu.buildFromTemplate([
      { label: "Show", click: () => this.centerAndShowWindow() },
      { label: "Toggle Window", click: () => this.toggleMainWindow() },
      { type: "separator" },
      {
        label: "Take Screenshot",
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview,
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        },
      },
      { type: "separator" },
      { label: "Quit", accelerator: "CommandOrControl+Q", click: () => app.quit() },
    ])

    this.tray.setToolTip("Notes")
    this.tray.setContextMenu(contextMenu)
    this.tray.on("double-click", () => this.centerAndShowWindow())
  }

  public destroyTray(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  /** Blink positional dots for a detected multiple-choice answer. */
  public showMcqHint(letters: HintLetter[]): void {
    this.hintOverlay.blink(letters)
  }

  public destroyHintOverlay(): void {
    this.hintOverlay.destroy()
  }

  public getPermissionReport(): PermissionReport | null {
    return this.permissionReport
  }

  private publishPermissionReport(report: PermissionReport): PermissionReport {
    this.permissionReport = report
    if (isDev) console.log("[permissions]", report)
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send("permissions:changed", report)
    }
    return report
  }

  /**
   * Re-read permission/capability state. Never prompts, so it is safe from any
   * query path — a screen-capture status check must not pop a microphone
   * dialog.
   */
  public async refreshPermissions(): Promise<PermissionReport> {
    return this.publishPermissionReport(
      await readPermissions(() => this.screenshotHelper.probe())
    )
  }

  /**
   * Startup pass: prompt for the one permission that CAN be requested (the
   * macOS microphone grant) and probe the rest. Screen capture is never
   * "requested" — macOS cannot be prompted programmatically and Windows has no
   * such permission. See electron/permissions.ts.
   */
  public async requestPermissionsOnce(): Promise<PermissionReport> {
    return this.publishPermissionReport(
      await requestStartupPermissions(() => this.screenshotHelper.probe())
    )
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }
}

// Application initialization
async function initializeApp() {
  // Single-instance: a second launch focuses the existing overlay instead of
  // spawning a duplicate that would fight over global shortcuts.
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  const appState = AppState.getInstance()

  app.on("second-instance", () => {
    appState.centerAndShowWindow()
  })

  // Load persisted settings before anything reads them.
  const settings = SettingsService.getInstance()
  settings.load()

  // Apply live settings changes without a restart, and mirror them to the renderer.
  settings.onChange((next, _prev, changedPaths) => {
    if (changedPaths.some((p) => p.startsWith("window."))) {
      appState.applyWindowSettings()
    }
    if (changedPaths.includes("window.trayEnabled")) {
      appState.createTray()
    }
    // Only re-discover when something that affects the model catalog or which
    // provider is used changes — not on a temperature/model-slot tweak, which
    // would needlessly re-hit the network on every keystroke-commit.
    if (
      changedPaths.some(
        (p) =>
          p === "ai.activeProviderId" ||
          p.startsWith("ai.fallbackProviderIds") ||
          /^ai\.providers\.[^.]+\.(endpoint|enabled|type|allowRemote)$/.test(p)
      )
    ) {
      appState.processingHelper.getLLMHelper().invalidateProviderCache()
    }
    // Re-register global shortcuts when BINDINGS change via a settings import/reset
    // (those paths don't go through ShortcutsHelper's own register calls). Scoped to
    // shortcuts.bindings so a move-step change doesn't needlessly re-register every
    // accelerator; move-step is applied directly instead.
    if (changedPaths.some((p) => p.startsWith("shortcuts.bindings"))) {
      appState.shortcutsHelper.applyAll()
    } else if (changedPaths.includes("shortcuts.moveStep")) {
      appState.setMoveStep(next.shortcuts.moveStep)
    }
    const win = appState.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send("settings:changed", next)
    }
  })

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

    // Stealth: replace the default application menu with a minimal one. This drops
    // the View menu (Reload / Toggle-DevTools accelerators) and other footprint,
    // but KEEPS the Edit menu — its cut/copy/paste/selectAll roles are what wire
    // the standard Cmd+C/V/X/A accelerators for native text fields on macOS (the
    // API-key field and the in-overlay import textarea rely on paste). DevTools is
    // independently disabled via webPreferences.devTools in production.
    app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }])
    )

    // Serve the renderer over a real app:// origin in production. Loading the
    // bundle from file:// breaks a strict CSP ('self' never matches the opaque
    // file:// origin → scripts blocked → blank window) and trips CORS on Vite's
    // crossorigin module scripts. A custom standard/secure scheme gives a proper
    // same origin where 'self' is valid and module loading just works.
    const distDir = path.join(__dirname, "../dist")
    const MIME: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".ico": "image/x-icon",
      ".map": "application/json",
    }
    // Read via fs (which is asar-aware) rather than net.fetch(file://) (which is
    // NOT asar-aware) so the bundle loads both unpacked and inside app.asar.
    protocol.handle("app", async (request) => {
      let rel = decodeURIComponent(new URL(request.url).pathname)
      if (rel === "/" || rel === "") rel = "/index.html"
      const filePath = path.normalize(path.join(distDir, rel))
      const relativePath = path.relative(distDir, filePath)
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return new Response("Forbidden", { status: 403 })
      }
      try {
        const data = await fs.promises.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        return new Response(new Uint8Array(data), {
          headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
        })
      } catch {
        return new Response("Not found", { status: 404 })
      }
    })

    // One-time provisioning: if a provider key is supplied via the environment and
    // none is stored yet, persist it (encrypted, via SecretStore) so online mode
    // works out of the box. Keys are never written to settings or source.
    // NOTE: a Finder-launched packaged app does not inherit the shell environment,
    // so this path applies to terminal/dev launches (npm run app:dev); otherwise
    // set the key in the Models tab (which also uses SecretStore).
    const secrets = SecretStore.getInstance()
    // Each provider that supports env seeding: provider id -> env var name.
    // NVIDIA NIM (build.nvidia.com) issues a free-tier key, so `export
    // NVIDIA_API_KEY=nvapi-...` lets the app run free out of the box with no
    // click-through in Settings.
    const ENV_KEY_SEEDS: Record<string, string> = {
      openrouter: "OPENROUTER_API_KEY",
      nvidia: "NVIDIA_API_KEY",
      sharonai: "SHARONAI_API_KEY",
      vertex: "VERTEX_API_KEY",
      bedrock: "AWS_BEARER_TOKEN_BEDROCK",
    }
    for (const [providerId, envVar] of Object.entries(ENV_KEY_SEEDS)) {
      const envValue = process.env[envVar]
      if (
        shouldSeedProviderKey(
          secrets.hasProviderApiKey(providerId),
          envValue,
          secrets.isEncryptionAvailable()
        )
      ) {
        secrets.setProviderApiKey(providerId, (envValue as string).trim())
      }
    }

    // Allow-list the Chromium permissions the app actually needs (microphone,
    // screen capture) for the app's own origin only, and deny everything else.
    // Without an explicit handler the renderer's getUserMedia can be refused
    // with no diagnosable reason — the app:// origin is not a web origin
    // Chromium has any stored grant for.
    installPermissionHandlers(["app://bundle", "http://127.0.0.1:5180"])

    appState.createWindow()
    appState.createTray()
    appState.shortcutsHelper.applyAll()

    // Resolve every permission/capability once, up front: prompt for what can
    // be prompted for (macOS microphone) and probe what cannot (screen capture
    // on Windows/Linux, where no such permission exists). Failing this must not
    // block startup — the overlay stays usable for text-only chat.
    appState.requestPermissionsOnce().catch((err) => {
      if (isDev) console.error("[permissions] startup check failed:", err)
    })
  })

  app.on("activate", () => {
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Graceful shutdown: persist any pending settings write durably.
  app.on("before-quit", () => {
    settings.flushSync()
    appState.destroyHintOverlay()
  })

  // Stealth: mask application & process identity in OS process listing tools
  app.name = "Notes"
  process.title = "Notes"

  app.dock?.hide() // Accessory app: no dock icon
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory")
  }
  app.commandLine.appendSwitch("disable-background-timer-throttling")
  app.commandLine.appendSwitch("disable-renderer-backgrounding")
}

// Start the application
initializeApp().catch(console.error)
