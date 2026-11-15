import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  MacTextActions,
  type ActionResult,
  type MacTextActionsOptions,
  type MacTextActionsRunner,
  type MacTextStatus,
  type TextActionResult,
} from "../electron/MacTextActions"

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  app: { isPackaged: false, getAppPath: vi.fn(() => "/mock/Notes project") },
}))
vi.mock("electron", () => ({ app: mocks.app }))
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }))

const output = (value: unknown) => JSON.stringify(value)
const devPath = path.join("/mock/Notes project", "dist-electron", "mac-text-actions")
const packagedPath = path.join("/mock/Notes app/Contents/Resources", "native", "mac-text-actions")
const options = {
  encoding: "utf8",
  shell: false,
  timeout: 3000,
  maxBuffer: 256 * 1024,
  killSignal: "SIGKILL",
}

function setup(
  value: unknown = { ok: true, text: "synthetic selection" },
  overrides: MacTextActionsOptions = {}
) {
  const runner = vi.fn<MacTextActionsRunner>().mockResolvedValue(output(value))
  const helper = new MacTextActions({ platform: "darwin", runner, ...overrides })
  return { helper, runner }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.app.isPackaged = false
  mocks.app.getAppPath.mockReturnValue("/mock/Notes project")
})

describe("MacTextActions status and executable boundary", () => {
  it.each([true, false])(
    "reports native trust %s using a read-only status command",
    async (trusted) => {
      const { helper, runner } = setup({ supported: true, trusted })
      const status: MacTextStatus = await helper.status()
      expect(status).toEqual({ supported: true, trusted })
      expect(runner).toHaveBeenCalledTimes(1)
      expect(runner).toHaveBeenCalledWith(devPath, ["status"], options)
    }
  )

  it("requests permission only through the explicit request command", async () => {
    const { helper, runner } = setup({ supported: true, trusted: false })
    expect(await helper.requestPermission()).toEqual({ supported: true, trusted: false })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(devPath, ["request"], options)
  })

  it("uses only the fixed packaged resource path", async () => {
    mocks.app.isPackaged = true
    const { helper, runner } = setup(
      { ok: true },
      { resourcesPath: "/mock/Notes app/Contents/Resources" }
    )
    const result: ActionResult = await helper.paste()
    expect(result).toEqual({ ok: true })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(packagedPath, ["paste"], options)
    expect(mocks.app.getAppPath).not.toHaveBeenCalled()
  })

  it("uses the fixed development path and never sends text in argv", async () => {
    const text = "synthetic; $(not-a-command)\nfixture"
    const { helper, runner } = setup({ ok: true, text })
    const result: TextActionResult = await helper.selection()
    expect(result).toEqual({ ok: true, text })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(devPath, ["selection"], options)
  })

  it.each(["win32", "linux"] as const)(
    "never invokes or locates a helper on %s",
    async (platform) => {
      const { helper, runner } = setup(undefined, { platform })
      expect(await helper.status()).toEqual({ supported: false, trusted: false })
      expect(await helper.requestPermission()).toEqual({ supported: false, trusted: false })
      expect(await helper.selection()).toMatchObject({ ok: false, code: "UNSUPPORTED" })
      expect(await helper.paste()).toMatchObject({ ok: false, code: "UNSUPPORTED" })
      expect(runner).not.toHaveBeenCalled()
      expect(mocks.app.getAppPath).not.toHaveBeenCalled()
    }
  )

  it("turns unavailable-helper status into supported but untrusted with a safe error", async () => {
    const { helper, runner } = setup()
    runner.mockRejectedValue(
      Object.assign(new Error("synthetic private diagnostic"), { code: "ENOENT" })
    )
    expect(await helper.status()).toEqual({
      supported: true,
      trusted: false,
      error: "The native text-actions helper is not installed.",
    })
  })

  it("handles status failure responses without fabricating trust", async () => {
    const { helper } = setup({
      ok: false,
      error: "Accessibility is unavailable.",
      code: "NOT_TRUSTED",
    })
    expect(await helper.status()).toEqual({
      supported: true,
      trusted: false,
      error: "Accessibility is unavailable.",
    })
  })

  it.each([
    { supported: true },
    { supported: false, trusted: false },
    { supported: "true", trusted: false },
    { supported: true, trusted: "false" },
    { supported: true, trusted: true, text: "synthetic" },
    { ok: true },
    { ok: false, code: "INVALID", error: "" },
  ])("rejects malformed status %j", async (value) => {
    const { helper } = setup(value)
    expect(await helper.status()).toMatchObject({
      supported: true,
      trusted: false,
      error: expect.any(String),
    })
    expect(await helper.requestPermission()).toMatchObject({
      supported: true,
      trusted: false,
      error: expect.any(String),
    })
  })
})

describe("MacTextActions response validation", () => {
  it("preserves a structured native failure", async () => {
    const value = {
      ok: false,
      code: "SECURE_TARGET",
      error: "Secure text fields are not supported.",
    }
    const { helper } = setup(value)
    expect(await helper.selection()).toEqual(value)
    expect(await helper.paste()).toEqual(value)
  })

  it.each([
    null,
    [],
    "string",
    42,
    {},
    { ok: true },
    { ok: true, text: 1 },
    { ok: true, text: "synthetic", extra: true },
    { ok: "true", text: "synthetic" },
    { supported: true, trusted: true },
    { ok: false, error: "failure" },
    { ok: false, code: "BAD", error: 42 },
    { ok: false, code: "bad code", error: "failure" },
    { ok: false, code: "BAD", error: "" },
    { ok: false, code: "BAD", error: "x".repeat(513) },
    { ok: false, code: "B".repeat(65), error: "failure" },
    { ok: false, code: "BAD", error: "failure", text: "synthetic" },
  ])("rejects invalid selection response %j", async (value) => {
    const { helper } = setup(value)
    expect(await helper.selection()).toMatchObject({ ok: false, code: "INVALID_RESPONSE" })
  })

  it.each(["", "not json", '{"ok":true}\n{"ok":true}', 'log line\n{"ok":true}'])(
    "rejects non-JSON stdout %j",
    async (stdout) => {
      const { helper, runner } = setup()
      runner.mockResolvedValue(stdout)
      expect(await helper.selection()).toMatchObject({ ok: false, code: "INVALID_RESPONSE" })
    }
  )

  it("rejects a non-string runner response", async () => {
    const { helper, runner } = setup()
    runner.mockResolvedValue(Buffer.from("synthetic") as unknown as string)
    expect(await helper.selection()).toMatchObject({ ok: false, code: "INVALID_RESPONSE" })
  })

  it("rejects empty selections but preserves nonempty whitespace", async () => {
    const { helper, runner } = setup({ ok: true, text: "" })
    expect(await helper.selection()).toMatchObject({ ok: false, code: "NO_SELECTION" })
    runner.mockResolvedValue(output({ ok: true, text: " \n\t" }))
    expect(await helper.selection()).toEqual({ ok: true, text: " \n\t" })
  })

  it.each(["\ud800", "\udc00", "x\ud800y"])("rejects lone UTF-16 surrogates", async (text) => {
    const { helper } = setup({ ok: true, text })
    expect(await helper.selection()).toMatchObject({ ok: false, code: "INVALID_SELECTION" })
  })

  it.each(["a".repeat(32 * 1024), "é".repeat(16 * 1024), "𝄞".repeat(8 * 1024)])(
    "accepts exactly 32 KiB UTF-8",
    async (text) => {
      const { helper } = setup({ ok: true, text })
      expect(await helper.selection()).toEqual({ ok: true, text })
    }
  )

  it.each(["a".repeat(32 * 1024 + 1), "é".repeat(16 * 1024 + 1), "𝄞".repeat(8 * 1024 + 1)])(
    "rejects selections above 32 KiB UTF-8",
    async (text) => {
      const { helper } = setup({ ok: true, text })
      expect(await helper.selection()).toMatchObject({ ok: false, code: "SELECTION_TOO_LARGE" })
    }
  )

  it("rejects output larger than 256 KiB before parsing", async () => {
    const { helper, runner } = setup()
    runner.mockResolvedValue(" ".repeat(256 * 1024 + 1))
    expect(await helper.selection()).toMatchObject({ ok: false, code: "OUTPUT_TOO_LARGE" })
  })

  it("accepts exactly 256 KiB output and rejects oversized escaped JSON", async () => {
    const { helper, runner } = setup()
    const json = output({ ok: true, text: "synthetic" })
    runner.mockResolvedValue(json + " ".repeat(256 * 1024 - Buffer.byteLength(json)))
    expect(await helper.selection()).toEqual({ ok: true, text: "synthetic" })
    // Escaped control chars expand the wire payload; reject before parsing.
    runner.mockResolvedValue(output({ ok: true, text: "\u0000".repeat(45 * 1024) }))
    expect(await helper.selection()).toMatchObject({ ok: false, code: "OUTPUT_TOO_LARGE" })
  })

  it.each([
    { ok: true, text: "synthetic" },
    { ok: true, trusted: true },
    { ok: true, extra: 1 },
    { supported: true, trusted: true },
  ])("rejects extraneous paste response fields %j", async (value) => {
    const { helper } = setup(value)
    expect(await helper.paste()).toMatchObject({ ok: false, code: "INVALID_RESPONSE" })
  })
})

describe("MacTextActions subprocess errors and cancellation", () => {
  it.each([
    ["ENOENT", "HELPER_UNAVAILABLE"],
    ["EACCES", "HELPER_UNAVAILABLE"],
    ["EPERM", "HELPER_UNAVAILABLE"],
    ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "OUTPUT_TOO_LARGE"],
    ["ETIMEDOUT", "TIMEOUT"],
    ["ABORT_ERR", "CANCELLED"],
    [1, "HELPER_FAILED"],
  ])("maps process error %s to %s without exposing diagnostics", async (processCode, code) => {
    const { helper, runner } = setup()
    runner.mockRejectedValue(
      Object.assign(new Error("synthetic private diagnostic"), {
        code: processCode,
        stdout: "synthetic private stdout",
        stderr: "synthetic private stderr",
      })
    )
    const result = await helper.selection()
    expect(result).toMatchObject({ ok: false, code })
    expect(output(result)).not.toContain("synthetic private")
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it.each([{ killed: true }, { signal: "SIGKILL" }, { signal: "SIGTERM" }])(
    "maps killed subprocesses to timeout %j",
    async (error) => {
      const { helper, runner } = setup()
      runner.mockRejectedValue(error)
      expect(await helper.paste()).toMatchObject({ ok: false, code: "TIMEOUT" })
      expect(runner).toHaveBeenCalledTimes(1)
    }
  )

  it("uses safe error text for arbitrary rejected values and path lookup errors", async () => {
    const { helper, runner } = setup()
    runner.mockRejectedValue("synthetic private rejection")
    expect(await helper.paste()).toMatchObject({ ok: false, code: "HELPER_FAILED" })
    mocks.app.getAppPath.mockImplementation(() => {
      throw new Error("synthetic private path error")
    })
    expect(await helper.selection()).toMatchObject({ ok: false, code: "HELPER_FAILED" })
  })

  it.each(["selection", "paste"] as const)(
    "does not launch an already-cancelled %s",
    async (command) => {
      const { helper, runner } = setup()
      const controller = new AbortController()
      controller.abort()
      expect(await helper[command](controller.signal)).toMatchObject({
        ok: false,
        code: "CANCELLED",
      })
      expect(runner).not.toHaveBeenCalled()
    }
  )

  it.each(["selection", "paste"] as const)(
    "passes cancellation to the running %s subprocess",
    async (command) => {
      const { helper, runner } = setup()
      runner.mockImplementation(
        (_file, _args, opts) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener(
              "abort",
              () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
              { once: true }
            )
          })
      )
      const controller = new AbortController()
      const pending = helper[command](controller.signal)
      expect(runner).toHaveBeenCalledTimes(1)
      expect(runner).toHaveBeenCalledWith(devPath, [command], {
        ...options,
        signal: controller.signal,
      })
      controller.abort()
      expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" })
    }
  )

  it("discards a success response if cancellation won the race", async () => {
    const { helper, runner } = setup()
    const controller = new AbortController()
    runner.mockImplementation(async () => {
      controller.abort()
      return output({ ok: true, text: "synthetic" })
    })
    expect(await helper.selection(controller.signal)).toMatchObject({
      ok: false,
      code: "CANCELLED",
    })
  })

  it("default runner invokes execFile with fixed arguments and bounded shell-free options", async () => {
    mocks.execFile.mockImplementation((_file, _args, _opts, callback) => {
      callback(null, output({ supported: true, trusted: false }), "")
    })
    const helper = new MacTextActions({ platform: "darwin" })
    expect(await helper.status()).toEqual({ supported: true, trusted: false })
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile).toHaveBeenCalledWith(devPath, ["status"], options, expect.any(Function))
  })

  it("default runner forwards AbortSignal and SIGKILL to execFile", async () => {
    mocks.execFile.mockImplementation((_file, _args, opts, callback) => {
      opts.signal.addEventListener(
        "abort",
        () =>
          callback(
            Object.assign(new Error("synthetic private diagnostic"), { code: "ABORT_ERR" }),
            "synthetic private stdout",
            "synthetic private stderr"
          ),
        { once: true }
      )
    })
    const helper = new MacTextActions({ platform: "darwin" })
    const controller = new AbortController()
    const pending = helper.paste(controller.signal)
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile).toHaveBeenCalledWith(
      devPath,
      ["paste"],
      { ...options, signal: controller.signal },
      expect.any(Function)
    )
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" })
  })
})
