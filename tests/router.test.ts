import { describe, it, expect } from "vitest"
import { classifyComplexity, selectModel } from "../electron/llm/router"

const TIERS = { low: "low-m", high: "high-m", vision: "vis-m" }

describe("classifyComplexity", () => {
  it("rates short, simple prompts as low", () => {
    expect(classifyComplexity({ prompt: "what is java" })).toBe("low")
    expect(classifyComplexity({ prompt: "hello there" })).toBe("low")
  })

  it("rates long prompts as high", () => {
    expect(classifyComplexity({ prompt: "x".repeat(700) })).toBe("high")
  })

  it("rates code / algorithmic prompts as high", () => {
    expect(classifyComplexity({ prompt: "debug this function" })).toBe("high")
    expect(classifyComplexity({ prompt: "what is the time complexity?" })).toBe("high")
    expect(classifyComplexity({ prompt: "```js\nconst x = 1\n```" })).toBe("high")
    expect(classifyComplexity({ prompt: "explain step by step" })).toBe("high")
  })

  it("rates deep conversations as high", () => {
    expect(classifyComplexity({ prompt: "and then?", historyLength: 8 })).toBe("high")
  })

  it("rates multi-question prompts as high", () => {
    expect(classifyComplexity({ prompt: "a? b? c?" })).toBe("high")
  })
})

describe("selectModel", () => {
  it("always uses the vision model for image tasks", () => {
    expect(selectModel("low", { prompt: "x", hasImage: true }, TIERS)).toBe("vis-m")
    expect(selectModel("high", { prompt: "x", hasImage: true }, TIERS)).toBe("vis-m")
  })

  it("forces the tier in low/high mode", () => {
    expect(selectModel("low", { prompt: "debug this" }, TIERS)).toBe("low-m")
    expect(selectModel("high", { prompt: "hi" }, TIERS)).toBe("high-m")
  })

  it("routes by complexity in auto mode", () => {
    expect(selectModel("auto", { prompt: "hi" }, TIERS)).toBe("low-m")
    expect(selectModel("auto", { prompt: "optimize this algorithm" }, TIERS)).toBe("high-m")
  })

  it("falls back across tiers when one is empty", () => {
    expect(selectModel("high", { prompt: "hi" }, { low: "low-m", high: "", vision: "vis-m" })).toBe(
      "low-m"
    )
    expect(selectModel("low", { prompt: "hi" }, { low: "", high: "high-m", vision: "vis-m" })).toBe(
      "high-m"
    )
  })
})
