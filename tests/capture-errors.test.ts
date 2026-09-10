import { describe, it, expect } from "vitest"
import { classifyCaptureError, hasScreenPrivacySetting } from "../electron/screenshot/errors"
import { backendOrder, hideSettleMs } from "../electron/screenshot/policy"

describe("classifyCaptureError — macOS", () => {
  it("maps a TCC failure to an actionable permission error", () => {
    const result = classifyCaptureError("could not create image from display", "darwin")
    expect(result.code).toBe("SCREEN_PERMISSION")
    expect(result.actionable).toBe(true)
    expect(result.message).toMatch(/Screen Recording/)
  })

  it("does not claim a permission problem for an unrelated failure", () => {
    const result = classifyCaptureError("disk full", "darwin")
    expect(result.code).toBe("SCREEN_CAPTURE_UNAVAILABLE")
    expect(result.actionable).toBe(false)
  })
})

describe("classifyCaptureError — Windows", () => {
  // Windows has no screen-capture permission; the old code sent Windows users
  // to a macOS System Settings pane for an "Access is denied" from the capture
  // helper. Nothing on Windows may be reported as a permission problem.
  const windowsFailures = [
    "Command failed: cmd /c screenCapture_1.3.2.bat\nAccess is denied.",
    "ENOENT: no such file or directory, open 'C:\\app.asar\\...\\screenCapture_1.3.2.bat'",
    "no .net framework installed",
    "Operation did not complete successfully because the file contains a virus",
    "something entirely unexpected",
  ]

  it.each(windowsFailures)("never reports %s as a permission issue", (message) => {
    const result = classifyCaptureError(message, "win32")
    expect(result.code).toBe("SCREEN_CAPTURE_UNAVAILABLE")
    expect(result.actionable).toBe(false)
    expect(result.message).not.toMatch(/System Settings|Privacy & Security|permission is required/)
  })

  it("names antivirus/policy for a blocked helper rather than a generic failure", () => {
    const blocked = classifyCaptureError("Access is denied.", "win32")
    expect(blocked.message).toMatch(/antivirus|Controlled Folder Access|policy/i)
  })

  it("gives generic recovery guidance when the backend is simply absent", () => {
    const missing = classifyCaptureError("no .net framework installed", "win32")
    expect(missing.message).toMatch(/unavailable/i)
  })
})

describe("classifyCaptureError — Linux", () => {
  it("mentions the Wayland portal and X11 tooling", () => {
    const result = classifyCaptureError("spawn scrot ENOENT", "linux")
    expect(result.code).toBe("SCREEN_CAPTURE_UNAVAILABLE")
    expect(result.message).toMatch(/Wayland|X11/)
  })
})

describe("hasScreenPrivacySetting", () => {
  it("is true only on macOS", () => {
    expect(hasScreenPrivacySetting("darwin")).toBe(true)
    expect(hasScreenPrivacySetting("win32")).toBe(false)
    expect(hasScreenPrivacySetting("linux")).toBe(false)
  })
})

describe("backendOrder", () => {
  it("prefers the native desktopCapturer everywhere except macOS", () => {
    expect(backendOrder("win32")[0]).toBe("desktopCapturer")
    expect(backendOrder("linux")[0]).toBe("desktopCapturer")
    expect(backendOrder("darwin")[0]).toBe("screenshot-desktop")
  })

  it("always keeps a fallback available", () => {
    for (const platform of ["win32", "darwin", "linux"] as NodeJS.Platform[]) {
      expect(new Set(backendOrder(platform)).size).toBe(2)
    }
  })
})

describe("hideSettleMs", () => {
  it("waits longer on Windows so the DWM drops the overlay from the frame", () => {
    expect(hideSettleMs("win32")).toBeGreaterThan(hideSettleMs("darwin"))
  })
})
