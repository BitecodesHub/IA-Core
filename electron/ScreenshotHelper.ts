// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"
import screenshot from "screenshot-desktop"

import os from "node:os"

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    )

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

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
      })
    })
    this.screenshotQueue = []

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err
          )
      })
    })
    this.extraScreenshotQueue = []
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    try {
      hideMainWindow()

      // Add a small delay to ensure window is hidden
      await new Promise(resolve => setTimeout(resolve, 100))

      // Use a temporary file path to avoid issues with spaces in directory names
      // screenshot-desktop may fail with spaces in paths on some systems
      const tempPath = path.join(os.tmpdir(), `${uuidv4()}.png`)
      console.log(`Taking screenshot to temp path: ${tempPath}`)

      try {
        await screenshot({ filename: tempPath })
      } catch (err) {
        console.error("screenshot-desktop failed:", err)
        throw err
      }

      // Verify temp file creation with retries
      let retries = 20
      while (retries > 0 && !fs.existsSync(tempPath)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries--
      }

      if (!fs.existsSync(tempPath)) {
        throw new Error(`Failed to verify screenshot at temp path: ${tempPath}`)
      }

      // Determine final destination
      let finalPath = ""
      if (this.view === "queue") {
        finalPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
      } else {
        finalPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
      }

      // Move file to final destination
      await fs.promises.rename(tempPath, finalPath)
      console.log(`Moved screenshot to: ${finalPath}`)

      if (this.view === "queue") {
        this.screenshotQueue.push(finalPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              if (fs.existsSync(removedPath)) {
                await fs.promises.unlink(removedPath)
              }
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      } else {
        this.extraScreenshotQueue.push(finalPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              if (fs.existsSync(removedPath)) {
                await fs.promises.unlink(removedPath)
              }
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      }

      return finalPath
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw new Error(`Failed to take screenshot: ${error.message}`)
    } finally {
      // Ensure window is always shown again
      showMainWindow()
    }
  }

  public async getImagePreview(filepath: string): Promise<string> {
    try {
      const data = await fs.promises.readFile(filepath)
      return `data:image/png;base64,${data.toString("base64")}`
    } catch (error) {
      console.error("Error reading image:", error)
      throw error
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(path)
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error) {
      console.error("Error deleting file:", error)
      return { success: false, error: error.message }
    }
  }
}
