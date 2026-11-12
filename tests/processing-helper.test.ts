import fs from "node:fs"
import { EventEmitter } from "node:events"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppState } from "../electron/main"
import { ProcessingHelper } from "../electron/ProcessingHelper"

const mocks = vi.hoisted(() => ({
  llm: {
    getCurrentProvider: vi.fn(() => "bitecodes"),
    ensureVisionModel: vi.fn(async () => {}),
    isUsingOllama: vi.fn(() => false),
    streamImageAnalysis: vi.fn(),
    generateSolution: vi.fn(),
    debugSolutionWithImages: vi.fn(),
    analyzeAudioFromBase64: vi.fn(),
    chat: vi.fn(),
  },
  resize: vi.fn(async () => Buffer.from("synthetic-image")),
  settings: vi.fn(() => ({ autoAnalyze: true })),
}))
vi.mock("../electron/LLMHelper", () => ({ LLMHelper: vi.fn(() => mocks.llm) }))
vi.mock("../electron/config/SettingsService", () => ({ SettingsService: { getInstance: () => ({ get: mocks.settings }) } }))
vi.mock("../electron/image/resize", () => ({ toResizedJpeg: mocks.resize }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
let dir: string
let helper: ProcessingHelper
let send: ReturnType<typeof vi.fn>
let destroyed: boolean
let view: "queue" | "solutions"
let contents: EventEmitter & { send: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockReset().mockReturnValue({ autoAnalyze: true })
  mocks.llm.chat.mockReset()
  mocks.llm.ensureVisionModel.mockImplementation(async () => {})
  mocks.resize.mockImplementation(async () => Buffer.from("synthetic-image"))
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-processing-"))
  const file = path.join(dir, "synthetic.png")
  fs.writeFileSync(file, "synthetic-image")
  destroyed = false
  send = vi.fn()
  view = "queue"
  contents = Object.assign(new EventEmitter(), { send })
  helper = new ProcessingHelper({
    getMainWindow: () => ({ isDestroyed: () => destroyed, webContents: contents }),
    getScreenshotHelper: () => ({ getScreenshotQueue: () => [file], getExtraScreenshotQueue: () => [file] }),
    getView: () => view,
    getProblemInfo: () => ({ problem_statement: "synthetic" }),
    getImagePreview: async () => "data:image/png;base64,c3ludGhldGlj",
    setProblemInfo: vi.fn(),
    setHasDebugged: vi.fn(),
    PROCESSING_EVENTS: { PROBLEM_EXTRACTED: "problem-extracted", INITIAL_SOLUTION_ERROR: "solution-error" },
  } as unknown as AppState)
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("audio transcript latency", () => {
  it("publishes recognition immediately instead of waiting for summary", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    mocks.llm.analyzeAudioFromBase64.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
      return { text: "Synthetic speech", timestamp: Date.now() }
    })
    mocks.llm.chat.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 2400))
      return "**Summary**"
    })
    let visibleAt = 0
    const early = vi.fn(() => { visibleAt = Date.now() - start })
    const result = helper.processAudioBase64("synthetic", "audio/webm", early, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(400)
    expect(early).toHaveBeenCalledWith(expect.objectContaining({ text: "Synthetic speech", analyzing: true }))
    expect(visibleAt).toBe(400)
    await vi.advanceTimersByTimeAsync(2400)
    expect(await result).toMatchObject({ text: "Synthetic speech", analysis: "**Summary**" })
    console.log(JSON.stringify({ measurement: "synthetic ASR 400ms + summary 2400ms", baselineVisibleTranscriptMs: Date.now() - start, visibleTranscriptMs: visibleAt }))
  })

  it.each(["disabled", "empty", "failed", "cancelled"])("preserves audio ownership and optional analysis: %s", async mode => {
    const controller = new AbortController()
    const early = vi.fn()
    mocks.llm.analyzeAudioFromBase64.mockResolvedValueOnce({ text: mode === "empty" ? "  " : "Synthetic speech", timestamp: 1 })
    mocks.settings.mockReturnValueOnce({ autoAnalyze: mode !== "disabled" })
    mocks.llm.chat.mockImplementationOnce(async () => {
      if (mode === "cancelled") controller.abort()
      throw new Error("Summary unavailable")
    })
    const result = helper.processAudioBase64("synthetic", "audio/webm", early, controller.signal)
    if (mode === "cancelled") await expect(result).rejects.toMatchObject({ name: "AbortError" })
    else await expect(result).resolves.toMatchObject({ text: mode === "empty" ? "  " : "Synthetic speech" })
    if (mode === "disabled" || mode === "empty") expect(mocks.llm.chat).not.toHaveBeenCalled()
    else expect(mocks.llm.chat.mock.calls[0][1]).toBe(controller.signal)
  })

  it("does not publish transcription after cancellation", async () => {
    const pending = deferred<{ text: string; timestamp: number }>()
    mocks.llm.analyzeAudioFromBase64.mockReturnValueOnce(pending.promise)
    const controller = new AbortController()
    const early = vi.fn()
    const result = helper.processAudioBase64("synthetic", "audio/webm", early, controller.signal)
    controller.abort()
    pending.resolve({ text: "Late speech", timestamp: 1 })
    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(early).not.toHaveBeenCalled()
  })
})

describe("screenshot processing ownership", () => {
  it("routes the process command to the existing chat analysis flow instead of an absent popup", async () => {
    await helper.processScreenshots()
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith("screenshot-taken", { path: path.join(dir, "synthetic.png"), preview: "data:image/png;base64,c3ludGhldGlj" })
  })

  it("cancels legacy debug generation on renderer reload and removes listeners", async () => {
    view = "solutions"
    const pending = deferred<{ solution: { code: string } }>()
    mocks.llm.generateSolution.mockReturnValueOnce(pending.promise)
    const result = helper.processScreenshots()
    const signal = mocks.llm.generateSolution.mock.calls[0][1] as AbortSignal
    contents.emit("did-start-navigation", {}, "app://bundle/index.html", false, true)
    expect(signal.aborted).toBe(true)
    pending.resolve({ solution: { code: "synthetic" } })
    await result
    expect(mocks.llm.debugSolutionWithImages).not.toHaveBeenCalled()
    expect(contents.listenerCount("did-start-navigation")).toBe(0)
    expect(contents.listenerCount("destroyed")).toBe(0)
  })

  it("cancels during model preparation without starting a stream", async () => {
    const model = deferred<void>()
    mocks.llm.ensureVisionModel.mockReturnValueOnce(model.promise)
    const controller = new AbortController()
    const result = helper.processScreenshotWithChoice("analyze", "a", controller.signal).catch(error => error)
    controller.abort()
    model.resolve()
    expect(await result).toMatchObject({ name: "AbortError" })
    expect(mocks.llm.streamImageAnalysis).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("does not let superseded preparation publish or clear the newer owner", async () => {
    const model = deferred<void>()
    mocks.llm.ensureVisionModel.mockReturnValueOnce(model.promise)
    const old = helper.processScreenshotWithChoice("analyze", "a", new AbortController().signal).catch(error => error)
    const done = deferred<string>()
    mocks.llm.streamImageAnalysis.mockReturnValueOnce(done.promise)
    const current = helper.processScreenshotWithChoice("analyze", "b", new AbortController().signal)
    await vi.waitFor(() => expect(mocks.llm.streamImageAnalysis).toHaveBeenCalledOnce())
    model.resolve()
    expect(await old).toMatchObject({ name: "AbortError" })
    done.resolve("authoritative final")
    await current
    expect(send).toHaveBeenLastCalledWith("problem-extracted", expect.objectContaining({ requestId: "b", problem_statement: "authoritative final", isStreaming: false }))
    expect(send.mock.calls.every(([, payload]) => payload.requestId === "b")).toBe(true)
  })

  it("ignores late tokens and completion after reset", async () => {
    const done = deferred<string>()
    let token!: (text: string) => void
    mocks.llm.streamImageAnalysis.mockImplementationOnce((_prompt, _images, onToken) => {
      token = onToken
      return done.promise
    })
    const result = helper.processScreenshotWithChoice("analyze", "a", new AbortController().signal).catch(error => error)
    await vi.waitFor(() => expect(token).toBeTypeOf("function"))
    token("partial")
    helper.cancelOngoingRequests()
    const count = send.mock.calls.length
    token("stale")
    done.resolve("stale final")
    expect(await result).toMatchObject({ name: "AbortError" })
    expect(send).toHaveBeenCalledTimes(count)
  })

  it("does not send completion into a destroyed window", async () => {
    const done = deferred<string>()
    mocks.llm.streamImageAnalysis.mockReturnValueOnce(done.promise)
    const result = helper.processScreenshotWithChoice("analyze", "a", new AbortController().signal).catch(error => error)
    await vi.waitFor(() => expect(mocks.llm.streamImageAnalysis).toHaveBeenCalledOnce())
    destroyed = true
    const count = send.mock.calls.length
    done.resolve("final")
    expect(await result).toMatchObject({ name: "AbortError" })
    expect(send).toHaveBeenCalledTimes(count)
  })

  it("coalesces deterministic progress without delaying the first token or losing final text", async () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const first = { token: 0, send: 0 }
    send.mockImplementation((channel) => {
      if (channel === "screenshot-analysis-stream") {
        if (!ticks.length) first.send = Date.now()
        ticks.push(Date.now())
      }
    })
    mocks.llm.streamImageAnalysis.mockImplementationOnce(async (_prompt, _images, token) => {
      first.token = Date.now()
      for (let i = 0; i < 200; i++) {
        token("word ")
        await new Promise(done => setTimeout(done, 2))
      }
      return "word ".repeat(200) + "authoritative suffix"
    })
    const result = helper.processScreenshotWithChoice("analyze", "measure", new AbortController().signal)
    await vi.waitFor(() => expect(mocks.llm.streamImageAnalysis).toHaveBeenCalledOnce())
    await vi.runAllTimersAsync()
    await result
    const updates = send.mock.calls.filter(([channel]) => channel === "screenshot-analysis-stream")
    expect(updates.length).toBeLessThanOrEqual(14)
    expect(first.send - first.token).toBe(0)
    const final = send.mock.calls.at(-1)![1]
    expect(final.problem_statement).toBe("word ".repeat(200) + "authoritative suffix")
    expect(final.isStreaming).toBe(false)
    const bytes = updates.reduce((n, [, payload]) => n + Buffer.byteLength(JSON.stringify(payload)), 0)
    const baselineBytes = Array.from({ length: 200 }, (_, i) => Buffer.byteLength(JSON.stringify({ ...updates[0][1], problem_statement: "word ".repeat(i + 1) }))).reduce((a, b) => a + b, 0)
    console.log(JSON.stringify({ measurement: "200 tokens / 2ms; equivalent unbatched payload baseline", baselineProgressEvents: 200, progressEvents: updates.length, baselineBytes, bytes, firstTokenDelayMs: first.send - first.token }))
  })
})
