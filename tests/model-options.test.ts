import { describe, it, expect } from "vitest"
import {
  buildModelOptions,
  rankModelCapability,
  filterOptions,
  capOptions,
  autoHintForSlot,
  matchesSetting,
  rankFreeModel,
  type ModelLike,
} from "../src/lib/modelOptions"

const M = (name: string, vision = false): ModelLike => ({ name, vision })
const F = (name: string, vision = false): ModelLike => ({ name, vision, free: true })

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

  it("floats free models above paid ones, keeping the free flag on the options", () => {
    const opts = buildModelOptions(
      [M("openai/gpt-4o"), F("meta/llama-3.3-70b:free"), M("anthropic/claude"), F("z/other:free")],
      { value: "" }
    )
    const models = opts.filter((o) => o.kind === "model")
    expect(models.map((o) => o.value)).toEqual([
      "meta/llama-3.3-70b:free", // curated family (llama-3.3) ranks above unknown
      "z/other:free",
      "openai/gpt-4o", // paid models keep discovery order after the free group
      "anthropic/claude",
    ])
    expect(models[0].free).toBe(true)
    expect(models[2].free).toBeFalsy()
  })

  it("orders the free group by curated family rank, then alphabetically", () => {
    const opts = buildModelOptions(
      [F("z/unknown-b:free"), F("a/unknown-a:free"), F("deepseek/deepseek-r1:free")],
      { value: "" }
    )
    expect(opts.filter((o) => o.kind === "model").map((o) => o.value)).toEqual([
      "deepseek/deepseek-r1:free",
      "a/unknown-a:free",
      "z/unknown-b:free",
    ])
  })
})

describe("rankFreeModel", () => {
  it("ranks known-strong families above unknown names", () => {
    expect(rankFreeModel("deepseek/deepseek-r1:free")).toBeLessThan(
      rankFreeModel("someorg/wildcard-9b:free")
    )
    expect(rankFreeModel("meta-llama/llama-3.3-70b-instruct:free")).toBeLessThan(
      rankFreeModel("someorg/wildcard-9b:free")
    )
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


describe("buildModelOptions — vision slot when no model is flagged vision", () => {
  // The NVIDIA bug: discovery flagged every model non-vision, so a strict
  // vision filter left only "Auto" and the user could not pick anything.
  const models = [
    { name: "meta/llama-4-maverick-17b-128e-instruct", vision: false },
    { name: "qwen/qwen2.5-coder-32b-instruct", vision: false },
  ]

  it("falls back to the full list instead of showing only Auto", () => {
    const opts = buildModelOptions(models, { value: "", visionOnly: true })
    const values = opts.map((o) => o.value)
    expect(values).toContain("meta/llama-4-maverick-17b-128e-instruct")
    expect(values).toContain("qwen/qwen2.5-coder-32b-instruct")
    // Still has Auto first.
    expect(opts[0].kind).toBe("auto")
  })

  it("still restricts to vision models when at least one is flagged", () => {
    const withVision = [
      { name: "vision-model", vision: true },
      { name: "text-model", vision: false },
    ]
    const values = buildModelOptions(withVision, { value: "", visionOnly: true }).map((o) => o.value)
    expect(values).toContain("vision-model")
    expect(values).not.toContain("text-model")
  })
})


describe("rankModelCapability — most capable first", () => {
  const sortNames = (names: string[]) =>
    [...names].sort((a, b) => rankModelCapability(a) - rankModelCapability(b) || a.localeCompare(b))

  it("ranks frontier families above mid-tier regardless of size token", () => {
    const order = sortNames([
      "meta/llama-3.1-8b-instruct",
      "deepseek-ai/deepseek-r1",
      "meta/llama-4-maverick-17b-128e-instruct",
      "qwen/qwen2.5-7b-instruct",
    ])
    // Tier-0 (deepseek-r1, llama-4 maverick) must precede tier-1/2 regardless of
    // their smaller parameter tokens.
    expect(order.slice(0, 2).sort()).toEqual(
      ["deepseek-ai/deepseek-r1", "meta/llama-4-maverick-17b-128e-instruct"].sort()
    )
    expect(order[order.length - 1]).toBe("meta/llama-3.1-8b-instruct")
  })

  it("prefers the larger model within the same tier", () => {
    const order = sortNames([
      "meta/llama-3.1-8b-instruct",
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.1-405b-instruct",
    ])
    expect(order).toEqual([
      "meta/llama-3.1-405b-instruct",
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.1-8b-instruct",
    ])
  })

  it("does not treat an expert count (128e) as a parameter size", () => {
    // 17b is the real size; 128e must not inflate it.
    expect(rankModelCapability("meta/llama-4-scout-17b-16e-instruct")).toBeLessThan(
      rankModelCapability("some-unknown-model")
    )
  })

  it("orders a mixed catalog best-first through buildModelOptions", () => {
    const models = [
      { name: "qwen/qwen2.5-7b-instruct", vision: false },
      { name: "deepseek-ai/deepseek-r1", vision: false },
      { name: "meta/llama-3.1-8b-instruct", vision: false },
      { name: "meta/llama-4-maverick-17b-128e-instruct", vision: false },
    ]
    const values = buildModelOptions(models, { value: "" })
      .filter((o) => o.kind === "model")
      .map((o) => o.value)
    // deepseek-r1 and llama-4 (tier 0) lead; llama-3.1-8b (tier 2) trails.
    expect(values[values.length - 1]).toBe("meta/llama-3.1-8b-instruct")
    expect(values.slice(0, 2)).toContain("deepseek-ai/deepseek-r1")
    expect(values.slice(0, 2)).toContain("meta/llama-4-maverick-17b-128e-instruct")
  })

  it("keeps free models grouped ahead of paid, each ranked within", () => {
    const models = [
      { name: "paid-big", vision: false, free: false },
      { name: "deepseek-r1-free", vision: false, free: true },
      { name: "llama-3.1-8b-free", vision: false, free: true },
    ]
    const values = buildModelOptions(models, { value: "" })
      .filter((o) => o.kind === "model")
      .map((o) => o.value)
    // Free group first; within it the stronger (deepseek-r1) ranks above the weaker.
    expect(values[0]).toBe("deepseek-r1-free")
    expect(values[1]).toBe("llama-3.1-8b-free")
    expect(values[2]).toBe("paid-big")
  })
})
