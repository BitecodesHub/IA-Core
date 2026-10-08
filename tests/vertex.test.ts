import { describe, it, expect, vi, afterEach } from "vitest"
import { VertexGeminiProvider, VERTEX_GEMINI_MODELS } from "../electron/llm/vertex"
import { DEFAULT_SETTINGS, PINNED_PROVIDER_ENDPOINTS, coerceSettings } from "../electron/config/schema"
import { classifyModelError } from "../electron/llm/modelFit"

const cfg = { ...DEFAULT_SETTINGS.ai.providers.vertex, enabled: true }
const opts = { temperature: 0.2, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 1024, keepAlive: "30m" }
const sse = (chunks: string[]) => {
  const enc = new TextEncoder()
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close() } })
}
afterEach(() => vi.restoreAllMocks())

describe("Vertex provider definition", () => {
  it("ships disabled, Sydney-pinned, Gemini 2.5 Flash by default", () => {
    expect(cfg.type).toBe("vertex-gemini")
    expect(DEFAULT_SETTINGS.ai.providers.vertex.enabled).toBe(false)
    expect(cfg.endpoint).toBe("https://australia-southeast1-aiplatform.googleapis.com/v1")
    expect(PINNED_PROVIDER_ENDPOINTS.vertex).toBe(cfg.endpoint)
    expect([cfg.lowModel, cfg.highModel, cfg.visionModel]).toEqual(["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash"])
  })
  it("survives coercion with its type and pinned endpoint", () => {
    const s = coerceSettings({ version: 5, ai: { providers: { vertex: { endpoint: "https://evil.example/v1", type: "vertex-gemini" } } } })
    expect(s.ai.providers.vertex.type).toBe("vertex-gemini")
    expect(s.ai.providers.vertex.endpoint).toBe(PINNED_PROVIDER_ENDPOINTS.vertex)
  })
})

describe("VertexGeminiProvider requests", () => {
  it("sends native Gemini SSE with the key in x-goog-api-key and images as inline_data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200,
      body: sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"thinking","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}]}\n\n',
      ]),
    } as unknown as Response)
    const tokens: string[] = []
    let activity = 0
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString("base64")
    const out = await new VertexGeminiProvider(cfg, () => "AQ.test").generate({
      model: "gemini-2.5-flash", prompt: "hi", stream: true, images: [jpeg], options: opts,
      onToken: (t) => tokens.push(t), onActivity: () => activity++,
    })
    expect(out).toBe("Hello") // thought parts are not part of the answer
    expect(tokens).toEqual(["Hel", "lo"])
    expect(activity).toBeGreaterThan(0)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://australia-southeast1-aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse")
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AQ.test")
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: jpeg } })
    // Thinking tokens count against the cap; a 1024 cap could return nothing.
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192)
  })

  it("reports HTTP errors in the shared format so fallback classifies them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 404, text: async () => "<html>404</html>" } as unknown as Response)
    const p = new VertexGeminiProvider(cfg, () => "AQ.test")
    await expect(p.generate({ model: "gemini-old", prompt: "hi", stream: false, options: opts })).rejects.toThrow(/Provider API error 404/)
    expect(classifyModelError("Provider API error 404: Not Found")).toBe("gone")
  })

  it("refuses to call without a key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    await expect(new VertexGeminiProvider(cfg, () => null).generate({ model: "m", prompt: "hi", stream: false, options: opts })).rejects.toThrow(/requires an API key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("health-checks with free countTokens, and lists vision-capable Gemini models", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ totalTokens: 1 }) } as unknown as Response)
    const h = await new VertexGeminiProvider(cfg, () => "AQ.test").healthCheck()
    expect(h.ok).toBe(true)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/gemini-2\.5-flash:countTokens$/)
    const models = await new VertexGeminiProvider(cfg, () => "k").listModels()
    expect(models.map((m) => m.name)).toEqual([...VERTEX_GEMINI_MODELS])
    expect(models.every((m) => m.vision)).toBe(true)
  })
})
