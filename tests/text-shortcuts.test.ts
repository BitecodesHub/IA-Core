import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShortcutsHelper } from "../electron/shortcuts/ShortcutsHelper"
import { SHORTCUT_ACTION_LIST } from "../electron/shortcuts/actions"

const state = vi.hoisted(() => ({ callbacks: new Map<string, () => void>(), bindings: {} as Record<string, string | null> }))
vi.mock("electron", () => ({
  globalShortcut: {
    unregisterAll: () => state.callbacks.clear(),
    register: (key: string, callback: () => void) => { state.callbacks.set(key, callback); return true },
    isRegistered: (key: string) => state.callbacks.has(key),
    unregister: (key: string) => state.callbacks.delete(key),
  },
  app: { on: vi.fn() },
}))
vi.mock("../electron/config/SettingsService", () => ({
  SettingsService: { getInstance: () => ({
    get: (section: string) => section === "shortcuts" ? { bindings: state.bindings, moveStep: 50 } : { bindings: {} },
    set: (patch: any) => { if (patch.shortcuts?.bindings) state.bindings = patch.shortcuts.bindings; return { shortcuts: { moveStep: 50 } } },
  }) },
}))
const platform = Object.getOwnPropertyDescriptor(process, "platform")!
beforeEach(() => {
  state.callbacks.clear()
  state.bindings = {}
  vi.spyOn(ShortcutsHelper.prototype as any, "ensureWillQuitHook").mockImplementation(() => {})
})
afterEach(() => {
  Object.defineProperty(process, "platform", platform)
  vi.restoreAllMocks()
})

function setup(os: string) {
  Object.defineProperty(process, "platform", { value: os })
  const analyze = vi.fn(), paste = vi.fn()
  const helper = new ShortcutsHelper({
    getMainWindow: () => null, setMoveStep: vi.fn(),
    textActions: { analyze, paste },
  } as any)
  helper.applyAll()
  return { helper, analyze, paste }
}

describe("global text shortcuts", () => {
  it("registers both macOS defaults and dispatches only their intended actions", () => {
    const { helper, analyze, paste } = setup("darwin")
    state.callbacks.get("CommandOrControl+Alt+Shift+A")!()
    state.callbacks.get("CommandOrControl+Alt+Shift+X")!()
    expect(analyze).toHaveBeenCalledOnce()
    expect(paste).toHaveBeenCalledOnce()
    expect(helper.getSnapshot().status.analyzeSelectedText).toBe("active")
  })

  it("does not register unsupported imported bindings on another platform", () => {
    state.bindings = { analyzeSelectedText: "Control+Alt+Shift+A", pasteCopiedAnswer: "Control+Alt+Shift+X" }
    const { helper } = setup("linux")
    expect(state.callbacks.size).toBe(SHORTCUT_ACTION_LIST.length - 2)
    expect(helper.getSnapshot().status.pasteCopiedAnswer).toBe("unsupported")
    expect(helper.getSnapshot().defaults.analyzeSelectedText).toBeNull()
    helper.setShortcut("pasteCopiedAnswer", "Control+Alt+Shift+X")
    helper.importShortcuts({ format: "ia-core.shortcuts", bindings: { analyzeSelectedText: "Control+Alt+Shift+A" } })
    helper.resetAll()
    expect(helper.getSnapshot().effective.analyzeSelectedText).toBeNull()
    expect(state.callbacks.has("Control+Alt+Shift+A")).toBe(false)
    expect(state.callbacks.has("Control+Alt+Shift+X")).toBe(false)
  })

  it("supports rebinding, disabling, and resetting the macOS actions", () => {
    const { helper } = setup("darwin")
    helper.setShortcut("analyzeSelectedText", "CommandOrControl+Alt+Shift+Y")
    expect(state.callbacks.has("CommandOrControl+Alt+Shift+A")).toBe(false)
    expect(state.callbacks.has("CommandOrControl+Alt+Shift+Y")).toBe(true)
    helper.setShortcut("analyzeSelectedText", null)
    expect(helper.getSnapshot().status.analyzeSelectedText).toBe("disabled")
    helper.resetOne("analyzeSelectedText")
    expect(state.callbacks.has("CommandOrControl+Alt+Shift+A")).toBe(true)
  })
})
