import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserWindowConstructorOptions, Rectangle } from "electron"
import { DEFAULT_SETTINGS, type AppSettings } from "../electron/config/schema"
import { WindowHelper } from "../electron/WindowHelper"
import { HintOverlayHelper } from "../electron/HintOverlayHelper"

const mocks = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  dockVisible: false,
  settings: { get: vi.fn(), set: vi.fn() },
  app: {
    setActivationPolicy: vi.fn(),
    dock: { show: vi.fn(async () => {}), hide: vi.fn(), isVisible: vi.fn() },
  },
  screen: { getPrimaryDisplay: vi.fn(), getDisplayMatching: vi.fn() },
}))

vi.mock("electron", () => ({
  BrowserWindow: mocks.BrowserWindow,
  app: mocks.app,
  screen: mocks.screen,
}))
vi.mock("../electron/config/SettingsService", () => ({
  SettingsService: { getInstance: () => mocks.settings },
}))

class MockWindow extends EventEmitter {
  bounds: Rectangle
  visible = false
  destroyed = false
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async () => {}),
  })
  setContentProtection = vi.fn()
  setOpacity = vi.fn()
  setAlwaysOnTop = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  setHiddenInMissionControl = vi.fn()
  setSkipTaskbar = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn(async () => {})
  isDestroyed = vi.fn(() => this.destroyed)
  isVisible = vi.fn(() => this.visible)
  getBounds = vi.fn(() => ({ ...this.bounds }))
  setBounds = vi.fn((bounds: Partial<Rectangle>) => {
    this.bounds = { ...this.bounds, ...bounds }
  })
  show = vi.fn(() => {
    this.visible = true
  })
  showInactive = vi.fn(() => {
    this.visible = true
  })
  hide = vi.fn(() => {
    this.visible = false
  })
  destroy = vi.fn(() => {
    this.destroyed = true
    this.emit("closed")
  })

  constructor(options: BrowserWindowConstructorOptions) {
    super()
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 400,
      height: options.height ?? 600,
    }
  }
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!
let settings: AppSettings
let windows: MockWindow[]

function setPlatform(platform: "darwin" | "win32") {
  Object.defineProperty(process, "platform", { value: platform })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setPlatform("darwin")
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  settings.general.startMinimized = false
  windows = []
  mocks.dockVisible = false
  mocks.app.dock.isVisible.mockImplementation(() => mocks.dockVisible)
  mocks.app.dock.show.mockImplementation(async () => {
    mocks.dockVisible = true
  })
  mocks.app.dock.hide.mockImplementation(() => {
    mocks.dockVisible = false
  })
  mocks.settings.get.mockImplementation((key: keyof AppSettings) => settings[key])
  mocks.BrowserWindow.mockImplementation((options: BrowserWindowConstructorOptions) => {
    const win = new MockWindow(options)
    windows.push(win)
    return win
  })
  const display = {
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
    workAreaSize: { width: 1440, height: 900 },
  }
  mocks.screen.getPrimaryDisplay.mockReturnValue(display)
  mocks.screen.getDisplayMatching.mockReturnValue(display)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(process, "platform", originalPlatform)
})

function createMainWindow() {
  mocks.dockVisible = settings.window.skipTaskbar
  const helper = new WindowHelper({ getHasDebugged: () => false } as ConstructorParameters<typeof WindowHelper>[0])
  helper.createWindow()
  return { helper, win: windows[0] }
}

function expectTopmost(win: MockWindow, enabled: boolean) {
  expect(win.setAlwaysOnTop).toHaveBeenCalled()
  expect(win.setAlwaysOnTop.mock.calls.every(([value]) => value === enabled)).toBe(true)
}

const macSettings = [
  { alwaysOnTop: false, skipTaskbar: false, hiddenInMissionControl: false },
  { alwaysOnTop: false, skipTaskbar: true, hiddenInMissionControl: true },
  { alwaysOnTop: true, skipTaskbar: false, hiddenInMissionControl: true },
  { alwaysOnTop: true, skipTaskbar: true, hiddenInMissionControl: false },
]

function expectMacSettings(win: MockWindow) {
  const cfg = settings.window
  expectTopmost(win, cfg.alwaysOnTop)
  expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(cfg.alwaysOnTop, {
    visibleOnFullScreen: cfg.alwaysOnTop,
  })
  expect(win.setHiddenInMissionControl).toHaveBeenCalledWith(cfg.hiddenInMissionControl)
  expect(win.setSkipTaskbar).toHaveBeenCalledWith(cfg.skipTaskbar)
  expect(mocks.app.setActivationPolicy).toHaveBeenCalledWith(
    cfg.skipTaskbar ? "accessory" : "regular"
  )
  expect(cfg.skipTaskbar ? mocks.app.dock.hide : mocks.app.dock.show).toHaveBeenCalled()
  expect(cfg.skipTaskbar ? mocks.app.dock.show : mocks.app.dock.hide).not.toHaveBeenCalled()
  expect(mocks.dockVisible).toBe(!cfg.skipTaskbar)
}

describe("WindowHelper", () => {
  it.each([-1600, 1440])("keeps resizing on a secondary display starting at x=%i", (x) => {
    const { helper, win } = createMainWindow()
    const area = { x, y: 120, width: 1600, height: 800 }
    mocks.screen.getDisplayMatching.mockReturnValue({ workArea: area })
    win.bounds = { x: x + 100, y: 200, width: 400, height: 400 }
    helper.setWindowDimensions(5000, 5000)
    expect(win.bounds).toEqual({ x: x + 100, y: 120, width: 800, height: 800 })
    const calls = win.setBounds.mock.calls.length
    helper.setWindowDimensions(5000, 5000)
    expect(win.setBounds).toHaveBeenCalledTimes(calls)
    helper.centerAndShowWindow()
    expect(win.bounds.x).toBe(x + 400)
  })

  it("rejects invalid dimensions without changing bounds", () => {
    const { helper, win } = createMainWindow()
    const previous = { ...win.bounds }
    win.setBounds.mockClear()
    helper.setWindowDimensions(NaN, 400)
    helper.setWindowDimensions(400, Infinity)
    helper.setWindowDimensions(0, 400)
    expect(win.bounds).toEqual(previous)
    expect(win.setBounds).not.toHaveBeenCalled()
  })
  it("creates a Notes window without weakening Electron security", () => {
    const { win } = createMainWindow()
    expect(mocks.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Notes",
        show: false,
        alwaysOnTop: settings.window.alwaysOnTop,
        skipTaskbar: settings.window.skipTaskbar,
        webPreferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          devTools: false,
          preload: expect.stringMatching(/[/\\]preload\.js$/),
        }),
      })
    )
    expect(win.setContentProtection).toHaveBeenCalledWith(settings.window.contentProtection)
    expect(win.setOpacity).toHaveBeenCalledWith(settings.window.opacity)
    const denyPopup = win.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(denyPopup({ url: "https://example.com" })).toEqual({ action: "deny" })
    for (const event of ["will-navigate", "will-redirect"]) {
      const preventDefault = vi.fn()
      win.webContents.emit(event, { preventDefault }, "https://example.com")
      expect(preventDefault).toHaveBeenCalledOnce()
      preventDefault.mockClear()
      win.webContents.emit(event, { preventDefault }, "app://bundle/index.html")
      expect(preventDefault).not.toHaveBeenCalled()
    }
  })

  it.each(macSettings)("creates a macOS window honoring %j", (cfg) => {
    settings.window = { ...settings.window, ...cfg }
    const { win } = createMainWindow()
    expectMacSettings(win)
  })

  it("applies changed macOS settings without recreating the window", () => {
    const { helper, win } = createMainWindow()
    for (const [index, cfg] of macSettings.entries()) {
      settings.window = {
        ...settings.window,
        ...cfg,
        opacity: index % 2 ? 0.5 : 1,
        contentProtection: index % 2 === 1,
      }
      vi.clearAllMocks()
      helper.applyWindowSettings()
      expectMacSettings(win)
      expect(win.setOpacity).toHaveBeenCalledWith(settings.window.opacity)
      expect(win.setContentProtection).toHaveBeenCalledWith(settings.window.contentProtection)
      expect(mocks.BrowserWindow).not.toHaveBeenCalled()
      expect(helper.getMainWindow()).toBe(win)
    }
  })

  describe.each(["darwin", "win32"] as const)("%s reveals", (platform) => {
    beforeEach(() => {
      setPlatform(platform)
    })

    it.each([false, true])("ready-to-show reads the latest alwaysOnTop=%s", (alwaysOnTop) => {
      settings.window.alwaysOnTop = !alwaysOnTop
      const { helper, win } = createMainWindow()
      settings.window = { ...settings.window, alwaysOnTop, contentProtection: alwaysOnTop }
      vi.clearAllMocks()
      win.emit("ready-to-show")
      expectTopmost(win, alwaysOnTop)
      expect(win.show).toHaveBeenCalledOnce()
      expect(win.focus).toHaveBeenCalled()
      expect(helper.isVisible()).toBe(true)
      expect(win.setContentProtection).toHaveBeenCalledWith(alwaysOnTop)
      expect(win.setContentProtection.mock.invocationCallOrder[0]).toBeLessThan(
        win.show.mock.invocationCallOrder[0]
      )
    })

    it.each(["showMainWindow", "centerAndShowWindow"] as const)(
      "%s honors false, true, then false between reveals",
      (method) => {
        settings.window.alwaysOnTop = false
        const { helper, win } = createMainWindow()
        win.emit("ready-to-show")
        for (const alwaysOnTop of [false, true, false]) {
          helper.hideMainWindow()
          settings.window = { ...settings.window, alwaysOnTop, contentProtection: alwaysOnTop }
          vi.clearAllMocks()
          helper[method]()
          vi.runAllTimers()
          expectTopmost(win, alwaysOnTop)
          expect(win.show).toHaveBeenCalledOnce()
          expect(helper.isVisible()).toBe(true)
          expect(win.setContentProtection).toHaveBeenCalledWith(alwaysOnTop)
          expect(win.setContentProtection.mock.invocationCallOrder[0]).toBeLessThan(
            win.show.mock.invocationCallOrder[0]
          )
        }
      }
    )
  })

  it("keeps the first reveal hidden when startMinimized is enabled", () => {
    settings.general.startMinimized = true
    settings.window.alwaysOnTop = false
    const { helper, win } = createMainWindow()
    win.emit("ready-to-show")
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
    expect(helper.isVisible()).toBe(false)
    expectTopmost(win, false)
  })

  it("never calls macOS-only APIs on win32 during creation, updates, or reveals", () => {
    setPlatform("win32")
    const { helper, win } = createMainWindow()
    win.emit("ready-to-show")
    for (const enabled of [false, true]) {
      settings.window = {
        ...settings.window,
        alwaysOnTop: enabled,
        hiddenInMissionControl: enabled,
        skipTaskbar: enabled,
      }
      helper.applyWindowSettings()
      expect(win.setSkipTaskbar).toHaveBeenLastCalledWith(enabled)
      helper.hideMainWindow()
      helper.showMainWindow()
      helper.hideMainWindow()
      helper.centerAndShowWindow()
    }
    vi.runAllTimers()
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    expect(win.setHiddenInMissionControl).not.toHaveBeenCalled()
    expect(mocks.app.setActivationPolicy).not.toHaveBeenCalled()
    expect(mocks.app.dock.show).not.toHaveBeenCalled()
    expect(mocks.app.dock.hide).not.toHaveBeenCalled()
    expect(mocks.app.dock.isVisible).not.toHaveBeenCalled()
  })
})

describe.each(["darwin", "win32"] as const)("HintOverlayHelper on %s", (platform) => {
  it("does not create or schedule a hint when alwaysOnTop is false", () => {
    setPlatform(platform)
    settings.window.alwaysOnTop = true
    const getAnchorBounds = vi.fn(() => null)
    const helper = new HintOverlayHelper(getAnchorBounds)
    settings.window = { ...settings.window, alwaysOnTop: false }
    try {
      helper.blink(["A"])
      helper.blink(["B", "D"])
      expect(mocks.BrowserWindow).not.toHaveBeenCalled()
      expect(getAnchorBounds).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      helper.destroy()
    }
  })
})
