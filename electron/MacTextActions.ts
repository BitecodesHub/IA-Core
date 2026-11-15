import { execFile } from "node:child_process"
import path from "node:path"
import { app } from "electron"

export type MacTextStatus = { supported: boolean; trusted: boolean; error?: string }
type Failure = { ok: false; error: string; code: string }
export type TextActionResult = { ok: true; text: string } | Failure
export type ActionResult = { ok: true } | Failure

export type MacTextActionsRunner = (
  file: string,
  args: readonly string[],
  options: {
    encoding: "utf8"
    shell: false
    timeout: number
    maxBuffer: number
    killSignal: "SIGKILL"
    signal?: AbortSignal
  }
) => Promise<string>

export type MacTextActionsOptions = {
  platform?: NodeJS.Platform
  app?: Pick<typeof app, "isPackaged" | "getAppPath">
  resourcesPath?: string
  runner?: MacTextActionsRunner
}

type Command = "status" | "request" | "selection" | "paste"
type NativeResult = MacTextStatus | TextActionResult | ActionResult
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_TEXT_BYTES = 32 * 1024

const runNative: MacTextActionsRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout) => {
      // Never log/forward process stdout, stderr or error.message on failure:
      // they can contain the selected text or other sensitive diagnostics.
      if (error) reject(error)
      else resolve(stdout)
    })
  })

function failure(code: string, error: string): Failure {
  return { ok: false, error, code }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function validFailure(value: Record<string, unknown>): value is Failure {
  return (
    value.ok === false &&
    hasOnlyKeys(value, ["ok", "error", "code"]) &&
    typeof value.error === "string" &&
    value.error.length > 0 &&
    value.error.length <= 512 &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
  )
}

function validUnicode(text: string): boolean {
  // Buffer.byteLength replaces lone surrogates; reject rather than silently
  // accepting text which was not valid Unicode at the subprocess boundary.
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}

function validate(command: Command, stdout: unknown): NativeResult {
  if (typeof stdout !== "string")
    return failure("INVALID_RESPONSE", "The native helper returned an invalid response.")
  if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
    return failure("OUTPUT_TOO_LARGE", "The native helper response exceeds its size limit.")
  }
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return failure("INVALID_RESPONSE", "The native helper returned invalid JSON.")
  }
  if (!isRecord(value))
    return failure("INVALID_RESPONSE", "The native helper returned an invalid response.")
  if (validFailure(value)) return { ok: false, error: value.error, code: value.code }
  if (command === "status" || command === "request") {
    if (
      hasOnlyKeys(value, ["supported", "trusted"]) &&
      value.supported === true &&
      typeof value.trusted === "boolean"
    ) {
      return { supported: true, trusted: value.trusted }
    }
  } else if (command === "selection") {
    if (hasOnlyKeys(value, ["ok", "text"]) && value.ok === true && typeof value.text === "string") {
      if (!value.text.length)
        return failure("NO_SELECTION", "No readable text selection is available.")
      if (!validUnicode(value.text))
        return failure("INVALID_SELECTION", "The selected text is not valid Unicode.")
      if (Buffer.byteLength(value.text, "utf8") > MAX_TEXT_BYTES)
        return failure("SELECTION_TOO_LARGE", "The selection exceeds 32 KiB.")
      return { ok: true, text: value.text }
    }
  } else if (hasOnlyKeys(value, ["ok"]) && value.ok === true) {
    return { ok: true }
  }
  return failure("INVALID_RESPONSE", "The native helper returned an invalid response.")
}

function processFailure(error: unknown, signal?: AbortSignal): Failure {
  const details = isRecord(error) ? error : {}
  if (signal?.aborted || details.name === "AbortError" || details.code === "ABORT_ERR") {
    return failure("CANCELLED", "The text action was cancelled.")
  }
  if (details.code === "ENOENT")
    return failure("HELPER_UNAVAILABLE", "The native text-actions helper is not installed.")
  if (details.code === "EACCES" || details.code === "EPERM")
    return failure("HELPER_UNAVAILABLE", "The native text-actions helper cannot be executed.")
  if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return failure("OUTPUT_TOO_LARGE", "The native helper response exceeds its size limit.")
  if (
    details.killed === true ||
    details.signal === "SIGKILL" ||
    details.signal === "SIGTERM" ||
    details.code === "ETIMEDOUT"
  ) {
    return failure("TIMEOUT", "The native text action timed out.")
  }
  return failure("HELPER_FAILED", "The native text-actions helper failed.")
}

export class MacTextActions {
  private readonly platform: NodeJS.Platform
  private readonly hostApp: Pick<typeof app, "isPackaged" | "getAppPath">
  private readonly resourcesPath: string
  private readonly runner: MacTextActionsRunner

  constructor(options: MacTextActionsOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.hostApp = options.app ?? app
    this.resourcesPath = options.resourcesPath ?? process.resourcesPath
    this.runner = options.runner ?? runNative
  }

  async status(): Promise<MacTextStatus> {
    return this.getStatus("status")
  }

  async requestPermission(): Promise<MacTextStatus> {
    return this.getStatus("request")
  }

  async selection(signal?: AbortSignal): Promise<TextActionResult> {
    const result = await this.invoke("selection", signal)
    if ("ok" in result && result.ok === false) return result
    if ("text" in result && result.ok === true) return { ok: true, text: result.text }
    return failure("INVALID_RESPONSE", "The native helper returned an invalid response.")
  }

  async paste(signal?: AbortSignal): Promise<ActionResult> {
    const result = await this.invoke("paste", signal)
    if ("ok" in result && result.ok === false) return result
    if ("ok" in result && result.ok === true && !("text" in result)) return { ok: true }
    return failure("INVALID_RESPONSE", "The native helper returned an invalid response.")
  }

  private async getStatus(command: "status" | "request"): Promise<MacTextStatus> {
    if (this.platform !== "darwin") return { supported: false, trusted: false }
    const result = await this.invoke(command)
    if ("supported" in result) return result
    return {
      supported: true,
      trusted: false,
      error: "error" in result ? result.error : "The native helper returned an invalid response.",
    }
  }

  private async invoke(command: Command, signal?: AbortSignal): Promise<NativeResult> {
    if (this.platform !== "darwin")
      return failure("UNSUPPORTED", "Native text actions are supported only on macOS.")
    if (signal?.aborted) return failure("CANCELLED", "The text action was cancelled.")
    try {
      const file = this.hostApp.isPackaged
        ? path.join(this.resourcesPath, "native", "mac-text-actions")
        : path.join(this.hostApp.getAppPath(), "dist-electron", "mac-text-actions")
      const stdout = await this.runner(file, [command], {
        encoding: "utf8",
        shell: false,
        timeout: 3000,
        maxBuffer: MAX_OUTPUT_BYTES,
        killSignal: "SIGKILL",
        ...(signal ? { signal } : {}),
      })
      if (signal?.aborted) return failure("CANCELLED", "The text action was cancelled.")
      return validate(command, stdout)
    } catch (error: unknown) {
      return processFailure(error, signal)
    }
  }
}
