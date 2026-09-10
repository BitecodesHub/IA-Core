// Pure permission policy: the allow-list, the origin comparison and the
// per-platform capability facts.
//
// Deliberately free of any `electron` import so it stays unit-testable without
// an Electron runtime — importing `electron` from a test throws outright when
// the Electron binary has not been downloaded (npm blocks install scripts by
// default in recent versions).

/** Chromium permissions the app legitimately needs. Everything else is denied. */
export const ALLOWED_PERMISSIONS = new Set([
  "media", // getUserMedia({ audio: true }) — voice capture
  "audioCapture", // the media sub-permission Chromium checks for the microphone
  "clipboard-sanitized-write", // navigator.clipboard.writeText in CodeBlock
])
// Deliberately NOT allowed:
//   videoCapture    — the app never requests the camera; granting it would let a
//                     renderer bug turn on the webcam (and its indicator light).
//   display-capture — screen capture runs in the MAIN process via desktopCapturer,
//                     which bypasses Chromium's permission layer entirely, so the
//                     renderer never needs getDisplayMedia.

export type PermissionState = "granted" | "denied" | "restricted" | "not-determined" | "unknown"

export interface PermissionReport {
  platform: NodeJS.Platform
  /** Whether a screenshot can actually be taken right now. */
  screenCapture: PermissionState
  /** Microphone availability for voice capture. */
  microphone: PermissionState
  /** True when an OS privacy pane exists that the user can be sent to. */
  screenCaptureActionable: boolean
  microphoneActionable: boolean
  /** Backend/OS detail for logs and the settings UI. */
  detail?: string
}

/**
 * Reduce a URL (or bare origin) to a comparable `scheme://host[:port]` string.
 *
 * `URL.prototype.origin` CANNOT be used here: `app:` is not one of the WHATWG
 * "special" schemes, so `new URL("app://bundle/index.html").origin` is the
 * string "null". Comparing against that would deny every permission in a
 * packaged build, where the renderer is served from app://bundle.
 */
export function normalizeOrigin(input: string | undefined | null): string {
  if (!input) return ""
  try {
    const url = new URL(input)
    const host = url.host || url.hostname
    return `${url.protocol}//${host}`.toLowerCase()
  } catch {
    return ""
  }
}

/**
 * Only macOS has a Screen Recording privacy pane. Windows genuinely has no
 * screen-capture permission, so offering to open one there would be a lie.
 */
export function hasScreenPrivacyPane(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}

/** macOS and Windows both expose a per-app microphone privacy setting. */
export function hasMicrophonePrivacyPane(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32"
}

/**
 * Whether the OS exposes a readable media-access status at all.
 * `systemPreferences.getMediaAccessStatus` is macOS/Windows only.
 */
export function hasReadableMediaStatus(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32"
}

/**
 * Whether screen capture is gated behind an OS permission that must be granted
 * by hand. True only on macOS (TCC); Windows and Linux have no such gate, so
 * the meaningful question there is simply "does the capture pipeline work?".
 */
export function screenCaptureIsOsGated(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}
