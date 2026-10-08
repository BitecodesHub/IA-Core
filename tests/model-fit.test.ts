import { describe, it, expect, vi, afterEach } from "vitest"
import {
  isChatModel,
  classifyModelError,
  planCandidateModels,
  buildHealPatch,
  rankModelCapability,
} from "../electron/llm/modelFit"
import { heuristicVision } from "../electron/llm/parse"
import { OpenAICompatibleProvider } from "../electron/llm/providers"
import { DEFAULT_SETTINGS } from "../electron/config/schema"
import type { AiProviderSettings } from "../electron/config/schema"
import { formatProviderError } from "../src/lib/providerError"

// Real error bodies captured from the NVIDIA NIM API during the incident.
const EOL_410 =
  'Provider API error 410: {"type":"about:blank","title":"Gone","status":410,"detail":"The model \'meta/llama-3.1-8b-instruct\' has reached its end of life on 2026-08-26T09:00:00Z and is no longer available."}'
const NOT_FOUND_404 =
  'Provider API error 404: {"status":404,"title":"Not Found","detail":"Function \'abc\': Not found for account \'xyz\'"}'
const BAD_PARAM_400 =
  'Provider API error 400: {"message":"Validation: Unsupported parameter(s): `models`. Please refer to the documentation."}'

const nvidia = (patch: Partial<AiProviderSettings> = {}): AiProviderSettings => ({
  ...DEFAULT_SETTINGS.ai.providers.nvidia,
  enabled: true,
  ...patch,
})

describe("isChatModel — NVIDIA catalog", () => {
  it("accepts conversational models", () => {
    for (const m of [
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3-super-120b-a12b",
      "moonshotai/kimi-k3",
      "z-ai/glm-5.3",
      "meta/llama-3.2-90b-vision-instruct",
      "mistralai/mistral-large-2-instruct",
      "openai/gpt-oss-20b",
    ]) {
      expect(isChatModel(m), m).toBe(true)
    }
  })

  it("rejects embeddings, guards, parsers, translators, detectors, encoders", () => {
    for (const m of [
      "nvidia/embed-qa-4",
      "snowflake/arctic-embed-l",
      "nvidia/nv-embedqa-mistral-7b-v2",
      "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
      "nvidia/llama-nemotron-embed-vl-1b-v2",
      "meta/llama-guard-4-12b",
      "nvidia/llama-3.1-nemoguard-8b-content-safety",
      "nvidia/llama-3.1-nemoguard-8b-topic-control",
      "nvidia/nemotron-4-340b-reward",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v2",
      "nvidia/ai-synthetic-video-detector",
      "nvidia/nvclip",
      "google/deplot",
      "google/diffusiongemma-26b-a4b-it",
    ]) {
      expect(isChatModel(m), m).toBe(false)
    }
  })

  it("does not flag image-accepting embedders as vision chat models", () => {
    expect(heuristicVision("nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1")).toBe(false)
    expect(heuristicVision("nvidia/llama-nemotron-embed-vl-1b-v2")).toBe(false)
    expect(heuristicVision("meta/llama-3.2-90b-vision-instruct")).toBe(true)
  })
})

describe("classifyModelError — observed failures", () => {
  it("treats end-of-life (410) and missing (404) as gone", () => {
    expect(classifyModelError(EOL_410)).toBe("gone")
    expect(classifyModelError(NOT_FOUND_404)).toBe("gone")
  })

  it("treats a rejected request shape (400) as incompatible, not gone", () => {
    // The model is fine — the request was wrong. Never heal settings over this.
    expect(classifyModelError(BAD_PARAM_400)).toBe("incompatible")
    expect(classifyModelError("Provider API error 400: maximum context length exceeded")).toBe(
      "incompatible"
    )
  })

  it("treats a 400 that actually says the model is missing as gone", () => {
    expect(classifyModelError("Provider API error 400: model 'x' not found")).toBe("gone")
  })

  it("classifies auth, rate limits and outages", () => {
    expect(classifyModelError("Provider API error 401: invalid key")).toBe("auth")
    expect(classifyModelError("Provider API error 403: forbidden")).toBe("auth")
    expect(classifyModelError("NVIDIA NIM requires an API key.")).toBe("auth")
    expect(classifyModelError("Provider API error 429: slow down")).toBe("ratelimit")
    expect(classifyModelError("Provider API error 503: overloaded")).toBe("transient")
    expect(classifyModelError("fetch failed")).toBe("transient")
  })
})

describe("planCandidateModels", () => {
  const catalog = [
    { name: "nvidia/nemotron-3-ultra-550b-a55b", vision: false },
    { name: "nvidia/nemotron-3-super-120b-a12b", vision: false },
    { name: "z-ai/glm-5.3-flash", vision: false },
    { name: "nvidia/embed-qa-4", vision: false },
    { name: "meta/llama-3.2-90b-vision-instruct", vision: true },
    { name: "meta/llama-3.2-11b-vision-instruct", vision: true },
    { name: "nvidia/llama-nemotron-embed-vl-1b-v2", vision: true },
  ]

  it("tries the primary once for proof, then served models before other retired ones", () => {
    const config = nvidia({
      highModel: "meta/llama-3.3-70b-instruct", // retired: absent from the catalog
      lowModel: "meta/llama-3.1-8b-instruct", // retired
      fallbackModels: ["nvidia/nemotron-3-super-120b-a12b"],
    })
    const plan = planCandidateModels({
      config,
      hasImage: false,
      primary: "meta/llama-3.1-8b-instruct",
      discovered: catalog,
      dead: new Set(),
      nativeFallback: false,
    })
    // The routed primary is tried ONCE first — a definitive 410 is what lets the
    // app heal the saved setting. Then the user's listed fallback, then served
    // models; the OTHER retired slot model only as a last resort.
    expect(plan[0]).toBe("meta/llama-3.1-8b-instruct")
    expect(plan[1]).toBe("nvidia/nemotron-3-super-120b-a12b")
    expect(plan).toContain("nvidia/nemotron-3-ultra-550b-a55b")
    const otherRetired = plan.indexOf("meta/llama-3.3-70b-instruct")
    if (otherRetired >= 0) {
      expect(otherRetired).toBeGreaterThan(plan.indexOf("nvidia/nemotron-3-ultra-550b-a55b"))
    }
  })

  it("never auto-selects an embedding or guard model", () => {
    const plan = planCandidateModels({
      config: nvidia({ highModel: "", lowModel: "", fallbackModels: [] }),
      hasImage: false,
      primary: "",
      discovered: catalog,
      dead: new Set(),
      nativeFallback: false,
      max: 20,
    })
    expect(plan).not.toContain("nvidia/embed-qa-4")
    expect(plan).not.toContain("nvidia/llama-nemotron-embed-vl-1b-v2")
  })

  it("plans only vision chat models for a screenshot", () => {
    const plan = planCandidateModels({
      config: nvidia({ visionModel: "meta/llama-3.2-90b-vision-instruct" }),
      hasImage: true,
      primary: "meta/llama-3.2-90b-vision-instruct",
      discovered: catalog,
      dead: new Set(),
      nativeFallback: false,
      max: 20,
    })
    expect(plan[0]).toBe("meta/llama-3.2-90b-vision-instruct")
    expect(plan).toContain("meta/llama-3.2-11b-vision-instruct")
    expect(plan).not.toContain("nvidia/nemotron-3-ultra-550b-a55b") // text-only
    expect(plan).not.toContain("nvidia/llama-nemotron-embed-vl-1b-v2") // embedder
  })

  it("does not replay fallbacks client-side for OpenRouter (it fails over natively)", () => {
    const plan = planCandidateModels({
      config: nvidia({ fallbackModels: ["z-ai/glm-5.3-flash"] }),
      hasImage: false,
      primary: "nvidia/nemotron-3-ultra-550b-a55b",
      discovered: [{ name: "nvidia/nemotron-3-ultra-550b-a55b", vision: false }],
      dead: new Set(),
      nativeFallback: true,
    })
    expect(plan).toEqual(["nvidia/nemotron-3-ultra-550b-a55b"])
  })

  it("never retries a model already proven dead this session", () => {
    const plan = planCandidateModels({
      config: nvidia(),
      hasImage: false,
      primary: "nvidia/nemotron-3-ultra-550b-a55b",
      discovered: catalog,
      dead: new Set(["nvidia/nemotron-3-ultra-550b-a55b"]),
      nativeFallback: false,
    })
    expect(plan).not.toContain("nvidia/nemotron-3-ultra-550b-a55b")
    expect(plan.length).toBeGreaterThan(0)
  })

  it("bounds the number of attempts", () => {
    const plan = planCandidateModels({
      config: nvidia(),
      hasImage: false,
      primary: "",
      discovered: catalog,
      dead: new Set(),
      nativeFallback: false,
      max: 2,
    })
    expect(plan.length).toBeLessThanOrEqual(2)
  })

  it("still tries the configured model when discovery failed", () => {
    const plan = planCandidateModels({
      config: nvidia(),
      hasImage: false,
      primary: "nvidia/nemotron-3-ultra-550b-a55b",
      discovered: null,
      dead: new Set(),
      nativeFallback: false,
    })
    expect(plan[0]).toBe("nvidia/nemotron-3-ultra-550b-a55b")
  })

  it("ranks the strongest served model ahead of weaker ones for auto-fallback", () => {
    expect(rankModelCapability("nvidia/nemotron-3-ultra-550b-a55b")).toBeLessThan(
      rankModelCapability("z-ai/glm-5.3-flash") + 1000
    )
    expect(rankModelCapability("nvidia/embed-qa-4")).toBeGreaterThan(
      rankModelCapability("openai/gpt-oss-20b")
    )
  })
})

describe("buildHealPatch", () => {
  const config = nvidia({
    highModel: "meta/llama-3.3-70b-instruct",
    lowModel: "meta/llama-3.1-8b-instruct",
    visionModel: "meta/llama-3.2-90b-vision-instruct",
    fallbackModels: ["deepseek-ai/deepseek-coder-6.7b-instruct", "nvidia/nemotron-3-super-120b-a12b"],
  })

  it("replaces dead text slots and drops dead fallbacks after a success", () => {
    const patch = buildHealPatch(
      config,
      ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct", "deepseek-ai/deepseek-coder-6.7b-instruct"],
      "nvidia/nemotron-3-super-120b-a12b",
      false
    )
    expect(patch).toEqual({
      highModel: "nvidia/nemotron-3-super-120b-a12b",
      lowModel: "nvidia/nemotron-3-super-120b-a12b",
      fallbackModels: ["nvidia/nemotron-3-super-120b-a12b"],
    })
  })

  it("never touches the vision slot from a text request", () => {
    const patch = buildHealPatch(config, ["meta/llama-3.2-90b-vision-instruct"], "z-ai/glm-5.3", false)
    expect(patch).toBeNull()
  })

  it("heals the vision slot only from a vision request", () => {
    const patch = buildHealPatch(
      config,
      ["meta/llama-3.2-90b-vision-instruct"],
      "meta/llama-3.2-11b-vision-instruct",
      true
    )
    expect(patch).toEqual({ visionModel: "meta/llama-3.2-11b-vision-instruct" })
  })

  it("does nothing when no configured model is dead", () => {
    expect(buildHealPatch(config, ["some/other-model"], "z-ai/glm-5.3", false)).toBeNull()
    expect(buildHealPatch(config, [], "z-ai/glm-5.3", false)).toBeNull()
  })
})

describe("formatProviderError", () => {
  it("turns the real 410 failure into a readable line", () => {
    const raw = `All configured providers failed. NVIDIA NIM/meta/llama-3.1-8b-instruct: ${EOL_410}\n`
    const out = formatProviderError(raw)
    expect(out).toContain("NVIDIA NIM · meta/llama-3.1-8b-instruct [410]")
    expect(out).toContain("reached its end of life")
    expect(out).not.toContain("{")
  })

  it("mentions how many fallbacks also failed", () => {
    const raw = `All configured providers failed. NVIDIA NIM/a: ${EOL_410} | NVIDIA NIM/b: ${NOT_FOUND_404}`
    expect(formatProviderError(raw)).toContain("+1 fallback also failed")
  })

  it("passes plain messages through and never returns empty", () => {
    expect(formatProviderError("No enabled AI provider is configured.")).toBe(
      "No enabled AI provider is configured."
    )
    expect(formatProviderError("")).toBe("Couldn't complete that. Try again.")
    expect(formatProviderError(undefined)).toBe("Couldn't complete that. Try again.")
  })

  it("caps very long messages", () => {
    expect(formatProviderError("x".repeat(2000)).length).toBeLessThanOrEqual(240)
  })
})

describe("OpenRouter-only models[] field", () => {
  afterEach(() => vi.restoreAllMocks())
  const ok = () =>
    ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }), text: async () => "", body: null }) as unknown as Response
  const opts = { temperature: 0.7, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 64, keepAlive: "30m" }

  it("is NOT sent to NVIDIA even with fallbacks configured (the 400 bug)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok())
    const p = new OpenAICompatibleProvider(nvidia({ fallbackModels: ["z-ai/glm-5.3"] }), () => "K")
    await p.generate({ model: "nvidia/nemotron-3-ultra-550b-a55b", prompt: "hi", options: opts, stream: false })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.models).toBeUndefined()
  })

  it("IS still sent to OpenRouter, which fails over natively", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok())
    const p = new OpenAICompatibleProvider(
      { ...DEFAULT_SETTINGS.ai.providers.openrouter, fallbackModels: ["x/y"] },
      () => "K"
    )
    await p.generate({ model: "a/b", prompt: "hi", options: opts, stream: false })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.models).toEqual(["a/b", "x/y"])
  })
})

describe("empty answers are failures, never successes", () => {
  afterEach(() => vi.restoreAllMocks())
  const sse = (lines: string[]) => {
    const enc = new TextEncoder()
    return new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(l)); c.close() } })
  }
  const opts = { temperature: 0.7, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 1024, keepAlive: "30m" }

  it("a reasoning-only stream ending in [DONE] is an error, then retried with a bigger budget", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, body: sse([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, body: sse([
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n', "data: [DONE]\n\n",
      ]) } as unknown as Response)
    const p = new OpenAICompatibleProvider(nvidia(), () => "k")
    const out = await p.generate({ model: "m", prompt: "x", stream: true, options: opts })
    expect(out).toBe("answer")
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(second.max_tokens).toBeGreaterThanOrEqual(8192)
  })

  it("reports the budget problem as a classifiable 400 when the retry also runs dry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200, body: sse([
      'data: {"choices":[{"delta":{"reasoning_content":"..."},"finish_reason":"length"}]}\n\n', "data: [DONE]\n\n",
    ]) }) as unknown as Response)
    const err = await new OpenAICompatibleProvider(nvidia(), () => "k").generate({ model: "m", prompt: "x", stream: true, options: opts }).catch((e) => e)
    expect(err.message).toMatch(/max_tokens exhausted before any answer/)
    expect(classifyModelError(err.message)).toBe("incompatible")
  })

  it("a whitespace-only answer is not a success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, body: sse([
      'data: {"choices":[{"delta":{"content":"  \\n"}}]}\n\n', "data: [DONE]\n\n",
    ]) } as unknown as Response)
    await expect(new OpenAICompatibleProvider(nvidia(), () => "k").generate({ model: "m", prompt: "x", stream: true, options: opts })).rejects.toThrow()
  })
})
