import { describe, it, expect } from "vitest"
import {
  targetWidthForCapture,
  pixelsPerLogicalPoint,
  DEFAULT_BUDGET,
  type DisplayGeometry,
} from "../electron/image/scale"

const display = (physicalWidth: number, scaleFactor: number): DisplayGeometry => ({
  physicalWidth,
  logicalWidth: physicalWidth / scaleFactor,
})

// The configurations that mattered: a Retina Mac was fine at a fixed 1536 px
// while common Windows desktops were being shredded.
const CONFIGS: Array<[string, DisplayGeometry]> = [
  ["mac 14in retina", display(3024, 2)],
  ["mac 16in retina", display(3456, 2)],
  ["win 1080p @100%", display(1920, 1)],
  ["win 1080p @125%", display(1920, 1.25)],
  ["win 1080p @150%", display(1920, 1.5)],
  ["win 1440p @100%", display(2560, 1)],
  ["win 1440p @150%", display(2560, 1.5)],
  ["win 4k @150%", display(3840, 1.5)],
  ["win 4k @200%", display(3840, 2)],
]

describe("targetWidthForCapture — platform parity", () => {
  it.each(CONFIGS)("%s keeps text legible", (_name, d) => {
    const ratio = pixelsPerLogicalPoint(d.physicalWidth, [d])
    // 0.8 px per logical point is where glyph strokes start dropping out.
    expect(ratio).toBeGreaterThanOrEqual(0.8)
  })

  it("beats the old fixed 1536 width on every non-Retina config", () => {
    for (const [name, d] of CONFIGS) {
      const oldRatio = Math.min(d.physicalWidth, 1536) / d.logicalWidth
      const newRatio = pixelsPerLogicalPoint(d.physicalWidth, [d])
      expect(newRatio, `${name}: regressed`).toBeGreaterThanOrEqual(Math.min(oldRatio, 1))
    }
  })

  it("reaches exactly 1:1 whenever the budget allows it", () => {
    // 1440p at 100% has 2560 logical points, above the 2048 cap, so it is
    // capped rather than 1:1 — that is the deliberate token-budget trade.
    expect(targetWidthForCapture(1920, [display(1920, 1)])).toBe(1920)
    expect(targetWidthForCapture(2560, [display(2560, 1.5)])).toBe(1707)
    expect(targetWidthForCapture(3840, [display(3840, 2)])).toBe(1920)
  })
})

describe("targetWidthForCapture — budget", () => {
  it("never exceeds the cap", () => {
    expect(targetWidthForCapture(3840, [display(3840, 1)])).toBe(DEFAULT_BUDGET.cap)
    expect(targetWidthForCapture(7680, [display(7680, 1)])).toBe(DEFAULT_BUDGET.cap)
  })

  it("never drops below the floor", () => {
    // A small/low-DPI display would otherwise be sent tiny.
    expect(targetWidthForCapture(1280, [display(1280, 2)])).toBe(DEFAULT_BUDGET.floor)
  })

  it("never upscales past the source image", () => {
    // Floor is 1280 but the source is only 800 px: adding pixels adds no detail.
    expect(targetWidthForCapture(800, [display(800, 1)])).toBe(800)
  })

  it("honours a custom budget", () => {
    expect(targetWidthForCapture(3840, [display(3840, 1)], { floor: 512, cap: 1024 })).toBe(1024)
  })
})

describe("targetWidthForCapture — display matching", () => {
  it("picks the display that actually produced the capture", () => {
    const laptop = display(3024, 2) // logical 1512
    const external = display(2560, 1) // logical 2560
    expect(targetWidthForCapture(3024, [laptop, external])).toBe(1512)
    expect(targetWidthForCapture(2560, [laptop, external])).toBe(2048) // capped
  })

  it("tolerates small rounding drift", () => {
    expect(targetWidthForCapture(1921, [display(1920, 1)])).toBe(1920)
  })

  it("does not borrow an unrelated display's scale factor", () => {
    // An image matching no display must be left alone (up to the cap), not
    // downscaled using some other monitor's DPI.
    expect(targetWidthForCapture(1600, [display(3024, 2)])).toBe(1600)
  })

  it("falls back safely when no display info is available", () => {
    expect(targetWidthForCapture(1920, [])).toBe(1920)
    expect(targetWidthForCapture(3840, [])).toBe(DEFAULT_BUDGET.cap)
  })

  it("ignores malformed display entries", () => {
    const bad = [
      { logicalWidth: 0, physicalWidth: 0 },
      { logicalWidth: NaN, physicalWidth: NaN },
      display(1920, 1),
    ]
    expect(targetWidthForCapture(1920, bad)).toBe(1920)
  })
})
