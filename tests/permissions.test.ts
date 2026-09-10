import { describe, it, expect } from "vitest"
import {
  normalizeOrigin,
  ALLOWED_PERMISSIONS,
  hasScreenPrivacyPane,
  hasMicrophonePrivacyPane,
  hasReadableMediaStatus,
  screenCaptureIsOsGated,
} from "../electron/permissions/policy"

describe("normalizeOrigin", () => {
  // `URL.prototype.origin` returns the string "null" for a non-special scheme,
  // so an origin comparison built on it silently denies every permission in a
  // packaged build (where the renderer is served from app://bundle).
  it("does not fall into the URL.origin 'null' trap for the app:// scheme", () => {
    expect(new URL("app://bundle/index.html").origin).toBe("null")
    expect(normalizeOrigin("app://bundle/index.html")).toBe("app://bundle")
  })

  it("collapses any path on the app origin to the same value", () => {
    expect(normalizeOrigin("app://bundle")).toBe("app://bundle")
    expect(normalizeOrigin("app://bundle/")).toBe("app://bundle")
    expect(normalizeOrigin("app://bundle/assets/index-abc.js")).toBe("app://bundle")
  })

  it("keeps the port so a different dev server does not match", () => {
    expect(normalizeOrigin("http://127.0.0.1:5180/x")).toBe("http://127.0.0.1:5180")
    expect(normalizeOrigin("http://127.0.0.1:5181/x")).not.toBe("http://127.0.0.1:5180")
  })

  it("distinguishes a different app:// host", () => {
    expect(normalizeOrigin("app://other")).not.toBe(normalizeOrigin("app://bundle"))
  })

  it("returns an empty string for unparsable or empty input", () => {
    for (const bad of ["", "not a url", "///", undefined, null]) {
      expect(normalizeOrigin(bad as string)).toBe("")
    }
  })

  it("never matches a remote origin against the app origin", () => {
    const allowed = new Set(["app://bundle", "http://127.0.0.1:5180"].map(normalizeOrigin))
    for (const hostile of [
      "https://evil.com",
      "http://evil.com/app://bundle",
      "file:///etc/passwd",
      "app://bundle.evil.com",
    ]) {
      expect(allowed.has(normalizeOrigin(hostile))).toBe(false)
    }
  })
})

describe("ALLOWED_PERMISSIONS", () => {
  it("grants only what the app actually uses", () => {
    expect(ALLOWED_PERMISSIONS.has("media")).toBe(true)
    expect(ALLOWED_PERMISSIONS.has("audioCapture")).toBe(true)
  })

  it("denies permissions that would open a non-content-protected chooser", () => {
    for (const denied of [
      "geolocation",
      "notifications",
      "hid",
      "serial",
      "usb",
      "midi",
      "openExternal",
    ]) {
      expect(ALLOWED_PERMISSIONS.has(denied)).toBe(false)
    }
  })

  it("never grants the camera — the app only ever requests audio", () => {
    expect(ALLOWED_PERMISSIONS.has("videoCapture")).toBe(false)
  })

  it("does not grant display-capture: capture runs in the main process", () => {
    // desktopCapturer in the main process bypasses Chromium's permission layer,
    // so the renderer has no need for getDisplayMedia.
    expect(ALLOWED_PERMISSIONS.has("display-capture")).toBe(false)
  })
})

describe("per-platform permission facts", () => {
  // The whole class of bug this replaces: treating Windows as if it had a
  // macOS-style screen-capture permission and sending the user to a settings
  // pane that does not exist.
  it("gates screen capture behind an OS permission on macOS only", () => {
    expect(screenCaptureIsOsGated("darwin")).toBe(true)
    expect(screenCaptureIsOsGated("win32")).toBe(false)
    expect(screenCaptureIsOsGated("linux")).toBe(false)
  })

  it("offers a screen privacy pane on macOS only", () => {
    expect(hasScreenPrivacyPane("darwin")).toBe(true)
    expect(hasScreenPrivacyPane("win32")).toBe(false)
    expect(hasScreenPrivacyPane("linux")).toBe(false)
  })

  it("offers a microphone privacy pane on macOS and Windows", () => {
    expect(hasMicrophonePrivacyPane("darwin")).toBe(true)
    expect(hasMicrophonePrivacyPane("win32")).toBe(true)
    expect(hasMicrophonePrivacyPane("linux")).toBe(false)
  })

  it("reads media status only where the API exists", () => {
    // getMediaAccessStatus throws on Linux.
    expect(hasReadableMediaStatus("darwin")).toBe(true)
    expect(hasReadableMediaStatus("win32")).toBe(true)
    expect(hasReadableMediaStatus("linux")).toBe(false)
  })
})
