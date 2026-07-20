import { describe, it, expect } from "vitest"
import {
  buildModelOptions,
  filterOptions,
  capOptions,
  autoHintForSlot,
  matchesSetting,
  type ModelLike,
} from "../src/lib/modelOptions"

const M = (name: string, vision = false): ModelLike => ({ name, vision })

describe("buildModelOptions", () => {
  it("always puts Auto first with an empty value", () => {
    const opts = buildModelOptions([M("a")], { value: "" })
    expect(opts[0]).toMatchObject({ value: "", kind: "auto" })
  })

  it("lists discovered models after Auto", () => {
    const opts = buildModelOptions([M("a"), M("b", true)], { value: "" })
    expect(opts.map((o) => o.value)).toEqual(["", "a", "b"])
    expect(opts.find((o) => o.value === "b")?.vision).toBe(true)
  })

  it("pins a configured-but-undiscovered value as '(configured)'", () => {
    const opts = buildModelOptions([M("a")], { value: "x/custom" })
    const cfg = opts.find((o) => o.kind === "configured")
    expect(cfg).toMatchObject({ value: "x/custom", label: "x/custom (configured)" })
    // Order: auto, configured, then models.
    expect(opts.map((o) => o.kind)).toEqual(["auto", "configured", "model"])
  })

  it("does not add a configured entry when the value is already discovered", () => {
    const opts = buildModelOptions([M("a")], { value: "a" })
    expect(opts.some((o) => o.kind === "configured")).toBe(false)
  })

  it("visionOnly filters models but still preserves a configured non-vision value", () => {
    const opts = buildModelOptions([M("t"), M("v", true)], { value: "t", visionOnly: true })
    // "t" is non-vision so filtered out of the list, but preserved as configured.
    expect(opts.map((o) => o.value)).toEqual(["", "t", "v"])
    expect(opts.find((o) => o.value === "t")?.kind).toBe("configured")
  })
})

describe("filterOptions", () => {
  const opts = buildModelOptions(
    [M("anthropic/claude-sonnet-5", true), M("openai/gpt-4o", true), M("meta/llama-3")],
    { value: "" }
  )

  it("returns everything for an empty query", () => {
    expect(filterOptions(opts, "  ").length).toBe(opts.length)
  })

  it("keeps Auto pinned even when it does not match the query", () => {
    const r = filterOptions(opts, "gpt")
    expect(r[0].kind).toBe("auto")
    expect(r.some((o) => o.value === "openai/gpt-4o")).toBe(true)
    expect(r.some((o) => o.value === "meta/llama-3")).toBe(false)
  })

  it("ranks prefix over word-boundary over substring", () => {
    const list = buildModelOptions(
      [M("openai/gpt"), M("x-gpt-y"), M("agptb")],
      { value: "" }
    )
    const r = filterOptions(list, "gpt").filter((o) => o.kind === "model")
    // 'x-gpt-y' has a word-boundary '-gpt'; 'openai/gpt' boundary '/gpt'; 'agptb' substring.
    expect(r[r.length - 1].value).toBe("agptb")
  })
})

describe("capOptions", () => {
  it("returns all when under the cap", () => {
    const { visible, hiddenCount } = capOptions(buildModelOptions([M("a")], { value: "" }), 100)
    expect(hiddenCount).toBe(0)
    expect(visible.length).toBe(2)
  })

  it("caps and reports the hidden count", () => {
    const many = buildModelOptions(
      Array.from({ length: 250 }, (_, i) => M(`m${i}`)),
      { value: "" }
    )
    const { visible, hiddenCount } = capOptions(many, 100)
    expect(visible.length).toBe(100)
    expect(hiddenCount).toBe(many.length - 100)
    expect(visible[0].kind).toBe("auto") // pinned option survives the cap
  })
})

describe("autoHintForSlot", () => {
  it("describes each slot distinctly", () => {
    expect(autoHintForSlot("vision")).toMatch(/vision/i)
    expect(autoHintForSlot("high")).toMatch(/strong/i)
    expect(autoHintForSlot("low")).toMatch(/fast/i)
  })
})

describe("matchesSetting", () => {
  it("matches case-insensitively and treats empty query as match-all", () => {
    expect(matchesSetting("Temperature", "temp")).toBe(true)
    expect(matchesSetting("Temperature", "")).toBe(true)
    expect(matchesSetting("Temperature", "vision")).toBe(false)
  })
})
