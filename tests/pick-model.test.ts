import { describe, it, expect } from "vitest"
import { pickModel } from "../electron/llm/pick"
import type { AiProviderSettings } from "../electron/config/schema"
import type { ModelInfo } from "../electron/llm/providers"

function cfg(over: Partial<AiProviderSettings> = {}): AiProviderSettings {
  return {
    id: "openrouter",
    name: "OpenRouter",
    type: "openai-compatible",
    enabled: true,
    endpoint: "https://openrouter.ai/api/v1",
    allowRemote: true,
    apiKeyRequired: true,
    lowModel: "anthropic/claude-sonnet-5",
    highModel: "anthropic/claude-sonnet-5",
    visionModel: "anthropic/claude-sonnet-5",
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    numCtx: 4096,
    numPredict: 1024,
    timeoutMs: 120000,
    keepAlive: "30m",
    ...over,
  }
}

function model(name: string, vision = false): ModelInfo {
  return { providerId: "openrouter", name, vision, capabilities: vision ? ["text", "vision"] : ["text"] }
}

describe("pickModel — remote provider hardening", () => {
  it("prefers the configured model over an arbitrary discovered one (no silent billable swap)", () => {
    const models = [model("some/other-a"), model("some/other-b")]
    expect(
      pickModel({ config: cfg(), hasImage: false, configured: "anthropic/claude-sonnet-5", models })
    ).toBe("anthropic/claude-sonnet-5")
  })

  it("returns the configured vision slug for a remote image task when discovery misses it", () => {
    const models = [model("some/text-only")]
    expect(
      pickModel({ config: cfg(), hasImage: true, configured: "anthropic/claude-sonnet-5", models })
    ).toBe("anthropic/claude-sonnet-5")
  })

  it("returns the discovered configured model when present", () => {
    const models = [model("anthropic/claude-sonnet-5", true)]
    expect(
      pickModel({ config: cfg(), hasImage: false, configured: "anthropic/claude-sonnet-5", models })
    ).toBe("anthropic/claude-sonnet-5")
    expect(
      pickModel({ config: cfg(), hasImage: true, configured: "anthropic/claude-sonnet-5", models })
    ).toBe("anthropic/claude-sonnet-5")
  })

  it("throws for a remote provider with no model configured or discovered", () => {
    expect(() =>
      pickModel({
        config: cfg({ visionModel: "", highModel: "", lowModel: "" }),
        hasImage: false,
        configured: "",
        models: [],
      })
    ).toThrow(/no model configured/)
  })
})

describe("pickModel — remote Auto safety (curated recommendation)", () => {
  const auto = () => cfg({ visionModel: "", highModel: "", lowModel: "" })
  const REC = "anthropic/claude-sonnet-5"

  it("resolves an empty (Auto) slot to the recommendation instead of throwing", () => {
    expect(
      pickModel({ config: auto(), hasImage: false, configured: "", models: [], recommended: REC })
    ).toBe(REC)
  })

  it("prefers the recommendation over an arbitrary discovered model for Auto", () => {
    const models = [model("some/other-a"), model("some/other-b")]
    expect(
      pickModel({ config: auto(), hasImage: false, configured: "", models, recommended: REC })
    ).toBe(REC)
  })

  it("uses the recommendation for a remote image task when no vision model is configured", () => {
    const models = [model("some/text-only")]
    expect(
      pickModel({ config: auto(), hasImage: true, configured: "", models, recommended: REC })
    ).toBe(REC)
  })

  it("still throws when Auto has neither a configured nor a recommended model", () => {
    expect(() =>
      pickModel({ config: auto(), hasImage: false, configured: "", models: [], recommended: "" })
    ).toThrow(/no model configured/)
    expect(() =>
      pickModel({ config: auto(), hasImage: true, configured: "", models: [], recommended: "" })
    ).toThrow(/no vision-capable model/)
  })

  it("still prefers an explicitly configured model over the recommendation", () => {
    const models = [model("anthropic/claude-opus-4.8", true)]
    expect(
      pickModel({
        config: cfg(),
        hasImage: false,
        configured: "anthropic/claude-opus-4.8",
        models,
        recommended: REC,
      })
    ).toBe("anthropic/claude-opus-4.8")
  })
})

describe("pickModel — Ollama permissive fallback", () => {
  const ollama = (over: Partial<AiProviderSettings> = {}) =>
    cfg({ id: "ollama", type: "ollama", visionModel: "", highModel: "", lowModel: "", ...over })

  it("falls back to the first discovered model", () => {
    expect(
      pickModel({ config: ollama(), hasImage: false, configured: "", models: [model("llama3.2"), model("qwen")] })
    ).toBe("llama3.2")
  })

  it("returns the llama3.2 default when nothing is discovered", () => {
    expect(pickModel({ config: ollama(), hasImage: false, configured: "", models: [] })).toBe("llama3.2")
  })

  it("image task uses a discovered vision model when visionModel is unset", () => {
    const models = [model("text-only"), model("llava", true)]
    expect(pickModel({ config: ollama({ visionModel: "" }), hasImage: true, configured: "", models })).toBe("llava")
  })

  it("throws when no vision-capable model is configured or discovered", () => {
    expect(() =>
      pickModel({
        config: ollama({ visionModel: "" }),
        hasImage: true,
        configured: "",
        models: [model("text-only")],
      })
    ).toThrow(/no vision-capable model/)
  })
})
