// Pure per-platform capture policy. Deliberately free of any `electron` import
// so it stays unit-testable without an Electron runtime.

export type BackendName = "desktopCapturer" | "screenshot-desktop"

/**
 * Preferred backend order for a platform, most reliable first.
 *
 * On macOS `screenshot-desktop` shells out to the built-in `screencapture`,
 * which is colour-accurate and surfaces the real Screen Recording (TCC) error
 * we can act on, so it leads there.
 *
 * Everywhere else Electron's `desktopCapturer` leads, because the
 * `screenshot-desktop` Windows path writes a .bat + manifest to %TEMP%,
 * compiles a .exe with the .NET Framework compiler and runs it — a chain that
 * fails on missing asar-unpacked assets, on machines without .NET Framework,
 * and under Defender ASR / Controlled Folder Access / AppLocker.
 */
export function backendOrder(platform: NodeJS.Platform): BackendName[] {
  return platform === "darwin"
    ? ["screenshot-desktop", "desktopCapturer"]
    : ["desktopCapturer", "screenshot-desktop"]
}

/**
 * Milliseconds to wait after hiding the overlay before grabbing a frame.
 * Windows composites through the DWM, so a hide is not reflected in the next
 * captured frame as promptly as on macOS; too short a wait leaves a ghost of
 * the overlay in the shot.
 */
export function hideSettleMs(platform: NodeJS.Platform): number {
  return platform === "win32" ? 180 : 100
}
