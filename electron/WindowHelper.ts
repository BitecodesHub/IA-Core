import { BrowserWindow, screen } from "electron"
import { AppState } from "main"
import path from "node:path"
import { SettingsService } from "./config/SettingsService"

const isDev = process.env.NODE_ENV === "development"

const startUrl = isDev ? "http://localhost:5180" : "app://bundle/index.html"

export class WindowHelper {
  private mainWindow: BrowserWindow | null = null
  private isWindowVisible: boolean = false
  private windowPosition: { x: number; y: number } | null = null
  private windowSize: { width: number; height: number } | null = null
  private appState: AppState

  // Initialize with explicit number type
  private screenWidth: number = 0
  private screenHeight: number = 0
  private step: number = 50 // pixels per move action; overridden from settings
  private currentX: number = 0
  private currentY: number = 0
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

  public setWindowDimensions(width: number, height: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    // Get current window position
    const [currentX, currentY] = this.mainWindow.getPosition()

    // Get screen dimensions
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize

    // Use 75% width if debugging has occurred, otherwise use 60%
    const maxAllowedWidth = Math.floor(
      workArea.width * (this.appState.getHasDebugged() ? 0.75 : 0.5)
    )

    // Ensure width doesn't exceed max allowed width and height is reasonable
    const newWidth = Math.min(width + 32, maxAllowedWidth)
    const newHeight = Math.ceil(height)

    // Center the window horizontally if it would go off screen
    const maxX = workArea.width - newWidth
    const newX = Math.min(Math.max(currentX, 0), maxX)

    // Update window bounds
    this.mainWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    })

    // Update internal state
    this.windowPosition = { x: newX, y: currentY }
    this.windowSize = { width: newWidth, height: newHeight }
    this.currentX = newX
  }

  public createWindow(): void {
    if (this.mainWindow !== null) return

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    this.screenWidth = workArea.width
    this.screenHeight = workArea.height

    const winCfg = this.settings.get("window")
    this.step = this.settings.get("shortcuts").moveStep

    const windowSettings: Electron.BrowserWindowConstructorOptions = {
      title: "",
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
    // requests. Pin to the known app origin (file:// in prod, localhost in dev)
    // and deny everything else, including redirects and unparsable URLs.
    let allowedOrigin = ""
    try {
      allowedOrigin = new URL(startUrl).origin
    } catch {
      /* startUrl always valid; defensive only */
    }
    const denyForeign = (e: Electron.Event, url: string) => {
      try {
        if (new URL(url).origin !== allowedOrigin) e.preventDefault()
      } catch {
        e.preventDefault()
      }
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

    if (process.platform === "darwin") {
      this.mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      })
      this.mainWindow.setHiddenInMissionControl(winCfg.hiddenInMissionControl)
      this.mainWindow.setAlwaysOnTop(winCfg.alwaysOnTop, "floating")
    }
    if (process.platform === "linux") {
      // Linux-specific optimizations for better compatibility
      if (this.mainWindow.setHasShadow) {
        this.mainWindow.setHasShadow(false)
      }
      // Keep window focusable on Linux for proper interaction
      this.mainWindow.setFocusable(true)
    }
    this.mainWindow.setSkipTaskbar(winCfg.skipTaskbar)
    this.mainWindow.setAlwaysOnTop(winCfg.alwaysOnTop)

    const loadAppUrl = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return
      this.mainWindow.loadURL(startUrl).catch((err) => {
        if (isDev) console.error("Failed to load URL:", err)
      })
    }

    // Surface renderer/preload load failures and a mounted-content check to the
    // main-process log — a blank window is almost always one of these, and the
    // root-content count catches a silently failed render (0 = blank).
    this.mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
      if (isDev && code === -102) {
        console.warn(
          `[WindowHelper] Dev server not reachable at ${url}. Retrying in 2s... (Tip: run "npm start" to launch dev server + Electron together)`
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
          this.mainWindow.setAlwaysOnTop(true)
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
    this.currentX = bounds.x
    this.currentY = bounds.y

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
        this.currentX = bounds.x
        this.currentY = bounds.y
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
      this.mainWindow.setBounds(
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
    this.mainWindow.setAlwaysOnTop(true)

    this.isWindowVisible = true
  }

  /**
   * Clamp a window rectangle so it stays on a currently-connected display.
   * Prevents the overlay from restoring off-screen after a monitor is unplugged.
   */
  private clampToVisibleArea(bounds: { x: number; y: number; width: number; height: number }): {
    x: number
    y: number
    width: number
    height: number
  } {
    const display = screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay()
    const area = display.workArea
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
    const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
    return { x, y, width, height }
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
      this.mainWindow.setHiddenInMissionControl(cfg.hiddenInMissionControl)
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

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize

    // Get current window size or use defaults
    const windowBounds = this.mainWindow.getBounds()
    const windowWidth = windowBounds.width || 400
    const windowHeight = windowBounds.height || 600

    // Calculate center position
    const centerX = Math.floor((workArea.width - windowWidth) / 2)
    const centerY = Math.floor((workArea.height - windowHeight) / 2)

    // Set window position
    this.mainWindow.setBounds({
      x: centerX,
      y: centerY,
      width: windowWidth,
      height: windowHeight,
    })

    // Update internal state
    this.windowPosition = { x: centerX, y: centerY }
    this.windowSize = { width: windowWidth, height: windowHeight }
    this.currentX = centerX
    this.currentY = centerY
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
    this.mainWindow.setAlwaysOnTop(true)
    this.isWindowVisible = true

    if (isDev) console.log(`Window centered and shown`)
  }

  // New methods for window movement
  public moveWindowRight(): void {
    if (!this.mainWindow) return

    const windowWidth = this.windowSize?.width || 0
    const halfWidth = windowWidth / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentX = Math.min(this.screenWidth - halfWidth, this.currentX + this.step)
    this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY))
  }

  public moveWindowLeft(): void {
    if (!this.mainWindow) return

    const windowWidth = this.windowSize?.width || 0
    const halfWidth = windowWidth / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentX = Math.max(-halfWidth, this.currentX - this.step)
    this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY))
  }

  public moveWindowDown(): void {
    if (!this.mainWindow) return

    const windowHeight = this.windowSize?.height || 0
    const halfHeight = windowHeight / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentY = Math.min(this.screenHeight - halfHeight, this.currentY + this.step)
    this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY))
  }

  public moveWindowUp(): void {
    if (!this.mainWindow) return

    const windowHeight = this.windowSize?.height || 0
    const halfHeight = windowHeight / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentY = Math.max(-halfHeight, this.currentY - this.step)
    this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY))
  }
}
