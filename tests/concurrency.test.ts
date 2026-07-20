import { describe, it, expect } from "vitest"
import { mapWithConcurrency } from "../electron/llm/concurrency"

describe("mapWithConcurrency", () => {
  it("preserves input order in results regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20, 5], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      return `${i}:${ms}`
    })
    expect(out).toEqual(["0:30", "1:10", "2:20", "3:5"])
  })

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return null
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })

  it("clamps a limit larger than the item count", async () => {
    let peak = 0
    let inFlight = 0
    await mapWithConcurrency([1, 2], 100, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return null
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("rejects if any task rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom")
        return n
      })
    ).rejects.toThrow("boom")
  })
})
