// Screen-capture backends.
//
// WHY TWO BACKENDS
// ----------------
// `screenshot-desktop` is fine on macOS (it shells out to the built-in
// `screencapture`) but on Windows it does something very fragile: it copies a
// .bat + app.manifest out of the app bundle into %TEMP%\screenCapture, invokes
// the .NET Framework C# compiler to build screenCapture_1.3.2.exe there, and
// then runs that freshly-written .exe. Every step of that is a common Windows
// failure:
//   * the .bat/.manifest live inside app.asar in a packaged build, so the
//     readFileSync throws ENOENT unless they are explicitly asar-unpacked;
//   * writing-then-executing a new .exe in %TEMP% is exactly the pattern
//     Defender ASR rules, Controlled Folder Access, AppLocker and third-party
//     AV block — surfacing as "Access is denied";
//   * it needs .NET Framework's csc.exe to be present.
// The resulting error was previously reported to the user as a macOS
// "Screen Recording permission" problem, which does not exist on Windows.
//
// Electron's own `desktopCapturer` needs no child process, no compiler, no
// temp executable and no OS permission on Windows, so it is the primary
// backend there (and on Linux). On macOS `screencapture` stays primary because
// it produces a colour-accurate, correctly-scaled capture and yields the real
// TCC permission error we can act on.

import { desktopCapturer, screen } from "electron"
import type { BackendName } from "./policy"

/**
 * Capture the display under the cursor via Electron's native capturer.
 * Returns PNG bytes. Never writes a temp file.
 */
export async function captureWithDesktopCapturer(): Promise<Buffer> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor) ?? screen.getPrimaryDisplay()

  // Request the capture at true pixel resolution. `display.size` is in DIPs, so
  // multiply by scaleFactor or text on a HiDPI/125%-scaled Windows display
  // comes back soft and the vision model misreads it.
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * scale)),
    height: Math.max(1, Math.round(display.size.height * scale)),
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize,
    fetchWindowIcons: false,
  })
  if (sources.length === 0) {
    throw new Error("desktopCapturer returned no screen sources")
  }

  // display_id is a string; display.id is a number.
  const target =
    sources.find((s) => s.display_id === String(display.id)) ??
    sources.find((s) => !s.thumbnail.isEmpty()) ??
    sources[0]

  if (!target.thumbnail || target.thumbnail.isEmpty()) {
    throw new Error("desktopCapturer produced an empty frame")
  }
  const png = target.thumbnail.toPNG()
  if (!png || png.length === 0) {
    throw new Error("desktopCapturer produced an empty frame")
  }
  return png
}

/**
 * Capture via `screenshot-desktop`, asking for a Buffer rather than a file.
 * Passing no `filename` skips the library's own copy-to-destination step, which
 * is where paths containing spaces or non-ASCII characters used to break.
 */
export async function captureWithScreenshotDesktop(): Promise<Buffer> {
  // Required lazily: on a machine where the module's native/helper assets are
  // missing, importing it must not take down the whole main process at startup.
  const screenshot = require("screenshot-desktop") as (opts?: {
    format?: string
  }) => Promise<Buffer>
  const buf = await screenshot({ format: "png" })
  if (!buf || buf.length === 0) {
    throw new Error("screenshot-desktop produced an empty frame")
  }
  return buf
}

export async function runBackend(name: BackendName): Promise<Buffer> {
  return name === "desktopCapturer"
    ? captureWithDesktopCapturer()
    : captureWithScreenshotDesktop()
}

/**
 * Cheap capability probe: confirms a capture pipeline exists without grabbing a
 * real frame (1×1 thumbnail). Used at startup so a broken capture stack is
 * discovered and logged before the user presses the shortcut, rather than
 * surfacing as a mysterious failure mid-use.
 */
export async function probeCaptureSupport(): Promise<{
  ok: boolean
  backend?: BackendName
  error?: string
}> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false,
    })
    if (sources.length > 0) return { ok: true, backend: "desktopCapturer" }
  } catch {
    /* fall through to the secondary backend */
  }
  try {
    const screenshot = require("screenshot-desktop") as {
      listDisplays: () => Promise<unknown[]>
    }
    const displays = await screenshot.listDisplays()
    if (displays.length > 0) return { ok: true, backend: "screenshot-desktop" }
    return { ok: false, error: "No capturable displays were reported" }
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}
