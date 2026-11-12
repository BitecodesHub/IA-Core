import { app, BrowserWindow, screen } from "electron"
import type { AppState } from "./main"
import path from "node:path"
import fs from "node:fs"
import { SettingsService } from "./config/SettingsService"

const isDev = process.env.NODE_ENV === "development"

// Dev uses the pinned IPv4 loopback (never "localhost"): Vite binds
// 127.0.0.1:5180 (vite.config.ts) and Windows can resolve "localhost" to ::1,
// which would refuse the connection even while the dev server is running.
const startUrl = isDev ? "http://127.0.0.1:5180" : "app://bundle/index.html"

/**
 * Reduce a URL to a comparable `scheme://host[:port]` string. Used instead of
 * `URL.prototype.origin`, which yields "null" for the app:// scheme because
 * app: is not a WHATWG "special" scheme.
 */
function normalizeOrigin(input: string): string {
  try {
    const url = new URL(input)
    return `${url.protocol}//${url.host || url.hostname}`.toLowerCase()
  } catch {
    return ""
  }
}

export class WindowHelper {
  private mainWindow: BrowserWindow | null = null
  private isWindowVisible: boolean = false
  private windowPosition: { x: number; y: number } | null = null
  /** Set when the user drags the window (not our own setBounds). */
  private gateMovedByUser = false
  /** Whether the last sizing call was for a centred gate (sign-in / update). */
  private gateShowing = false
  private windowSize: { width: number; height: number } | null = null
  private appState: AppState

  private step: number = 50 // pixels per move action; overridden from settings
  private settings = SettingsService.getInstance()

  constructor(appState: AppState) {
    this.appState = appState
  }

  /** Pixels moved per window-move action. Driven by settings. */
  public setMoveStep(px: number): void {
    if (Number.isFinite(px) && px > 0) {
      this.step = Math.round(px)
    }
  }

  /**
   * Toggle whether the overlay captures mouse events. When `ignore` is true the
   * window is transparent to clicks (they reach the app behind); `forward: true`
   * keeps mousemove flowing so the renderer can detect when to re-enable capture.
   */
  public setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.setIgnoreMouseEvents(ignore, { forward: true })
  }

  /**
   * Fits the window to its content. `center` places it in the middle of the
   * screen it is on (used by the sign-in gate, which is a modal-style card);
   * otherwise the top-left corner stays put so the overlay does not jump while
   * the user works.
   */
  public setWindowDimensions(width: number, height: number, center = false): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    // A newly appearing gate centres once; later user placement is preserved.
    if (center && !this.gateShowing) this.gateMovedByUser = false
    this.gateShowing = center
    const current = this.mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const maxWidth = center ? area.width : Math.floor(
      area.width * (this.appState.getHasDebugged() ? 0.75 : 0.5)
    )
    const w = Math.min(Math.max(300, Math.ceil(width + (center ? 0 : 32))), maxWidth)
    const h = Math.min(Math.max(200, Math.ceil(height)), area.height)
    this.applyBounds(this.clampToVisibleArea({
      x: center && !this.gateMovedByUser ? area.x + Math.floor((area.width - w) / 2) : current.x,
      y: center && !this.gateMovedByUser ? area.y + Math.floor((area.height - h) / 2) : current.y,
      width: w,
      height: h,
    }, area))
  }

  public createWindow(): void {
    if (this.mainWindow !== null) return

    const winCfg = this.settings.get("window")
    this.step = this.settings.get("shortcuts").moveStep

    const windowSettings: Electron.BrowserWindowConstructorOptions = {
      title: "Notes",
      width: winCfg.size.width,
      height: winCfg.size.height,
      minWidth: 300,
      minHeight: 200,
      webPreferences: {
        // Hardened: the renderer needs no Node access; all privileged work goes
        // through the allow-listed preload bridge.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Stealth: DevTools is a separate, NON-content-protected window that would
        // expose the whole renderer in a screen capture. Disable it in production.
        devTools: isDev,
        preload: path.join(__dirname, "preload.js"),
      },
      show: false, // Start hidden, then show after setup
      alwaysOnTop: winCfg.alwaysOnTop,
      frame: false,
      transparent: true,
      thickFrame: false,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      focusable: true,
      resizable: true,
      movable: true,
      skipTaskbar: winCfg.skipTaskbar,
      x: winCfg.position?.x ?? 100,
      y: winCfg.position?.y ?? 100,
    }

    this.mainWindow = new BrowserWindow(windowSettings)
    this.mainWindow.setContentProtection(winCfg.contentProtection)
    this.mainWindow.setOpacity(winCfg.opacity)
    // Block navigation away from the app origin and any new-window/popup
    // requests. Pin to the known app origin (app://bundle in prod, the pinned
    // 127.0.0.1 dev server in dev) and deny everything else, including
    // redirects and unparsable URLs.
    // `URL.prototype.origin` is the string "null" for a non-special scheme such
    // as app:, so comparing origins that way would reject every in-app
    // navigation in a packaged build. Compare scheme + host explicitly.
    const allowedOrigins = new Set(
      [startUrl, "app://bundle/index.html"].map(normalizeOrigin).filter(Boolean)
    )
    const denyForeign = (e: Electron.Event, url: string) => {
      const origin = normalizeOrigin(url)
      if (origin === "" || !allowedOrigins.has(origin)) e.preventDefault()
    }
    this.mainWindow.webContents.on("will-navigate", denyForeign)
    this.mainWindow.webContents.on("will-redirect", denyForeign)
    this.mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))

    // Click-through: the overlay is a large transparent window, so by default it
    // would swallow every click inside its bounds — including the empty
    // transparent areas — blocking the apps behind it. Ignore mouse events by
    // default (passing clicks through) but `forward: true` still delivers
    // mousemove to the renderer, which re-enables capture only while the cursor
    // is over actual UI (see setIgnoreMouseEvents + the renderer's hover probe).
    this.mainWindow.setIgnoreMouseEvents(true, { forward: true })

    if (process.platform === "linux") {
      // Linux-specific optimizations for better compatibility
      if (this.mainWindow.setHasShadow) {
        this.mainWindow.setHasShadow(false)
      }
      // Keep window focusable on Linux for proper interaction
      this.mainWindow.setFocusable(true)
    }
    this.applyWindowSettings()

    let activeUrl = startUrl
    const loadAppUrl = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return
      this.mainWindow.loadURL(activeUrl).catch((err) => {
        if (isDev) console.error("Failed to load URL:", err)
      })
    }

    // A crashed renderer leaves a frozen, blank overlay with no way to recover
    // short of force-quitting. Reload it — at most 3 times a minute so a
    // deterministic crash cannot spin forever.
    const recentCrashes: number[] = []
    // "will-move" fires only for user-initiated moves (dragging), never for
    // our own setBounds, so it tells us the user placed the window themselves.
    this.mainWindow.on("will-move", () => {
      this.gateMovedByUser = true
    })

    this.mainWindow.webContents.on("render-process-gone", (_e, details) => {
      console.error("[WindowHelper] renderer gone:", details.reason, details.exitCode)
      if (details.reason === "clean-exit") return
      const now = Date.now()
      while (recentCrashes.length && now - recentCrashes[0] > 60_000) recentCrashes.shift()
      if (recentCrashes.length >= 3) return
      recentCrashes.push(now)
      setTimeout(loadAppUrl, 500)
    })

    // Surface renderer/preload load failures and a mounted-content check to the
    // main-process log — a blank window is almost always one of these, and the
    // root-content count catches a silently failed render (0 = blank).
    this.mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
      if (code === -102 && activeUrl !== "app://bundle/index.html") {
        const bundlePath = path.join(__dirname, "../dist/index.html")
        if (fs.existsSync(bundlePath)) {
          if (isDev) {
            console.log(
              `[WindowHelper] Dev server at ${url} not running. Falling back to local bundle app://bundle/index.html`
            )
          }
          activeUrl = "app://bundle/index.html"
          loadAppUrl()
          return
        }
      }
      if (isDev && code === -102) {
        console.warn(
          `[WindowHelper] Vite dev server not reachable at ${url} and no built bundle found. ` +
            `"npm run electron:dev" starts Vite and Electron together; ` +
            `if you launched Electron directly, run "npm run dev" in another terminal. Retrying in 2s...`
        )
        setTimeout(() => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            loadAppUrl()
          }
        }, 2000)
      } else if (isDev) {
        console.error("[did-fail-load]", code, desc, url)
      }
    })
    this.mainWindow.webContents.on("did-finish-load", () => {
      if (!isDev) return
      this.mainWindow?.webContents
        .executeJavaScript('document.getElementById("root")?.childElementCount ?? -1')
        .then((n) => console.log("[WindowHelper] renderer mounted, root children:", n))
        .catch(() => {})
    })

    loadAppUrl()

    // Show window after loading URL and center it
    this.mainWindow.once("ready-to-show", () => {
      if (this.mainWindow) {
        // Center the window first
        this.centerWindow()
        // Re-assert content protection before the first reveal (defense-in-depth;
        // creation-time protection is set at construction).
        this.mainWindow.setContentProtection(this.settings.get("window").contentProtection)
        if (!this.settings.get("general").startMinimized) {
          this.mainWindow.show()
          this.mainWindow.focus()
          this.mainWindow.setAlwaysOnTop(this.settings.get("window").alwaysOnTop)
          this.isWindowVisible = true
          if (isDev) console.log("Window is now visible and centered")
        } else {
          this.isWindowVisible = false
          if (isDev) console.log("Window loaded and kept hidden by startMinimized")
        }
      }
    })

    const bounds = this.mainWindow.getBounds()
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }

    this.setupWindowListeners()
    this.isWindowVisible = !this.settings.get("general").startMinimized
  }

  private setupWindowListeners(): void {
    if (!this.mainWindow) return

    // Electron emits move/resize many times per second during a drag. Update the
    // in-memory bounds immediately (cheap) but debounce the settings.set — which
    // runs merge/coerce/diff/emit and native re-apply — so a drag persists once,
    // on a trailing timer, instead of on every pixel.
    let persistTimer: NodeJS.Timeout | null = null
    const schedulePersist = () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        if (!this.windowPosition || !this.windowSize) return
        this.settings.set({
          window: {
            position: { x: this.windowPosition.x, y: this.windowPosition.y },
            size: { width: this.windowSize.width, height: this.windowSize.height },
          },
        })
      }, 250)
    }

    this.mainWindow.on("move", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowPosition = { x: bounds.x, y: bounds.y }
        schedulePersist()
      }
    })

    this.mainWindow.on("resize", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowSize = { width: bounds.width, height: bounds.height }
        schedulePersist()
      }
    })

    this.mainWindow.on("closed", () => {
      // Cancel any pending debounced persist so a trailing timer does not fire
      // against a destroyed window / stale bounds after close.
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      this.mainWindow = null
      this.isWindowVisible = false
      this.windowPosition = null
      this.windowSize = null
    })
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public isVisible(): boolean {
    return this.isWindowVisible
  }

  public hideMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    const bounds = this.mainWindow.getBounds()
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
    this.mainWindow.hide()
    this.isWindowVisible = false
  }

  public showMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    if (this.windowPosition && this.windowSize) {
      this.applyBounds(
        this.clampToVisibleArea({
          x: this.windowPosition.x,
          y: this.windowPosition.y,
          width: this.windowSize.width,
          height: this.windowSize.height,
        })
      )
    }

    // Re-assert content protection: it can be reset by the OS across show/hide.
    this.mainWindow.setContentProtection(this.settings.get("window").contentProtection)
    this.mainWindow.show()
    this.mainWindow.setAlwaysOnTop(this.settings.get("window").alwaysOnTop)

    this.isWindowVisible = true
  }

  /**
   * Clamp a window rectangle so it stays on a currently-connected display.
   * Prevents the overlay from restoring off-screen after a monitor is unplugged.
   */
  private clampToVisibleArea(
    bounds: Electron.Rectangle,
    area = (screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay()).workArea
  ): Electron.Rectangle {
    const width = Math.min(Math.max(1, Math.ceil(bounds.width)), area.width)
    const height = Math.min(Math.max(1, Math.ceil(bounds.height)), area.height)
    const x = Math.min(Math.max(Math.round(bounds.x), area.x), area.x + area.width - width)
    const y = Math.min(Math.max(Math.round(bounds.y), area.y), area.y + area.height - height)
    return { x, y, width, height }
  }

  private applyBounds(bounds: Electron.Rectangle): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const current = this.mainWindow.getBounds()
    if (current.x !== bounds.x || current.y !== bounds.y ||
        current.width !== bounds.width || current.height !== bounds.height) {
      this.mainWindow.setBounds(bounds)
    }
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
  }

  /** Apply live-updatable window settings without recreating the window. */
  public applyWindowSettings(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const cfg = this.settings.get("window")
    this.mainWindow.setOpacity(cfg.opacity)
    this.mainWindow.setAlwaysOnTop(cfg.alwaysOnTop)
    this.mainWindow.setContentProtection(cfg.contentProtection)
    this.mainWindow.setSkipTaskbar(cfg.skipTaskbar)
    if (process.platform === "darwin") {
      this.mainWindow.setVisibleOnAllWorkspaces(cfg.alwaysOnTop, {
        visibleOnFullScreen: cfg.alwaysOnTop,
      })
      this.mainWindow.setHiddenInMissionControl(cfg.hiddenInMissionControl)
      if (app.dock && app.dock.isVisible() === cfg.skipTaskbar) {
        app.setActivationPolicy(cfg.skipTaskbar ? "accessory" : "regular")
        if (cfg.skipTaskbar) app.dock.hide()
        else void app.dock.show()
      }
    }
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow()
    } else {
      this.showMainWindow()
    }
  }

  private centerWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    const current = this.mainWindow.getBounds()
    const area = screen.getDisplayMatching(current).workArea
    const bounds = this.clampToVisibleArea(current, area)
    this.applyBounds({
      ...bounds,
      x: area.x + Math.floor((area.width - bounds.width) / 2),
      y: area.y + Math.floor((area.height - bounds.height) / 2),
    })
  }

  public centerAndShowWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.warn("Main window does not exist or is destroyed.")
      return
    }

    this.centerWindow()
    // Re-assert content protection: the OS can drop it across show/hide, and this
    // reveal path (tray, second-instance, Center & Show shortcut) must not show the
    // overlay unprotected — matching showMainWindow().
    this.mainWindow.setContentProtection(this.settings.get("window").contentProtection)
    this.mainWindow.show()
    this.mainWindow.focus()
    this.mainWindow.setAlwaysOnTop(this.settings.get("window").alwaysOnTop)
    this.isWindowVisible = true

    if (isDev) console.log(`Window centered and shown`)
  }

  private moveWindow(dx: number, dy: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    const bounds = this.mainWindow.getBounds()
    this.applyBounds(this.clampToVisibleArea({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }))
    if (this.gateShowing) this.gateMovedByUser = true
  }

  public moveWindowRight(): void { this.moveWindow(this.step, 0) }
  public moveWindowLeft(): void { this.moveWindow(-this.step, 0) }
  public moveWindowDown(): void { this.moveWindow(0, this.step) }
  public moveWindowUp(): void { this.moveWindow(0, -this.step) }
}
