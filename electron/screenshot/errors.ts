// Platform-aware classification of screen-capture failures.
//
// The failure modes differ completely per OS and the guidance must match:
//   - macOS   : a real OS permission (Screen Recording) gates capture.
//   - Windows : there is NO screen-capture permission. A failure here is either
//               a missing/blocked capture backend (AV, AppLocker, Controlled
//               Folder Access, absent .NET Framework) or a driver/session
//               issue. Telling a Windows user to "allow a permission" is wrong
//               and sends them looking for a setting that does not exist.
//   - Linux   : usually a missing X/Wayland capture tool or a Wayland portal
//               that was not authorised.
//
// Kept as a pure function (no electron imports) so it is unit-testable.

export type CaptureFailureCode = "SCREEN_PERMISSION" | "SCREEN_CAPTURE_UNAVAILABLE"

export interface CaptureFailure {
  /** Machine-readable code the renderer branches on. */
  code: CaptureFailureCode
  /** User-facing, platform-correct guidance. */
  message: string
  /** True only when an OS privacy setting can actually be opened for this. */
  actionable: boolean
}

const MAC_PERMISSION_PATTERN =
  /could not create image|not authoriz(?:ed|ation)|screen recording|screencapture|operation not permitted|tccd|kTCCService/i

/** Backend was absent or refused to launch (Windows helper / Linux tool). */
const MISSING_BACKEND_PATTERN =
  /no \.net framework|enoent|not recognized as an internal|cannot find|no such file|not available|command failed|spawn\w* enoent/i

/** Backend present but the OS/security software refused to run or write it. */
const BLOCKED_BACKEND_PATTERN =
  /access is denied|\beperm\b|\beacces\b|operation did not complete successfully|virus|malicious|blocked by|this program is blocked|group policy|this file came from another computer/i

const MAC_MESSAGE =
  "Screen Recording permission is required. Open System Settings → Privacy & Security → Screen Recording, enable this app, then relaunch."

const WINDOWS_BLOCKED_MESSAGE =
  "Screen capture was blocked on this PC. This is not a Windows permission — it is usually antivirus, Controlled Folder Access, or a policy blocking the capture helper. Allow this app in your antivirus, then try again."

const WINDOWS_UNAVAILABLE_MESSAGE =
  "Screen capture is unavailable on this PC. Try again after closing any screen-recording or remote-desktop session, or restart the app."

const LINUX_MESSAGE =
  "Screen capture is unavailable. On Wayland, approve the screen-share prompt; on X11, install a capture tool (imagemagick or scrot)."

/**
 * Map a raw backend error to a platform-correct code + message.
 *
 * `platform` is injected rather than read from `process` so the behaviour for
 * every OS is reachable from tests on a single host.
 */
export function classifyCaptureError(rawMessage: string, platform: NodeJS.Platform): CaptureFailure {
  const msg = String(rawMessage ?? "")

  if (platform === "darwin") {
    if (MAC_PERMISSION_PATTERN.test(msg)) {
      return { code: "SCREEN_PERMISSION", message: MAC_MESSAGE, actionable: true }
    }
    return {
      code: "SCREEN_CAPTURE_UNAVAILABLE",
      message: `Screenshot failed: ${msg}`,
      actionable: false,
    }
  }

  if (platform === "win32") {
    // Order matters: an "access is denied" is a block, not a missing backend,
    // and both patterns can match the same string.
    if (BLOCKED_BACKEND_PATTERN.test(msg)) {
      return {
        code: "SCREEN_CAPTURE_UNAVAILABLE",
        message: WINDOWS_BLOCKED_MESSAGE,
        actionable: false,
      }
    }
    if (MISSING_BACKEND_PATTERN.test(msg)) {
      return {
        code: "SCREEN_CAPTURE_UNAVAILABLE",
        message: WINDOWS_UNAVAILABLE_MESSAGE,
        actionable: false,
      }
    }
    return {
      code: "SCREEN_CAPTURE_UNAVAILABLE",
      message: WINDOWS_UNAVAILABLE_MESSAGE,
      actionable: false,
    }
  }

  return { code: "SCREEN_CAPTURE_UNAVAILABLE", message: LINUX_MESSAGE, actionable: false }
}

/** True when the OS exposes a privacy pane worth deep-linking the user to. */
export function hasScreenPrivacySetting(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}
