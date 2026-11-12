import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), send: vi.fn() }))
const ipc = Object.assign(new EventEmitter(), { invoke: mocks.invoke, send: mocks.send })
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: ipc }))

type Result = { text: string; timestamp: number; analysis?: string }
let api: {
  analyzeAudioFromBase64: (data: string, mime: string, progress: { id: string; onTranscribed: (result: Result) => void }) => Promise<Result>
  cancelAudioTranscription: (id: string) => void
}
beforeEach(async () => {
  vi.resetModules()
  ipc.removeAllListeners()
  vi.clearAllMocks()
  await import("../electron/preload")
  api = mocks.expose.mock.calls[0][1]
})

describe("audio preload progress ownership", () => {
  it("publishes early progress once and cleans up on completion", async () => {
    const early = vi.fn()
    let finish!: (result: Result) => void
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const result = api.analyzeAudioFromBase64("synthetic", "audio/webm", { id: "one", onTranscribed: early })
    ipc.emit("audio:transcribed:one", {}, { text: "speech", timestamp: 1 })
    ipc.emit("audio:transcribed:one", {}, { text: "duplicate", timestamp: 1 })
    expect(early).toHaveBeenCalledOnce()
    finish({ text: "speech", timestamp: 1, analysis: "summary" })
    await expect(result).resolves.toHaveProperty("analysis", "summary")
    expect(ipc.eventNames()).toHaveLength(0)
    expect(mocks.invoke).toHaveBeenCalledWith("analyze-audio-base64", "synthetic", "audio/webm", "one")
  })

  it("cancels only the matching request and removes its progress listener", async () => {
    const cancelled = vi.fn()
    const current = vi.fn()
    let finish!: (result: Result) => void
    mocks.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    void api.analyzeAudioFromBase64("a", "audio/webm", { id: "old", onTranscribed: cancelled })
    const active = api.analyzeAudioFromBase64("b", "audio/webm", { id: "new", onTranscribed: current })
    api.cancelAudioTranscription("old")
    ipc.emit("audio:transcribed:old", {}, { text: "stale", timestamp: 1 })
    ipc.emit("audio:transcribed:new", {}, { text: "current", timestamp: 1 })
    expect(cancelled).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith("audio:cancel", "old")
    finish({ text: "current", timestamp: 1 })
    await active
    expect(ipc.eventNames()).toHaveLength(0)
  })

  it("cleans up a rejected invocation", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Unavailable"))
    await expect(api.analyzeAudioFromBase64("a", "audio/webm", { id: "failed", onTranscribed: vi.fn() })).rejects.toThrow("Unavailable")
    expect(ipc.eventNames()).toHaveLength(0)
  })
})
