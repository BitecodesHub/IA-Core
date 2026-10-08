import { describe, it, expect, vi, afterEach } from "vitest"
import { visionFromModality, isUsableCatalogEntry, heuristicVision } from "../electron/llm/parse"
import { classifyModelError } from "../electron/llm/modelFit"
import { OpenAICompatibleProvider } from "../electron/llm/providers"
import { DEFAULT_SETTINGS, PINNED_PROVIDER_ENDPOINTS, coerceSettings } from "../electron/config/schema"

// Shapes captured from the live Sharon AI (TokenVisor) /api/v1/models response.
const DEEPSEEK = { id: "deepseek-ai/DeepSeek-V4-Flash-0731", type: "llm", capabilities: ["chat", "tool", "reasoning"], expiration_date: null }
const GPT_OSS = { id: "shared-gpt-oss-120b", type: "llm", capabilities: ["chat", "tool", "reasoning", "image"], expiration_date: null }

describe("Sharon AI provider definition", () => {
  const p = DEFAULT_SETTINGS.ai.providers.sharonai
  it("ships disabled, key-required, OpenAI-compatible, pinned", () => {
    expect(p.type).toBe("openai-compatible")
    expect(p.enabled).toBe(false)
    expect(p.apiKeyRequired).toBe(true)
    expect(p.allowRemote).toBe(true)
    expect(PINNED_PROVIDER_ENDPOINTS.sharonai).toBe("https://inference.sharonai.cloud/api/v1")
  })
  it("rejects endpoint tampering", () => {
    const s = coerceSettings({ version: 5, ai: { providers: { sharonai: { endpoint: "https://evil.example/v1" } } } })
    expect(s.ai.providers.sharonai.endpoint).toBe("https://inference.sharonai.cloud/api/v1")
  })
})

describe("TokenVisor catalog metadata", () => {
  it("reads vision from the flat capabilities list", () => {
    expect(visionFromModality(GPT_OSS)).toBe(true)
    expect(visionFromModality(DEEPSEEK)).toBe(false)
  })
  it("drops expired and non-LLM entries", () => {
    expect(isUsableCatalogEntry(DEEPSEEK)).toBe(true)
    expect(isUsableCatalogEntry({ ...DEEPSEEK, expiration_date: "2020-01-01T00:00:00Z" })).toBe(false)
    expect(isUsableCatalogEntry({ ...DEEPSEEK, expiration_date: "2999-01-01T00:00:00Z" })).toBe(true)
    expect(isUsableCatalogEntry({ ...DEEPSEEK, type: "embedding" })).toBe(false)
    // Entries without TokenVisor metadata (OpenAI/OpenRouter/NVIDIA) are kept.
    expect(isUsableCatalogEntry({ id: "x", object: "model" })).toBe(true)
  })
  it("classifies Sharon's 'no image' rejections as incompatible, not dead", () => {
    expect(classifyModelError('Provider API error 422: {"message":"Model \\"deepseek\\" lack these capabilities: image"}')).toBe("incompatible")
    expect(classifyModelError('Provider API error 422: {"message":"litellm.BadRequestError: ... is not a multimodal model"}')).toBe("incompatible")
  })
})

describe("Sharon AI discovery through the provider", () => {
  afterEach(() => vi.restoreAllMocks())
  it("lists usable models from /api/v1/models with metadata-based vision", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => ({ object: "models.info", data: [DEEPSEEK, GPT_OSS, { ...DEEPSEEK, id: "old", expiration_date: "2020-01-01T00:00:00Z" }] }),
    } as unknown as Response)
    const p = new OpenAICompatibleProvider({ ...DEFAULT_SETTINGS.ai.providers.sharonai, enabled: true }, () => "tv-pat-x")
    const models = await p.listModels()
    expect(fetchMock.mock.calls[0][0]).toBe("https://inference.sharonai.cloud/api/v1/models")
    expect(models.map((m) => [m.name, m.vision])).toEqual([
      ["deepseek-ai/DeepSeek-V4-Flash-0731", false],
      ["shared-gpt-oss-120b", true],
    ])
  })
})

describe("activity callback", () => {
  afterEach(() => vi.restoreAllMocks())
  it("fires for reasoning-only chunks so thinking models are not treated as stuck", async () => {
    const enc = new TextEncoder()
    const chunks = [
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      "data: [DONE]\n\n",
    ]
    const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close() } })
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, body } as unknown as Response)
    const p = new OpenAICompatibleProvider({ ...DEFAULT_SETTINGS.ai.providers.sharonai, enabled: true }, () => "k")
    const events: string[] = []
    const out = await p.generate({
      model: "shared-gpt-oss-120b", prompt: "hi", stream: true,
      onToken: (t) => events.push("token:" + t), onActivity: () => events.push("activity"),
      options: { temperature: 0.2, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 64, keepAlive: "30m" },
    })
    expect(out).toBe("Hi")
    expect(events[0]).toBe("activity") // reasoning arrived before any answer token
    expect(events).toContain("token:Hi")
  })
})

it("does not treat image-accepting names as vision when metadata says otherwise", () => {
  expect(heuristicVision("deepseek-ai/DeepSeek-V4-Flash-0731")).toBe(false)
})
