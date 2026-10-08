// Choosing how large a screenshot to send to a vision model.
//
// THE BUG THIS REPLACES
// ---------------------
// The previous code downscaled every capture to a fixed 1536 px width. That
// number happens to be right for a macOS Retina display and wrong almost
// everywhere else, because what matters for text legibility is not the pixel
// width — it is how many pixels survive per *logical* point of the desktop the
// user was looking at:
//
//   display                 physical  logical  sent  px/point
//   mac 14" Retina              3024     1512  1536      1.02  fine
//   win 1920x1080 @100%         1920     1920  1536      0.80  soft
//   win 2560x1440 @100%         2560     2560  1536      0.60  unreadable
//   win 3840x2160 @100%         3840     3840  1536      0.40  unreadable
//
// A Retina Mac renders 2 physical pixels per point, so halving it lands back at
// 1:1 and text stays crisp. A typical Windows desktop renders ~1 pixel per
// point, so the same downscale throws away 20-60% of the glyph detail and the
// model starts guessing at the text. That is the "bad answers on Windows".
//
// The fix is to target ~1 pixel per logical point regardless of platform,
// clamped to a token budget.
//
// Pure module (no electron import) so it is testable on any host.

export interface DisplayGeometry {
  /** Width in device-independent points (what the user perceives). */
  logicalWidth: number
  /** Width in real pixels (logicalWidth * scaleFactor). */
  physicalWidth: number
}

export interface ScaleBudget {
  /**
   * Never send less than this. Below roughly 1000 px even a low-resolution
   * desktop loses small UI text.
   */
  floor: number
  /**
   * Never send more than this. Vision endpoints downscale server-side beyond
   * roughly 1.5-2k on the long edge anyway, and every extra pixel costs tokens
   * and latency for no accuracy gain.
   */
  cap: number
}

export const DEFAULT_BUDGET: ScaleBudget = { floor: 1280, cap: 2048 }

/**
 * Pick the width to downscale a capture to.
 *
 * `imageWidthPx` identifies which display produced the capture (its physical
 * width), which is how the logical width is recovered without threading
 * metadata through the screenshot queue.
 */
export function targetWidthForCapture(
  imageWidthPx: number,
  displays: DisplayGeometry[],
  budget: ScaleBudget = DEFAULT_BUDGET
): number {
  const floor = Math.max(1, Math.round(budget.floor))
  const cap = Math.max(floor, Math.round(budget.cap))

  // Match the capture to the display it came from. Exact first; otherwise the
  // closest physical width, so an off-by-a-pixel rounding still resolves.
  const match = pickDisplay(imageWidthPx, displays)

  // With no usable display info, fall back to sending the image unchanged (up
  // to the cap) rather than guessing a downscale that might destroy text.
  const logical = match ? match.logicalWidth : imageWidthPx

  // Target 1 pixel per logical point, then apply the budget. Never upscale
  // past the source: adding pixels cannot add detail, only cost.
  return Math.min(cap, Math.max(floor, Math.round(logical)), Math.round(imageWidthPx))
}

function pickDisplay(imageWidthPx: number, displays: DisplayGeometry[]): DisplayGeometry | null {
  const usable = displays.filter(
    (d) =>
      Number.isFinite(d.logicalWidth) &&
      Number.isFinite(d.physicalWidth) &&
      d.logicalWidth > 0 &&
      d.physicalWidth > 0
  )
  if (usable.length === 0) return null

  const exact = usable.find((d) => Math.round(d.physicalWidth) === Math.round(imageWidthPx))
  if (exact) return exact

  // Tolerate small rounding drift only. A capture that matches no display
  // (e.g. an imported image) must not borrow an unrelated display's scale.
  let best: DisplayGeometry | null = null
  let bestDelta = Infinity
  for (const d of usable) {
    const delta = Math.abs(d.physicalWidth - imageWidthPx)
    if (delta < bestDelta) {
      bestDelta = delta
      best = d
    }
  }
  return best && bestDelta <= Math.max(4, imageWidthPx * 0.02) ? best : null
}

/**
 * Pixels retained per logical point — the legibility figure. 1.0 means the
 * model sees text exactly as sharp as the user does. Exposed for diagnostics
 * and for the regression test that pins platform parity.
 */
export function pixelsPerLogicalPoint(
  imageWidthPx: number,
  displays: DisplayGeometry[],
  budget: ScaleBudget = DEFAULT_BUDGET
): number {
  const match = pickDisplay(imageWidthPx, displays)
  const logical = match ? match.logicalWidth : imageWidthPx
  return targetWidthForCapture(imageWidthPx, displays, budget) / logical
}
