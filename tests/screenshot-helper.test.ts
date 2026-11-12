import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ScreenshotHelper } from "../electron/ScreenshotHelper"
import { classifyCaptureError } from "../electron/screenshot/errors"
import { backendOrder, hideSettleMs, type BackendName } from "../electron/screenshot/policy"

const mocks = vi.hoisted(() => ({
  fs: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      readFile: vi.fn(),
    },
  },
  runBackend: vi.fn<(backend: BackendName) => Promise<Buffer>>(),
  probeCaptureSupport: vi.fn(),
  uuid: vi.fn(),
}))

vi.mock("electron", () => ({ app: { getPath: () => "/mock-profile" } }))
vi.mock("node:fs", () => ({ default: mocks.fs }))
vi.mock("uuid", () => ({ v4: mocks.uuid }))
vi.mock("../electron/screenshot/backends", () => ({
  runBackend: mocks.runBackend,
  probeCaptureSupport: mocks.probeCaptureSupport,
}))

const png = Buffer.from("synthetic png fixture")
const disk = new Map<string, Buffer>()
const queueDir = path.join("/mock-profile", "screenshots")
const extraDir = path.join("/mock-profile", "extra_screenshots")
const io = mocks.fs.promises

function fsError(code: string) {
  return Object.assign(new Error(code), { code })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function startCapture(helper: ScreenshotHelper) {
  const hide = vi.fn()
  const show = vi.fn()
  const result = helper.takeScreenshot(hide, show)
  // Attach rejection handling before driving timers or releasing deferred I/O.
  const outcome = result.catch((error: unknown) => error)
  return { hide, show, result, outcome }
}

async function capture(helper: ScreenshotHelper) {
  const task = startCapture(helper)
  await vi.runAllTimersAsync()
  return task.result
}

function expectEmptyQueues(helper: ScreenshotHelper) {
  expect(helper.getScreenshotQueue()).toEqual([])
  expect(helper.getExtraScreenshotQueue()).toEqual([])
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.spyOn(console, "error").mockImplementation(() => {})
  disk.clear()
  let sequence = 0
  mocks.uuid.mockImplementation(() => `capture-${++sequence}`)
  mocks.fs.existsSync.mockReturnValue(true)
  io.mkdir.mockResolvedValue(undefined)
  io.writeFile.mockImplementation(async (filePath: string, data: Buffer) => {
    disk.set(filePath, data)
  })
  io.unlink.mockImplementation(async (filePath: string) => {
    if (!disk.delete(filePath)) throw fsError("ENOENT")
  })
  io.readFile.mockImplementation(async (filePath: string) => {
    const data = disk.get(filePath)
    if (!data) throw fsError("ENOENT")
    return data
  })
  mocks.runBackend.mockResolvedValue(png)
  mocks.probeCaptureSupport.mockResolvedValue({ ok: true, backend: "desktopCapturer" })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ScreenshotHelper request destinations", () => {
  it("snapshots the view before even an idle capture chain yields", async () => {
    const helper = new ScreenshotHelper()
    const task = startCapture(helper)
    helper.setView("solutions")
    await vi.runAllTimersAsync()
    const filePath = await task.result
    expect(path.dirname(filePath)).toBe(queueDir)
    expect(helper.getScreenshotQueue()).toEqual([filePath])
    expect(helper.getExtraScreenshotQueue()).toEqual([])
  })

  it.each(["backend", "mkdir", "write"] as const)(
    "keeps the destination when view changes during %s",
    async (stage) => {
      const helper = new ScreenshotHelper("solutions")
      const gate = deferred<void>()
      if (stage === "backend") {
        mocks.runBackend.mockImplementationOnce(async () => {
          await gate.promise
          return png
        })
      } else if (stage === "mkdir") {
        io.mkdir.mockReturnValueOnce(gate.promise)
      } else {
        io.writeFile.mockImplementationOnce(async (filePath: string, data: Buffer) => {
          await gate.promise
          disk.set(filePath, data)
        })
      }
      const task = startCapture(helper)
      await vi.runAllTimersAsync()
      expect(task.show).not.toHaveBeenCalled()
      helper.setView("queue")
      gate.resolve()
      const filePath = await task.result
      expect(path.dirname(filePath)).toBe(extraDir)
      expect(helper.getExtraScreenshotQueue()).toEqual([filePath])
      expect(helper.getScreenshotQueue()).toEqual([])
      expect(disk.get(filePath)).toEqual(png)
      expect(task.show).toHaveBeenCalledOnce()
    }
  )

  it("serializes captures while keeping each waiting request's original view", async () => {
    const helper = new ScreenshotHelper()
    const backend = deferred<Buffer>()
    mocks.runBackend.mockReturnValueOnce(backend.promise)
    const first = startCapture(helper)
    await vi.runAllTimersAsync()
    helper.setView("solutions")
    const second = startCapture(helper)
    helper.setView("queue")
    await vi.advanceTimersByTimeAsync(0)
    expect(second.hide).not.toHaveBeenCalled()
    expect(mocks.runBackend).toHaveBeenCalledOnce()
    backend.resolve(png)
    await vi.runAllTimersAsync()
    expect(helper.getScreenshotQueue()).toEqual([await first.result])
    expect(helper.getExtraScreenshotQueue()).toEqual([await second.result])
    expect(first.show.mock.invocationCallOrder[0]).toBeLessThan(
      second.hide.mock.invocationCallOrder[0]
    )
    expect(mocks.runBackend).toHaveBeenCalledTimes(2)
  })
})

describe("ScreenshotHelper reset ownership", () => {
  it("invalidates a request before it enters even an idle capture chain", async () => {
    const helper = new ScreenshotHelper()
    const task = startCapture(helper)
    await helper.clearQueues()
    expect(await task.outcome).toMatchObject({ name: "AbortError" })
    expect(task.hide).not.toHaveBeenCalled()
    expect(task.show).not.toHaveBeenCalled()
    expect(mocks.runBackend).not.toHaveBeenCalled()
    expect(io.mkdir).not.toHaveBeenCalled()
    expect(io.unlink).not.toHaveBeenCalled()
  })

  it("cancels during the hide-settle timer without invoking a backend", async () => {
    const helper = new ScreenshotHelper()
    const task = startCapture(helper)
    await vi.advanceTimersByTimeAsync(0)
    expect(task.hide).toHaveBeenCalledOnce()
    await helper.clearQueues()
    await vi.runAllTimersAsync()
    expect(await task.outcome).toMatchObject({ name: "AbortError" })
    expect(mocks.runBackend).not.toHaveBeenCalled()
    expect(io.writeFile).not.toHaveBeenCalled()
    expect(io.unlink).not.toHaveBeenCalled()
    expect(task.show).toHaveBeenCalledOnce()
    expectEmptyQueues(helper)
  })

  it.each(["backend", "mkdir", "write"] as const)(
    "invalidates active and queued captures during %s, then allows new captures",
    async (stage) => {
      const helper = new ScreenshotHelper()
      const gate = deferred<void>()
      if (stage === "backend") {
        mocks.runBackend.mockImplementationOnce(async () => {
          await gate.promise
          return png
        })
      } else if (stage === "mkdir") {
        io.mkdir.mockReturnValueOnce(gate.promise)
      } else {
        io.writeFile.mockImplementationOnce(async (filePath: string, data: Buffer) => {
          await gate.promise
          disk.set(filePath, data)
        })
      }
      const active = startCapture(helper)
      await vi.runAllTimersAsync()
      const pending = startCapture(helper)
      await helper.clearQueues()
      expectEmptyQueues(helper)
      helper.setView("solutions")
      const fresh = startCapture(helper)
      gate.resolve()
      await vi.runAllTimersAsync()
      expect(await active.outcome).toMatchObject({ name: "AbortError" })
      expect(await pending.outcome).toMatchObject({ name: "AbortError" })
      expect(pending.hide).not.toHaveBeenCalled()
      expect(pending.show).not.toHaveBeenCalled()
      expect(active.show).toHaveBeenCalledOnce()
      expect(mocks.runBackend).toHaveBeenCalledTimes(2)
      const filePath = await fresh.result
      expect(helper.getScreenshotQueue()).toEqual([])
      expect(helper.getExtraScreenshotQueue()).toEqual([filePath])
      expect([...disk.keys()]).toEqual([filePath])
      expect(io.writeFile).toHaveBeenCalledTimes(stage === "write" ? 2 : 1)
      expect(io.unlink.mock.calls).toEqual(
        stage === "write" ? [[path.join(queueDir, "capture-1.png")]] : []
      )
      expect(console.error).not.toHaveBeenCalled()
    }
  )

  it.each(["backend", "mkdir", "write"] as const)(
    "reports AbortError rather than a late %s failure after reset",
    async (stage) => {
      const helper = new ScreenshotHelper()
      const gate = deferred<void>()
      if (stage === "backend") {
        mocks.runBackend.mockImplementation(async () => {
          await gate.promise
          return png
        })
      } else if (stage === "mkdir") {
        io.mkdir.mockReturnValueOnce(gate.promise)
      } else {
        io.writeFile.mockImplementationOnce(async (filePath: string) => {
          disk.set(filePath, Buffer.from("partial write"))
          await gate.promise
        })
      }
      const task = startCapture(helper)
      await vi.runAllTimersAsync()
      await helper.clearQueues()
      gate.reject(fsError("EIO"))
      expect(await task.outcome).toMatchObject({ name: "AbortError" })
      expect(task.show).toHaveBeenCalledOnce()
      expectEmptyQueues(helper)
      expect(disk.size).toBe(0)
      expect(io.unlink).toHaveBeenCalledTimes(stage === "write" ? 1 : 0)
    }
  )

  it("cleans only its own file and holds the chain until obsolete-write cleanup finishes", async () => {
    const helper = new ScreenshotHelper()
    const write = deferred<void>()
    const cleanup = deferred<void>()
    const unrelated = path.join(extraDir, "unrelated.png")
    disk.set(unrelated, png)
    io.writeFile.mockImplementationOnce(async (filePath: string, data: Buffer) => {
      await write.promise
      disk.set(filePath, data)
    })
    io.unlink.mockImplementationOnce(async (filePath: string) => {
      await cleanup.promise
      disk.delete(filePath)
    })
    const obsolete = startCapture(helper)
    await vi.runAllTimersAsync()
    await helper.clearQueues()
    const fresh = startCapture(helper)
    write.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(io.unlink.mock.calls).toEqual([[path.join(queueDir, "capture-1.png")]])
    expect(fresh.hide).not.toHaveBeenCalled()
    cleanup.resolve()
    await vi.runAllTimersAsync()
    expect(await obsolete.outcome).toMatchObject({ name: "AbortError" })
    expect([...disk.keys()]).toEqual([unrelated, await fresh.result])
  })

  it.each(["ENOENT", "EACCES"])(
    "keeps AbortError and releases the chain when obsolete-file cleanup fails with %s",
    async (code) => {
      const helper = new ScreenshotHelper()
      const write = deferred<void>()
      io.writeFile.mockReturnValueOnce(write.promise)
      io.unlink.mockRejectedValueOnce(fsError(code))
      const obsolete = startCapture(helper)
      await vi.runAllTimersAsync()
      await helper.clearQueues()
      write.resolve()
      expect(await obsolete.outcome).toMatchObject({ name: "AbortError" })
      expectEmptyQueues(helper)
      const fresh = await capture(helper)
      expect(helper.getScreenshotQueue()).toEqual([fresh])
    }
  )

  it("rejects reset during queue-limit unlink and cleans only the new capture afterwards", async () => {
    const helper = new ScreenshotHelper()
    const previous: string[] = []
    for (let index = 0; index < 5; index++) previous.push(await capture(helper))
    helper.setView("solutions")
    const extra = await capture(helper)
    helper.setView("queue")
    const eviction = deferred<void>()
    io.unlink.mockImplementationOnce(async (filePath: string) => {
      await eviction.promise
      disk.delete(filePath)
    })
    const task = startCapture(helper)
    await vi.runAllTimersAsync()
    const ownPath = path.join(queueDir, "capture-7.png")
    expect(io.unlink.mock.calls).toEqual([[previous[0]]])
    expect(task.show).not.toHaveBeenCalled()
    await helper.clearQueues()
    expectEmptyQueues(helper)
    expect(io.unlink.mock.calls.map(([filePath]) => filePath)).toEqual([
      previous[0],
      ...previous.slice(1),
      ownPath,
      extra,
    ])
    io.unlink.mockClear()
    const fresh = startCapture(helper)
    eviction.resolve()
    await vi.runAllTimersAsync()
    expect(await task.outcome).toMatchObject({ name: "AbortError" })
    expect(io.unlink.mock.calls).toEqual([[ownPath]])
    expect(helper.getScreenshotQueue()).toEqual([await fresh.result])
    expect(helper.getExtraScreenshotQueue()).toEqual([])
    expect([...disk.keys()]).toEqual([await fresh.result])
  })

  it("does not return a successful path if showing the window synchronously resets", async () => {
    const helper = new ScreenshotHelper()
    const result = helper.takeScreenshot(vi.fn(), () => {
      void helper.clearQueues()
    })
    const outcome = result.catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await outcome).toMatchObject({ name: "AbortError" })
    expectEmptyQueues(helper)
    expect(disk.size).toBe(0)
  })
})

describe("ScreenshotHelper queue limits, deletion, and previews", () => {
  it("keeps the latest five files independently in both queues", async () => {
    const helper = new ScreenshotHelper()
    const normal: string[] = []
    const extra: string[] = []
    for (let index = 0; index < 7; index++) normal.push(await capture(helper))
    helper.setView("solutions")
    for (let index = 0; index < 6; index++) extra.push(await capture(helper))
    expect(helper.getScreenshotQueue()).toEqual(normal.slice(2))
    expect(helper.getExtraScreenshotQueue()).toEqual(extra.slice(1))
    expect(io.unlink.mock.calls).toEqual([[normal[0]], [normal[1]], [extra[0]]])
    expect(disk.size).toBe(10)
  })

  it.each(["ENOENT", "EACCES"])(
    "retains the five-item limit if eviction returns %s",
    async (code) => {
      const helper = new ScreenshotHelper()
      const files: string[] = []
      for (let index = 0; index < 5; index++) files.push(await capture(helper))
      io.unlink.mockRejectedValueOnce(fsError(code))
      const newest = await capture(helper)
      expect(helper.getScreenshotQueue()).toEqual([...files.slice(1), newest])
      expect(io.unlink.mock.calls).toEqual([[files[0]]])
    }
  )

  it.each(["queue", "solutions"] as const)(
    "deletes a screenshot from the noncurrent %s view",
    async (view) => {
      const helper = new ScreenshotHelper(view)
      const target = await capture(helper)
      helper.setView(view === "queue" ? "solutions" : "queue")
      const retained = await capture(helper)
      expect(await helper.deleteScreenshot(target)).toEqual({ success: true })
      expect([...helper.getScreenshotQueue(), ...helper.getExtraScreenshotQueue()]).toEqual([
        retained,
      ])
      expect([...disk.keys()]).toEqual([retained])
    }
  )

  it.each([false, true])(
    "removes every matching reference from both queues (missing=%s)",
    async (missing) => {
      const helper = new ScreenshotHelper()
      const target = await capture(helper)
      const retained = await capture(helper)
      helper.getScreenshotQueue().push(target)
      helper.getExtraScreenshotQueue().push(target, target)
      if (missing) disk.delete(target)
      expect(await helper.deleteScreenshot(target)).toEqual({ success: true })
      expect(helper.getScreenshotQueue()).toEqual([retained])
      expect(helper.getExtraScreenshotQueue()).toEqual([])
      expect(io.unlink.mock.calls).toEqual([[target]])
      expect(await helper.deleteScreenshot(target)).toEqual({ success: true })
    }
  )

  it.each(["EACCES", "EIO"])(
    "preserves both queues' references for actual unlink error %s",
    async (code) => {
      const helper = new ScreenshotHelper()
      const target = await capture(helper)
      helper.getExtraScreenshotQueue().push(target)
      io.unlink.mockRejectedValueOnce(fsError(code))
      expect(await helper.deleteScreenshot(target)).toEqual({ success: false, error: code })
      expect(helper.getScreenshotQueue()).toEqual([target])
      expect(helper.getExtraScreenshotQueue()).toEqual([target])
      expect(disk.has(target)).toBe(true)
    }
  )

  it("clears queue references synchronously even if deletion is pending or fails", async () => {
    const helper = new ScreenshotHelper()
    const first = await capture(helper)
    helper.setView("solutions")
    const second = await capture(helper)
    const deletion = deferred<void>()
    io.unlink.mockReturnValueOnce(deletion.promise).mockRejectedValueOnce(fsError("EACCES"))
    const reset = helper.clearQueues()
    expectEmptyQueues(helper)
    expect(io.unlink.mock.calls).toEqual([[first], [second]])
    const fresh = await capture(helper)
    deletion.resolve()
    await reset
    expect(helper.getExtraScreenshotQueue()).toEqual([fresh])
  })

  it("rejects previews completed after reset without publishing stale content", async () => {
    const helper = new ScreenshotHelper()
    const file = await capture(helper)
    const read = deferred<Buffer>()
    io.readFile.mockReturnValueOnce(read.promise)
    const preview = helper.getImagePreview(file).catch(error => error)
    await helper.clearQueues()
    read.resolve(png)
    expect(await preview).toMatchObject({ name: "AbortError" })
    await expect(helper.getImagePreview(file)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps a readable preview when another queued file is missing", async () => {
    const helper = new ScreenshotHelper()
    const missing = await capture(helper)
    const readable = await capture(helper)
    disk.delete(missing)
    await expect(helper.getImagePreview(missing)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await helper.getImagePreview(readable)).toBe(
      `data:image/png;base64,${png.toString("base64")}`
    )
    expect(await helper.deleteScreenshot(missing)).toEqual({ success: true })
    expect(helper.getScreenshotQueue()).toEqual([readable])
  })
})

describe("ScreenshotHelper unchanged capture behavior", () => {
  it("waits for the existing platform hide delay and shows only after writing", async () => {
    const helper = new ScreenshotHelper()
    const write = deferred<void>()
    io.writeFile.mockReturnValueOnce(write.promise)
    const task = startCapture(helper)
    await vi.advanceTimersByTimeAsync(0)
    expect(task.hide).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(hideSettleMs(process.platform) - 1)
    expect(mocks.runBackend).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.runBackend.mock.calls).toEqual([[backendOrder(process.platform)[0]]])
    expect(io.mkdir.mock.calls).toEqual([[queueDir, { recursive: true }]])
    expect(io.writeFile.mock.calls).toEqual([[path.join(queueDir, "capture-1.png"), png]])
    expect(task.show).not.toHaveBeenCalled()
    write.resolve()
    await task.result
    expect(task.show).toHaveBeenCalledOnce()
  })

  it("uses fallback and keeps the last successful backend sticky", async () => {
    const helper = new ScreenshotHelper()
    const order = backendOrder(process.platform)
    mocks.runBackend.mockRejectedValueOnce(new Error("backend unavailable"))
    await capture(helper)
    await capture(helper)
    expect(mocks.runBackend.mock.calls).toEqual([[order[0]], [order[1]], [order[1]]])
  })

  it("probes support without capturing and uses the discovered backend", async () => {
    const helper = new ScreenshotHelper()
    const backend = backendOrder(process.platform)[1]
    mocks.probeCaptureSupport.mockResolvedValueOnce({ ok: true, backend })
    expect(await helper.probe()).toEqual({ ok: true, backend })
    expect(mocks.runBackend).not.toHaveBeenCalled()
    expect(io.writeFile).not.toHaveBeenCalled()
    await capture(helper)
    expect(mocks.runBackend.mock.calls).toEqual([[backend]])
  })

  it("classifies the first backend error, restores the window, and releases the chain", async () => {
    const helper = new ScreenshotHelper()
    const message = "could not create image from display"
    mocks.runBackend
      .mockRejectedValueOnce(new Error(message))
      .mockRejectedValueOnce(new Error("fallback failure"))
    const task = startCapture(helper)
    await vi.runAllTimersAsync()
    expect(await task.outcome).toMatchObject(classifyCaptureError(message, process.platform))
    expect(task.show).toHaveBeenCalledOnce()
    expect(io.writeFile).not.toHaveBeenCalled()
    const filePath = await capture(helper)
    expect(helper.getScreenshotQueue()).toEqual([filePath])
  })
})
