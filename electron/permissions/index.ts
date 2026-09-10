// Centralised OS + Chromium permission handling.
//
// Two distinct layers are involved and they are easy to conflate:
//
//  1. CHROMIUM permissions. The renderer asking for the microphone via
//     getUserMedia goes through Chromium's permission machinery. With no
//     handler installed, Electron's defaults apply — which are neither
//     explicitly granted nor auditable, and on a custom scheme origin the
//     request can be refused with no visible reason. We install an explicit
//     allow-list: the app's own origin may use the microphone and write to the
//     clipboard; every other permission, and every other origin, is denied.
//
//  2. OS privacy settings. Only macOS gates screen capture behind a real
//     permission (TCC / Screen Recording), and it cannot be requested
//     programmatically — the user must toggle it in System Settings. The
//     microphone CAN be requested on macOS, and Windows exposes a readable
//     (but not requestable) per-app microphone privacy setting.
//
// Windows has NO screen-capture permission at all. Nothing to request, so the
// only correct Windows behaviour is to verify the capture pipeline works and
// report a Windows-shaped problem when it does not.
//
// The pure parts (allow-list, origin comparison, per-platform facts) live in
// ./policy so they can be tested without an Electron runtime.

import { app, session, shell, systemPreferences } from "electron"
import {
  ALLOWED_PERMISSIONS,
  hasMicrophonePrivacyPane,
  hasReadableMediaStatus,
  hasScreenPrivacyPane,
  normalizeOrigin,
  screenCaptureIsOsGated,
  type PermissionReport,
  type PermissionState,
} from "./policy"

export {
  ALLOWED_PERMISSIONS,
  normalizeOrigin,
  hasScreenPrivacyPane,
  hasMicrophonePrivacyPane,
} from "./policy"
export type { PermissionReport, PermissionState } from "./policy"

/**
 * Install allow-listed permission handlers on every session.
 *
 * `setPermissionRequestHandler` covers interactive requests;
 * `setPermissionCheckHandler` covers the synchronous checks Chromium performs
 * before even offering a device (e.g. enumerateDevices labels). Both must be
 * set or the microphone can appear present and then fail on use.
 */
export function installPermissionHandlers(allowedOrigins: string[]): void {
  const origins = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean))

  const isOwnOrigin = (url: string | undefined | null): boolean => {
    const normalized = normalizeOrigin(url)
    return normalized !== "" && origins.has(normalized)
  }

  const apply = (ses: Electron.Session): void => {
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = details?.requestingUrl ?? webContents?.getURL()
      callback(ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(requestingUrl))
    })

    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      const url = details?.requestingUrl ?? requestingOrigin
      return ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(url)
    })

    // Deny every device-permission handshake we did not ask for (HID, serial,
    // USB, Bluetooth). Left unset, Chromium's chooser UI would be a window we
    // do not content-protect.
    ses.setDevicePermissionHandler(() => false)
  }

  apply(session.defaultSession)
  // Any window created with a non-default partition gets the same treatment.
  app.on("session-created", apply)
}

function readMediaStatus(kind: "screen" | "microphone"): PermissionState {
  if (!hasReadableMediaStatus(process.platform)) return "unknown"
  try {
    return systemPreferences.getMediaAccessStatus(kind) as PermissionState
  } catch {
    return "unknown"
  }
}

export type ProbeScreenCapture = () => Promise<{
  ok: boolean
  backend?: string
  error?: string
}>

/**
 * Read current permission/capability state WITHOUT prompting for anything.
 *
 * Safe to call from any query path — it never shows an OS dialog, so a
 * "what is my screen-capture status?" question can never pop a microphone
 * prompt as a side effect. `probeScreenCapture` is injected so this module
 * stays free of a dependency on the screenshot stack.
 */
export async function readPermissions(
  probeScreenCapture: ProbeScreenCapture
): Promise<PermissionReport> {
  const platform = process.platform
  const microphone = readMediaStatus("microphone")

  // macOS: read the TCC status directly (it cannot be requested; the first
  // capture attempt is what triggers the system prompt).
  // Windows/Linux: no such permission exists, so "can we capture?" is the only
  // meaningful question — answer it by probing the pipeline.
  let screenCapture: PermissionState
  let detail: string | undefined
  if (screenCaptureIsOsGated(platform)) {
    screenCapture = readMediaStatus("screen")
    if (screenCapture !== "granted") {
      detail = "Screen Recording is not enabled for this app in System Settings."
    }
  } else {
    const probe = await probeScreenCapture()
    screenCapture = probe.ok ? "granted" : "restricted"
    detail = probe.ok ? `Capture backend: ${probe.backend}` : probe.error
  }

  return {
    platform,
    screenCapture,
    microphone,
    screenCaptureActionable: hasScreenPrivacyPane(platform),
    microphoneActionable: hasMicrophonePrivacyPane(platform),
    detail,
  }
}

/**
 * Request everything that CAN be requested, then report the resulting state.
 *
 * Called ONCE at startup so the only OS prompt this app can raise (the macOS
 * microphone grant) appears while the user is deliberately launching the app,
 * rather than interrupting them mid-task on first use. Screen capture is
 * deliberately not "requested": macOS cannot be prompted for it
 * programmatically, and Windows has no such permission to request at all.
 */
export async function requestStartupPermissions(
  probeScreenCapture: ProbeScreenCapture
): Promise<PermissionReport> {
  if (process.platform === "darwin" && readMediaStatus("microphone") !== "granted") {
    try {
      await systemPreferences.askForMediaAccess("microphone")
    } catch {
      /* fall through: readPermissions reports whatever the status ended up as */
    }
  }
  return readPermissions(probeScreenCapture)
}

/** Open the OS privacy pane for a given capability, where one exists. */
export async function openPrivacySettings(kind: "screen" | "microphone"): Promise<{ ok: boolean }> {
  try {
    if (process.platform === "darwin") {
      const pane =
        kind === "screen"
          ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
          : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
      await shell.openExternal(pane)
      return { ok: true }
    }
    if (process.platform === "win32") {
      // Windows has a microphone privacy page but NO screen-capture one.
      if (kind !== "microphone") return { ok: false }
      await shell.openExternal("ms-settings:privacy-microphone")
      return { ok: true }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}
