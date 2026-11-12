// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"

import { classifyCaptureError } from "./screenshot/errors"
import { backendOrder, hideSettleMs, type BackendName } from "./screenshot/policy"
import { probeCaptureSupport, runBackend } from "./screenshot/backends"

// Stealth: temp screenshot paths embed a UUID and reveal capture activity — keep
// them out of production logs.
const isDev = process.env.NODE_ENV === "development"

type CaptureRequest = {
  readonly view: "queue" | "solutions"
  readonly generation: number
  ownedPath?: string
}

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"
  /** Serializes captures so rapid triggers (e.g. mashing the shortcut) cannot race. */
  private captureChain: Promise<void> = Promise.resolve()
  private captureGeneration = 0
  /**
   * Backend that last succeeded. Sticky so we do not re-pay a failing backend's
   * timeout on every subsequent capture once a working one is known.
   */
  private preferredBackend: BackendName | null = null

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(app.getPath("userData"), "extra_screenshots")

    // Create directories if they don't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir, { recursive: true })
    }
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue
  }

  public getExtraScreenshotQueue(): string[] {
    return this.extraScreenshotQueue
  }

  public async clearQueues(): Promise<void> {
    // Invalidate even captures that have not reached their turn in the chain.
    this.captureGeneration++
    const toDelete = [...this.screenshotQueue, ...this.extraScreenshotQueue]
    this.screenshotQueue = []
    this.extraScreenshotQueue = []
    await Promise.allSettled(
      toDelete.map((p) =>
        fs.promises.unlink(p).catch((err) => {
          if (isDev && err?.code !== "ENOENT") console.error(`Error deleting ${p}:`, err)
        })
      )
    )
  }

  /**
   * Try each backend for this platform in order, remembering the one that
   * worked. Reports the FIRST backend's error if every backend fails, since
   * that is the platform's intended path and its message is the most relevant.
   */
  private async capturePng(): Promise<Buffer> {
    const order = backendOrder(process.platform)
    const candidates = this.preferredBackend
      ? [this.preferredBackend, ...order.filter((b) => b !== this.preferredBackend)]
      : order

    let firstError: unknown = null
    for (const backend of candidates) {
      try {
        const png = await runBackend(backend)
        this.preferredBackend = backend
        return png
      } catch (err) {
        if (firstError === null) firstError = err
        if (isDev) console.error(`[ScreenshotHelper] backend "${backend}" failed:`, err)
        // A backend that just failed must not stay sticky.
        if (this.preferredBackend === backend) this.preferredBackend = null
      }
    }
    throw firstError ?? new Error("No screen-capture backend available")
  }

  /**
   * Confirm a capture pipeline exists, without grabbing (or storing) a real
   * frame. Used for the startup warm-up so a broken capture stack is known
   * before the user first presses the shortcut.
   */
  public async probe(): Promise<{ ok: boolean; backend?: BackendName; error?: string }> {
    const result = await probeCaptureSupport()
    if (result.ok && result.backend) this.preferredBackend = result.backend
    return result
  }

  private assertCaptureCurrent(generation: number): void {
    if (generation !== this.captureGeneration) {
      const error = new Error("Screenshot capture cancelled by reset")
      error.name = "AbortError"
      throw error
    }
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    // Destination and reset ownership belong to the request, not its eventual turn.
    const request: CaptureRequest = { view: this.view, generation: this.captureGeneration }
    // Serialize captures: each call waits for the previous one to finish so
    // concurrent triggers cannot race the queue.
    const previous = this.captureChain
    let release: () => void = () => {}
    this.captureChain = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await previous.catch(() => {})
      this.assertCaptureCurrent(request.generation)
      const finalPath = await this.captureScreenshot(request, hideMainWindow, showMainWindow)
      this.assertCaptureCurrent(request.generation)
      return finalPath
    } catch (error) {
      if (request.generation !== this.captureGeneration) {
        // A write can finish after reset (or fail after creating a partial file).
        // Never clean up other queue entries on behalf of this obsolete request.
        if (request.ownedPath) {
          await fs.promises.unlink(request.ownedPath).catch((err) => {
            if (isDev && err?.code !== "ENOENT") {
              console.error("Error removing cancelled screenshot:", err)
            }
          })
        }
        this.assertCaptureCurrent(request.generation)
      }
      throw error
    } finally {
      release()
    }
  }

  private async captureScreenshot(
    request: CaptureRequest,
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    try {
      hideMainWindow()

      // Let the compositor settle so the overlay is really gone from the frame.
      await new Promise((resolve) => setTimeout(resolve, hideSettleMs(process.platform)))
      this.assertCaptureCurrent(request.generation)

      const png = await this.capturePng()
      this.assertCaptureCurrent(request.generation)

      // Write straight to the destination. The previous implementation captured
      // to os.tmpdir() and renamed, which added an EXDEV/EPERM cross-volume
      // dance and an existsSync poll loop; capturing to a Buffer removes both.
      const targetDir = request.view === "queue" ? this.screenshotDir : this.extraScreenshotDir
      const finalPath = path.join(targetDir, `${uuidv4()}.png`)
      await fs.promises.mkdir(targetDir, { recursive: true })
      this.assertCaptureCurrent(request.generation)
      request.ownedPath = finalPath
      await fs.promises.writeFile(finalPath, png)
      this.assertCaptureCurrent(request.generation)

      const queue = request.view === "queue" ? this.screenshotQueue : this.extraScreenshotQueue
      queue.push(finalPath)
      while (queue.length > this.MAX_SCREENSHOTS) {
        const removedPath = queue.shift()
        if (!removedPath) continue
        await fs.promises.unlink(removedPath).catch((error: any) => {
          if (error?.code !== "ENOENT") console.error("Error removing old screenshot:", error)
        })
        this.assertCaptureCurrent(request.generation)
      }

      return finalPath
    } catch (error: any) {
      this.assertCaptureCurrent(request.generation)
      console.error("Error taking screenshot:", error)
      const failure = classifyCaptureError(String(error?.message ?? error), process.platform)
      const err: any = new Error(failure.message)
      err.code = failure.code
      err.actionable = failure.actionable
      throw err
    } finally {
      // Ensure window is always shown again
      showMainWindow()
    }
  }

  public async getImagePreview(filepath: string): Promise<string> {
    const generation = this.captureGeneration
    if (!this.screenshotQueue.includes(filepath) && !this.extraScreenshotQueue.includes(filepath)) {
      throw new DOMException("Screenshot is no longer queued", "AbortError")
    }
    try {
      const data = await fs.promises.readFile(filepath)
      this.assertCaptureCurrent(generation)
      return `data:image/png;base64,${data.toString("base64")}`
    } catch (error) {
      this.assertCaptureCurrent(generation)
      console.error("Error reading image:", error)
      throw error
    }
  }

  public async deleteScreenshot(target: string): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(target)
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        console.error("Error deleting file:", error)
        return { success: false, error: error?.message ?? String(error) }
      }
    }
    this.screenshotQueue = this.screenshotQueue.filter((filePath) => filePath !== target)
    this.extraScreenshotQueue = this.extraScreenshotQueue.filter((filePath) => filePath !== target)
    return { success: true }
  }
}
