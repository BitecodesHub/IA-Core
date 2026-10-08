import { describe, it, expect, vi, afterEach } from "vitest"
import {
  BedrockProvider,
  decodeEventStream,
  buildConverseBody,
  adjustForValidationError,
  buildBedrockCatalog,
  profilePrefixes,
  BEDROCK_DEFAULT_MAX_TOKENS,
} from "../electron/llm/bedrock"
import { bedrockRegionOf, bedrockControlEndpoint, BEDROCK_REGIONS } from "../electron/llm/bedrockRegions"
import { classifyModelError } from "../electron/llm/modelFit"
import { DEFAULT_SETTINGS, coerceSettings } from "../electron/config/schema"
import { formatProviderError } from "../src/lib/providerError"

const cfg = { ...DEFAULT_SETTINGS.ai.providers.bedrock, enabled: true }
const opts = { temperature: 0.7, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 1024, keepAlive: "30m" }
afterEach(() => vi.restoreAllMocks())

// --- a minimal AWS event-stream ENCODER, so the decoder is tested on real frames ---
function header(name: string, value: string): Buffer {
  const n = Buffer.from(name)
  const v = Buffer.from(value)
  const len = Buffer.alloc(2)
  len.writeUInt16BE(v.length)
  return Buffer.concat([Buffer.from([n.length]), n, Buffer.from([7]), len, v])
}
function frame(headers: Record<string, string>, payload: unknown): Buffer {
  const h = Buffer.concat(Object.entries(headers).map(([k, v]) => header(k, v)))
  const p = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
  const total = 12 + h.length + p.length + 4
  const prelude = Buffer.alloc(12)
  prelude.writeUInt32BE(total, 0)
  prelude.writeUInt32BE(h.length, 4)
  return Buffer.concat([prelude, h, p, Buffer.alloc(4)]) // CRCs are not verified
}
const ev = (type: string, payload: unknown) =>
  frame({ ":message-type": "event", ":event-type": type, ":content-type": "application/json" }, payload)
const exc = (type: string, message: string) =>
  frame({ ":message-type": "exception", ":exception-type": type }, { message })
const streamOf = (bufs: Buffer[], splitEvery = 0) => {
  const all = Buffer.concat(bufs)
  const chunks: Uint8Array[] = []
  if (splitEvery > 0) for (let i = 0; i < all.length; i += splitEvery) chunks.push(all.subarray(i, i + splitEvery))
  else chunks.push(all)
  return new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new Uint8Array(x)); c.close() } })
}
const okStream = (body: ReadableStream) => ({ ok: true, status: 200, body, headers: new Headers() }) as unknown as Response
const jsonRes = (status: number, body: unknown, errType = "") =>
  ({
    ok: status < 300, status, statusText: "", headers: new Headers(errType ? { "x-amzn-errortype": errType } : {}),
    json: async () => body, text: async () => JSON.stringify(body),
  }) as unknown as Response

describe("decodeEventStream", () => {
  it("decodes complete frames and keeps a partial tail for the next read", () => {
    const a = ev("contentBlockDelta", { delta: { text: "Hi" } })
    const b = ev("messageStop", { stopReason: "end_turn" })
    const both = Buffer.concat([a, b])
    const first = decodeEventStream(new Uint8Array(both.subarray(0, a.length + 5)))
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0].headers[":event-type"]).toBe("contentBlockDelta")
    expect(JSON.parse(new TextDecoder().decode(first.messages[0].payload)).delta.text).toBe("Hi")
    expect(first.rest.length).toBe(5)
    const second = decodeEventStream(new Uint8Array(Buffer.concat([first.rest, both.subarray(a.length + 5)])))
    expect(second.messages[0].headers[":event-type"]).toBe("messageStop")
    expect(second.rest.length).toBe(0)
  })

  it("rejects a corrupt frame instead of looping or allocating wildly", () => {
    const bad = Buffer.alloc(16)
    bad.writeUInt32BE(8, 0) // total smaller than the minimum frame
    expect(() => decodeEventStream(new Uint8Array(bad))).toThrow(/Malformed/)
  })
})

describe("buildConverseBody", () => {
  it("puts images before text with the right format, clamps temperature, keeps topP", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString("base64")
    const body = buildConverseBody(
      { model: "m", prompt: "read", stream: true, images: [png], options: { ...opts, temperature: 1.6 } },
      { includeTopP: true, maxTokens: 4096 }
    ) as any
    expect(body.messages[0].content[0]).toEqual({ image: { format: "png", source: { bytes: png } } })
    expect(body.messages[0].content[1]).toEqual({ text: "read" })
    expect(body.inferenceConfig).toEqual({ maxTokens: 4096, temperature: 1, topP: 0.9 })
  })
  it("omits topP when told to", () => {
    const body = buildConverseBody({ model: "m", prompt: "x", stream: false, options: opts }, { includeTopP: false, maxTokens: 2048 }) as any
    expect(body.inferenceConfig.topP).toBeUndefined()
  })
})

describe("adjustForValidationError", () => {
  const p = { includeTopP: true, maxTokens: 4096 }
  it("drops topP on Claude 4's temperature/top_p conflict", () => {
    const msg = "Provider API error 400: ValidationException: `temperature` and `top_p` cannot both be specified for this model. Please use only one."
    expect(adjustForValidationError(msg, p)).toEqual({ includeTopP: false, maxTokens: 4096 })
  })
  it("lowers maxTokens to the limit the model reports", () => {
    expect(adjustForValidationError("Provider API error 400: ValidationException: Malformed input request: #/max_gen_len: 4096 is not less or equal to 2048", { includeTopP: false, maxTokens: 4096 }))
      .toEqual({ includeTopP: false, maxTokens: 2048 })
    expect(adjustForValidationError("Provider API error 400: ValidationException: The maximum tokens you requested exceeds the model limit of 3000", { includeTopP: false, maxTokens: 4096 }))
      .toEqual({ includeTopP: false, maxTokens: 3000 })
  })
  it("leaves unrelated errors alone", () => {
    expect(adjustForValidationError("Provider API error 429: ThrottlingException: slow down", p)).toBeNull()
    expect(adjustForValidationError("Provider API error 400: ValidationException: The provided model identifier is invalid.", { includeTopP: false, maxTokens: 4096 })).toBeNull()
  })
})

describe("buildBedrockCatalog", () => {
  const summaries = [
    { modelId: "amazon.nova-lite-v1:0", inputModalities: ["TEXT", "IMAGE", "VIDEO"], outputModalities: ["TEXT"], inferenceTypesSupported: ["ON_DEMAND"], modelLifecycle: { status: "ACTIVE" } },
    { modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0", inputModalities: ["TEXT", "IMAGE"], outputModalities: ["TEXT"], inferenceTypesSupported: ["INFERENCE_PROFILE"], modelLifecycle: { status: "ACTIVE" } },
    { modelId: "anthropic.claude-3-haiku-20240307-v1:0", inputModalities: ["TEXT", "IMAGE"], outputModalities: ["TEXT"], inferenceTypesSupported: ["ON_DEMAND"], modelLifecycle: { status: "LEGACY" } },
    { modelId: "amazon.titan-embed-text-v2:0", inputModalities: ["TEXT"], outputModalities: ["EMBEDDING"], inferenceTypesSupported: ["ON_DEMAND"] },
    { modelId: "meta.llama3-3-70b-instruct-v1:0", inputModalities: ["TEXT"], outputModalities: ["TEXT"], inferenceTypesSupported: ["INFERENCE_PROFILE"] },
  ]
  const arn = (id: string) => `arn:aws:bedrock:ap-southeast-2::foundation-model/${id}`
  const profiles = [
    { inferenceProfileId: "global.anthropic.claude-sonnet-4-5-20250929-v1:0", status: "ACTIVE", models: [{ modelArn: arn("anthropic.claude-sonnet-4-5-20250929-v1:0") }] },
    { inferenceProfileId: "au.anthropic.claude-sonnet-4-5-20250929-v1:0", status: "ACTIVE", models: [{ modelArn: arn("anthropic.claude-sonnet-4-5-20250929-v1:0") }] },
    { inferenceProfileId: "apac.meta.llama3-3-70b-instruct-v1:0", status: "ACTIVE", models: [{ modelArn: arn("meta.llama3-3-70b-instruct-v1:0") }] },
    { inferenceProfileId: "apac.amazon.titan-embed", status: "ACTIVE", models: [{ modelArn: arn("amazon.titan-embed-text-v2:0") }] },
  ]
  const { models, profileFor } = buildBedrockCatalog(summaries, profiles, "ap-southeast-2")
  const names = models.map((m) => m.name)

  it("lists on-demand chat models and profiles, never raw profile-only ids, embeddings or legacy", () => {
    expect(names).toContain("amazon.nova-lite-v1:0")
    expect(names).toContain("au.anthropic.claude-sonnet-4-5-20250929-v1:0")
    expect(names).toContain("apac.meta.llama3-3-70b-instruct-v1:0")
    expect(names).not.toContain("anthropic.claude-sonnet-4-5-20250929-v1:0") // only via profile
    expect(names).not.toContain("anthropic.claude-3-haiku-20240307-v1:0") // LEGACY
    expect(names.some((n) => n.includes("titan-embed"))).toBe(false)
  })
  it("takes vision from the catalog's input modalities", () => {
    expect(models.find((m) => m.name === "amazon.nova-lite-v1:0")?.vision).toBe(true)
    expect(models.find((m) => m.name === "apac.meta.llama3-3-70b-instruct-v1:0")?.vision).toBe(false)
  })
  it("maps profile-only models to the most local profile (au. > apac. > global.)", () => {
    expect(profileFor.get("anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe("au.anthropic.claude-sonnet-4-5-20250929-v1:0")
    expect(profileFor.get("meta.llama3-3-70b-instruct-v1:0")).toBe("apac.meta.llama3-3-70b-instruct-v1:0")
  })
  it("prefers the right geography per region", () => {
    expect(profilePrefixes("ap-southeast-2")).toEqual(["au.", "apac.", "global."])
    expect(profilePrefixes("us-east-1")).toEqual(["us.", "global."])
    expect(profilePrefixes("eu-west-1")).toEqual(["eu.", "global."])
  })
})

describe("Bedrock error classification", () => {
  it("treats per-model access refusal as unavailable, a bad key as auth", () => {
    expect(classifyModelError("Provider API error 403: AccessDeniedException: You don't have access to the model with the specified model ID.")).toBe("unavailable")
    expect(classifyModelError("Provider API error 403: AccessDeniedException: Invalid API Key format: Delimiter ':' not found")).toBe("auth")
    expect(classifyModelError("Provider API error 403: AccessDeniedException: Bearer Token has expired")).toBe("auth")
  })
  it("treats an invalid model id as gone and the on-demand/profile mismatch as incompatible", () => {
    expect(classifyModelError("Provider API error 400: ValidationException: The provided model identifier is invalid.")).toBe("gone")
    expect(classifyModelError("Provider API error 400: ValidationException: Invocation of model ID x with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.")).toBe("incompatible")
    expect(classifyModelError("Provider API error 429: ThrottlingException: Too many requests")).toBe("ratelimit")
  })
  it("formats AWS's capitalised Message bodies", () => {
    expect(formatProviderError('All configured providers failed. Amazon Bedrock/m: Provider API error 403: {"Message":"Invalid API Key format"}')).toContain("Invalid API Key format")
  })
})

describe("Bedrock endpoint guard and regions", () => {
  it("accepts any genuine Bedrock runtime region, rejects everything else", () => {
    const coerce = (endpoint: string) =>
      coerceSettings({ version: 5, ai: { providers: { bedrock: { type: "bedrock-converse", allowRemote: true, endpoint } } } }).ai.providers.bedrock.endpoint
    expect(coerce("https://bedrock-runtime.us-east-1.amazonaws.com")).toBe("https://bedrock-runtime.us-east-1.amazonaws.com")
    expect(coerce("https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com")).toBe("https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com")
    for (const bad of [
      "https://evil.example.com",
      "https://bedrock-runtime.us-east-1.amazonaws.com.evil.io",
      "http://bedrock-runtime.us-east-1.amazonaws.com",
      "https://bedrock-runtime.us-east-1.amazonaws.com:8443",
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/x",
    ]) {
      expect(coerce(bad), bad).toBe("https://bedrock-runtime.ap-southeast-2.amazonaws.com")
    }
  })
  it("derives the control-plane host and validates every listed region", () => {
    expect(bedrockControlEndpoint("https://bedrock-runtime.ap-southeast-2.amazonaws.com")).toBe("https://bedrock.ap-southeast-2.amazonaws.com")
    for (const r of BEDROCK_REGIONS) expect(bedrockRegionOf(`https://bedrock-runtime.${r.code}.amazonaws.com`), r.code).toBe(r.code)
  })
  it("ships disabled, Sydney, Auto model slots", () => {
    expect(DEFAULT_SETTINGS.ai.providers.bedrock.enabled).toBe(false)
    expect(cfg.endpoint).toBe("https://bedrock-runtime.ap-southeast-2.amazonaws.com")
    expect([cfg.lowModel, cfg.highModel, cfg.visionModel]).toEqual(["", "", ""])
  })
})

describe("BedrockProvider over the wire", () => {
  it("streams text, reports reasoning as activity, sends bearer auth and an encoded model id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okStream(streamOf([
        ev("messageStart", { role: "assistant" }),
        ev("contentBlockDelta", { delta: { reasoningContent: { text: "thinking" } } }),
        ev("contentBlockDelta", { delta: { text: "Hel" } }),
        ev("contentBlockDelta", { delta: { text: "lo" } }),
        ev("messageStop", { stopReason: "end_turn" }),
        ev("metadata", { usage: { inputTokens: 3, outputTokens: 2 } }),
      ], 7)) // tiny chunks: every frame is split across reads
    )
    const tokens: string[] = []
    let activity = 0
    const out = await new BedrockProvider(cfg, () => "ABSK.test").generate({
      model: "amazon.nova-lite-v1:0", prompt: "hi", stream: true, options: opts,
      onToken: (t) => tokens.push(t), onActivity: () => activity++,
    })
    expect(out).toBe("Hello")
    expect(tokens).toEqual(["Hel", "lo"])
    expect(activity).toBeGreaterThan(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse-stream")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ABSK.test")
    expect(JSON.parse(init.body as string).inferenceConfig.maxTokens).toBe(BEDROCK_DEFAULT_MAX_TOKENS)
  })

  it("turns a mid-stream exception frame into a classifiable error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okStream(streamOf([exc("throttlingException", "Too many tokens, please wait")])))
    const p = new BedrockProvider(cfg, () => "k")
    const err = await p.generate({ model: "m", prompt: "hi", stream: true, options: opts }).catch((e) => e)
    expect(err.message).toBe("Provider API error 429: throttlingException: Too many tokens, please wait")
    expect(classifyModelError(err.message)).toBe("ratelimit")
  })

  it("repairs the Claude 4 top_p conflict by retrying once without topP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes(400, { message: "`temperature` and `top_p` cannot both be specified for this model." }, "ValidationException:http://internal.amazon.com/"))
      .mockResolvedValueOnce(jsonRes(200, { output: { message: { content: [{ text: "ok" }] } }, stopReason: "end_turn" }))
    const out = await new BedrockProvider(cfg, () => "k").generate({ model: "m", prompt: "hi", stream: false, options: opts })
    expect(out).toBe("ok")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).inferenceConfig.topP).toBe(0.9)
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).inferenceConfig.topP).toBeUndefined()
  })

  it("does not retry errors parameters cannot fix, and formats them for the classifier", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes(403, { Message: "You don't have access to the model with the specified model ID." }, "AccessDeniedException:http://internal.amazon.com/")
    )
    const err = await new BedrockProvider(cfg, () => "k").generate({ model: "m", prompt: "hi", stream: false, options: opts }).catch((e) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(err.message).toMatch(/^Provider API error 403: AccessDeniedException: You don't have access/)
    expect(classifyModelError(err.message)).toBe("unavailable")
  })

  it("discovers models and rewrites a profile-only model id to its regional profile", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const u = String(url)
      if (u.endsWith("/foundation-models")) {
        return jsonRes(200, { modelSummaries: [
          { modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0", inputModalities: ["TEXT", "IMAGE"], outputModalities: ["TEXT"], inferenceTypesSupported: ["INFERENCE_PROFILE"] },
        ] })
      }
      if (u.includes("/inference-profiles")) {
        return jsonRes(200, { inferenceProfileSummaries: [
          { inferenceProfileId: "au.anthropic.claude-sonnet-4-5-20250929-v1:0", status: "ACTIVE", models: [{ modelArn: "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0" }] },
        ] })
      }
      return jsonRes(200, { output: { message: { content: [{ text: "pong" }] } } })
    })
    const p = new BedrockProvider(cfg, () => "k")
    const models = await p.listModels()
    expect(models).toEqual([expect.objectContaining({ name: "au.anthropic.claude-sonnet-4-5-20250929-v1:0", vision: true })])
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://bedrock.ap-southeast-2.amazonaws.com/foundation-models")
    await p.generate({ model: "anthropic.claude-sonnet-4-5-20250929-v1:0", prompt: "hi", stream: false, options: opts })
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("/model/au.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse")
  })

  it("refuses to call without a key and reports an empty answer clearly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes(200, { output: { message: { content: [] } }, stopReason: "max_tokens" }))
    await expect(new BedrockProvider(cfg, () => null).generate({ model: "m", prompt: "x", stream: false, options: opts })).rejects.toThrow(/requires an API key/)
    expect(fetchMock).not.toHaveBeenCalled()
    const err = await new BedrockProvider(cfg, () => "k").generate({ model: "m", prompt: "x", stream: false, options: opts }).catch((e) => e)
    expect(err.message).toMatch(/400: ValidationException: maxTokens reached/)
  })
})
