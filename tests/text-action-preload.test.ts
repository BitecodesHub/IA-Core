import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ElectronAPI } from "../src/types/electron"

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), send: vi.fn() }))
const ipc = Object.assign(new EventEmitter(), { invoke: mocks.invoke, send: mocks.send })
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: ipc }))
let api: ElectronAPI

beforeEach(async () => {
  vi.resetModules()
  ipc.removeAllListeners()
  vi.clearAllMocks()
  await import("../electron/preload")
  api = mocks.expose.mock.calls[0][1]
})

describe("text-action preload bridge", () => {
  it("delivers availability and removes only its own subscription", () => {
    const app = vi.fn(), queue = vi.fn()
    const off = api.onTextActionAvailable(app)
    api.onTextActionAvailable(queue)
    off()
    ipc.emit("text-action:available", {}, { openChat: true })
    expect(app).not.toHaveBeenCalled()
    expect(queue).toHaveBeenCalledWith({ openChat: true })
    expect(ipc.listenerCount("text-action:available")).toBe(1)
  })

  it("claims and cancels through fixed channels without arbitrary keyboard input", async () => {
    mocks.invoke.mockResolvedValueOnce({ id: "synthetic", kind: "selection", text: "Example" })
    await expect(api.claimTextAction()).resolves.toMatchObject({ text: "Example" })
    api.cancelTextAction()
    expect(mocks.invoke).toHaveBeenCalledWith("text-action:claim")
    expect(mocks.send).toHaveBeenCalledWith("text-action:cancel")
    expect((api as any).sendInputEvent).toBeUndefined()
  })

  it("separates permission queries from explicit requests", async () => {
    await api.getTextAccessibility()
    expect(mocks.invoke).toHaveBeenCalledWith("text-action:accessibility")
    expect(mocks.invoke).not.toHaveBeenCalledWith("text-action:request-accessibility")
    await api.requestTextAccessibility()
    expect(mocks.invoke).toHaveBeenCalledWith("text-action:request-accessibility")
    await api.openPrivacySettings("accessibility")
    expect(mocks.invoke).toHaveBeenCalledWith("open-privacy-settings", "accessibility")
  })
})
