import { describe, it, expect, vi, afterEach } from "vitest"
import { OpenAICompatibleProvider, OllamaProvider, isFreeModelEntry } from "../electron/llm/providers"
import type { AiProviderSettings } from "../electron/config/schema"

const ollamaConfig: AiProviderSettings = {
  id: "ollama",
  name: "Ollama",
  type: "ollama",
  enabled: true,
  endpoint: "http://localhost:11434",
  allowRemote: false,
  apiKeyRequired: false,
  lowModel: "llava",
  highModel: "",
  visionModel: "llava",
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  numCtx: 4096,
  numPredict: 1024,
  timeoutMs: 120000,
  keepAlive: "30m",
}

const baseConfig: AiProviderSettings = {
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
}

function opts() {
  return { temperature: 0.7, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 1024, keepAlive: "30m" }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () =>
            i < chunks.length
              ? { done: false, value: encoder.encode(chunks[i++]) }
              : { done: true, value: undefined },
          releaseLock() {},
        }
      },
    },
  } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe("OpenAICompatibleProvider.generate — request construction (non-streaming)", () => {
  it("POSTs to {endpoint}/chat/completions with Bearer auth + JSON content-type and correct body", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "sk-or-v1-KEY")
    const out = await p.generate({
      prompt: "hi",
      model: "anthropic/claude-sonnet-5",
      stream: false,
      options: opts(),
    })
    expect(out).toBe("ok")
    const [url, init] = fetchSpy.mock.calls[0] as [string, any]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer sk-or-v1-KEY")
    expect(init.headers["Content-Type"]).toBe("application/json")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("anthropic/claude-sonnet-5")
    expect(body.stream).toBe(false)
    // max_tokens is mapped from numPredict; Ollama-only knobs must NOT leak into the OpenAI body.
    expect(body.max_tokens).toBe(1024)
    expect("top_k" in body).toBe(false)
    expect("num_ctx" in body).toBe(false)
  })

  it("throws before any network call when a key is required but absent", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => null)
    await expect(
      p.generate({ prompt: "hi", model: "m", stream: false, options: opts() })
    ).rejects.toThrow(/API key/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("surfaces a non-2xx error body without echoing the key", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ error: { message: "invalid key" } }, false, 401))
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "sk-or-v1-SECRET")
    const err = await p
      .generate({ prompt: "hi", model: "m", stream: false, options: opts() })
      .catch((e) => e as Error)
    expect(err.message).toMatch(/401/)
    expect(err.message).toMatch(/invalid key/)
    expect(err.message).not.toContain("sk-or-v1-SECRET")
  })

  it("throws on empty content", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{}] }))
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await expect(
      p.generate({ prompt: "hi", model: "m", stream: false, options: opts() })
    ).rejects.toThrow(/No response content/)
  })

  it("maps an abort/timeout into the friendly message", async () => {
    const fetchSpy = vi.fn(async () => {
      const e = new Error("aborted")
      ;(e as any).name = "AbortError"
      throw e
    })
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await expect(
      p.generate({ prompt: "hi", model: "m", stream: false, options: opts() })
    ).rejects.toThrow(/timed out|cancelled/)
  })
})

describe("OpenAICompatibleProvider.generate — vision payload MIME sniffing", () => {
  it("labels PNG bytes as image/png (not hardcoded jpeg)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "seen" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
      "base64"
    )
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await p.generate({ prompt: "look", model: "m", stream: false, images: [pngB64], options: opts() })
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)
    const content = body.messages[0].content
    expect(content[0]).toEqual({ type: "text", text: "look" })
    expect(content[1].type).toBe("image_url")
    expect(content[1].image_url.url.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("labels JPEG bytes as image/jpeg", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "seen" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const jpgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64")
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await p.generate({ prompt: "look", model: "m", stream: false, images: [jpgB64], options: opts() })
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)
    expect(body.messages[0].content[1].image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true)
  })
})

describe("OpenAICompatibleProvider.generate — SSE streaming", () => {
  it("reassembles split frames, honors [DONE], and skips comments", async () => {
    const chunks = [
      ": openrouter processing\n",
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":',
      '"lo"}}]}\n',
      "data: [DONE]\n",
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(chunks))
    )
    const tokens: string[] = []
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const out = await p.generate({
      prompt: "hi",
      model: "m",
      stream: true,
      onToken: (t) => tokens.push(t),
      options: opts(),
    })
    expect(out).toBe("Hello")
    expect(tokens.join("")).toBe("Hello")
  })

  it("throws the real error when an error frame arrives mid-stream (HTTP 200)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(['data: {"error":{"message":"rate limited"}}\n']))
    )
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await expect(
      p.generate({ prompt: "hi", model: "m", stream: true, options: opts() })
    ).rejects.toThrow(/rate limited/)
  })
})

describe("OpenAICompatibleProvider — listModels / healthCheck", () => {
  it("flags the configured visionModel as vision-capable and authenticates the models call", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "some/text-model" }] })
    )
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const models = await p.listModels()
    expect(models.find((m) => m.name === "anthropic/claude-sonnet-5")?.vision).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0] as [string, any]
    expect(url).toBe("https://openrouter.ai/api/v1/models")
    expect(init.headers.Authorization).toBe("Bearer k")
  })

  it("healthCheck short-circuits with no network call when a key is required but missing", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => null)
    const h = await p.healthCheck()
    expect(h.ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("derives vision from architecture.input_modalities (authoritative over the name heuristic)", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "anthropic/claude-3", architecture: { input_modalities: ["text", "image"] } },
          { id: "openai/gpt-text", architecture: { input_modalities: ["text"] } },
          // Name looks vision-like (llava) but metadata says text-only → false.
          { id: "vendor/llava-mini", architecture: { input_modalities: ["text"] } },
        ],
      })
    )
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const models = await p.listModels()
    expect(models.find((m) => m.name === "anthropic/claude-3")?.vision).toBe(true)
    expect(models.find((m) => m.name === "openai/gpt-text")?.vision).toBe(false)
    expect(models.find((m) => m.name === "vendor/llava-mini")?.vision).toBe(false)
    // The full catalog is returned regardless of vision capability.
    expect(models.map((m) => m.name)).toHaveLength(3)
  })

  it("supports the legacy architecture.modality string", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ data: [{ id: "some/vlm", architecture: { modality: "text+image->text" } }] })
    )
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const models = await p.listModels()
    expect(models[0].vision).toBe(true)
  })

  it("falls back to the name/config heuristic when no modality metadata is present", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "x/llava-next" }] })
    )
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const models = await p.listModels()
    // configured visionModel matches → vision; llava name heuristic → vision.
    expect(models.find((m) => m.name === "anthropic/claude-sonnet-5")?.vision).toBe(true)
    expect(models.find((m) => m.name === "x/llava-next")?.vision).toBe(true)
  })

  it("retries discovery on a transient failure then succeeds", async () => {
    let call = 0
    const fetchSpy = vi.fn(async () => {
      call++
      if (call === 1) return jsonResponse({ error: "temporarily unavailable" }, false, 503)
      return jsonResponse({ data: [{ id: "anthropic/claude-sonnet-5" }] })
    })
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    const models = await p.listModels()
    expect(models).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2) // 1 failure + 1 retry
  })

  it("does NOT retry a terminal (401) discovery failure", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ error: "invalid key" }, false, 401))
    vi.stubGlobal("fetch", fetchSpy)
    const p = new OpenAICompatibleProvider(baseConfig, () => "k")
    await expect(p.listModels()).rejects.toThrow(/401/)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // no retry on auth failure
  })
})

describe("OpenAICompatibleProvider — OpenRouter fallback models array", () => {
  const withFallbacks: AiProviderSettings = {
    ...baseConfig,
    fallbackModels: ["anthropic/claude-opus-4.8", "openai/gpt-oss-120b"],
  }
  it("sends a `models` array (primary first, then fallbacks) when fallbackModels are configured", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    await new OpenAICompatibleProvider(withFallbacks, () => "k").generate({
      prompt: "hi", model: "anthropic/claude-sonnet-5", stream: false, options: opts(),
    })
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)
    expect(body.model).toBe("anthropic/claude-sonnet-5")
    expect(body.models).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-4.8",
      "openai/gpt-oss-120b",
    ])
  })
  it("does not duplicate the primary if it also appears in fallbackModels", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const cfg = { ...baseConfig, fallbackModels: ["anthropic/claude-sonnet-5", "openai/gpt-oss-120b"] }
    await new OpenAICompatibleProvider(cfg, () => "k").generate({
      prompt: "hi", model: "anthropic/claude-sonnet-5", stream: false, options: opts(),
    })
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)
    expect(body.models).toEqual(["anthropic/claude-sonnet-5", "openai/gpt-oss-120b"])
  })
  it("omits the `models` array entirely when no fallbacks are configured", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    await new OpenAICompatibleProvider(baseConfig, () => "k").generate({
      prompt: "hi", model: "m", stream: false, options: opts(),
    })
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)
    expect("models" in body).toBe(false)
  })
})

describe("OpenAICompatibleProvider — vision MIME sniff (GIF / WEBP / default)", () => {
  const imageUrlFor = (body: any) => body.messages[0].content[1].image_url.url
  it("labels GIF bytes as image/gif", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "seen" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]).toString("base64")
    await new OpenAICompatibleProvider(baseConfig, () => "k").generate({
      prompt: "x", model: "m", stream: false, images: [gif], options: opts(),
    })
    expect(imageUrlFor(JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)).startsWith("data:image/gif;base64,")).toBe(true)
  })
  it("labels WEBP (RIFF....WEBP) bytes as image/webp", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "seen" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]).toString("base64")
    await new OpenAICompatibleProvider(baseConfig, () => "k").generate({
      prompt: "x", model: "m", stream: false, images: [webp], options: opts(),
    })
    expect(imageUrlFor(JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)).startsWith("data:image/webp;base64,")).toBe(true)
  })
  it("defaults unknown bytes to image/jpeg", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "seen" } }] }))
    vi.stubGlobal("fetch", fetchSpy)
    const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0]).toString("base64")
    await new OpenAICompatibleProvider(baseConfig, () => "k").generate({
      prompt: "x", model: "m", stream: false, images: [unknown], options: opts(),
    })
    expect(imageUrlFor(JSON.parse((fetchSpy.mock.calls[0] as any)[1].body)).startsWith("data:image/jpeg;base64,")).toBe(true)
  })
})

describe("OllamaProvider.generate", () => {
  it("POSTs to /api/generate with RAW base64 images + keep_alive + options (no data URI)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ response: "ok" }))
    vi.stubGlobal("fetch", fetchSpy)
    const out = await new OllamaProvider(ollamaConfig).generate({
      prompt: "hi", model: "llava", stream: false, images: ["QUJD"], options: opts(),
    })
    expect(out).toBe("ok")
    const [url, init] = fetchSpy.mock.calls[0] as [string, any]
    expect(url).toBe("http://localhost:11434/api/generate")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("llava")
    expect(body.images).toEqual(["QUJD"]) // raw base64, not a data URI
    expect(body.keep_alive).toBe("30m")
    expect(body.options.num_ctx).toBe(4096)
    expect(body.options.top_k).toBe(40)
  })
  it("throws on empty non-streaming response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ response: "" })))
    await expect(
      new OllamaProvider(ollamaConfig).generate({ prompt: "hi", model: "llava", stream: false, options: opts() })
    ).rejects.toThrow(/No response content/)
  })
  it("reassembles split NDJSON stream frames and returns on {done:true}", async () => {
    const chunks = ['{"response":"Hel"}\n', '{"response":"', 'lo"}\n', '{"done":true}\n']
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(chunks)))
    const toks: string[] = []
    const out = await new OllamaProvider(ollamaConfig).generate({
      prompt: "hi", model: "llava", stream: true, onToken: (t) => toks.push(t), options: opts(),
    })
    expect(out).toBe("Hello")
    expect(toks.join("")).toBe("Hello")
  })
  it("maps abort to the friendly timeout message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("aborted"); (e as any).name = "AbortError"; throw e }))
    await expect(
      new OllamaProvider(ollamaConfig).generate({ prompt: "hi", model: "llava", stream: false, options: opts() })
    ).rejects.toThrow(/timed out|cancelled/)
  })
})

describe("OllamaProvider.refreshCapability — offline vision detection", () => {
  it("flags vision from capabilities:['vision']", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: ["vision"], details: {} })))
    expect(await new OllamaProvider(ollamaConfig).refreshCapability("some-model")).toBe(true)
  })
  it("flags vision from details.families (clip/mllama)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: [], details: { families: ["clip"] } })))
    expect(await new OllamaProvider(ollamaConfig).refreshCapability("gemma3")).toBe(true)
  })
  it("falls back to heuristicVision when /api/show is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 404)))
    const p = new OllamaProvider(ollamaConfig)
    expect(await p.refreshCapability("llava")).toBe(true)
    expect(await p.refreshCapability("mistral")).toBe(false)
  })
})

describe("isFreeModelEntry", () => {
  it("detects the OpenRouter ':free' id suffix", () => {
    expect(isFreeModelEntry("meta-llama/llama-3.3-70b-instruct:free", {})).toBe(true)
  })

  it("detects zero prompt+completion pricing", () => {
    expect(isFreeModelEntry("some/model", { pricing: { prompt: "0", completion: "0" } })).toBe(true)
  })

  it("rejects paid, partial-zero, and sentinel '-1' pricing", () => {
    expect(isFreeModelEntry("some/model", { pricing: { prompt: "0.000001", completion: "0" } })).toBe(false)
    expect(isFreeModelEntry("some/model", { pricing: { prompt: "0" } })).toBe(false)
    expect(isFreeModelEntry("openrouter/auto", { pricing: { prompt: "-1", completion: "-1" } })).toBe(false)
  })

  it("stays false for catalogs without pricing metadata (vanilla OpenAI, LM Studio)", () => {
    expect(isFreeModelEntry("gpt-4o", {})).toBe(false)
    expect(isFreeModelEntry("gpt-4o", { pricing: null })).toBe(false)
  })
})
