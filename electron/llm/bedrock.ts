// Amazon Bedrock provider — Bedrock API key (bearer token), Converse API.
//
// Why Converse and not Bedrock's OpenAI-compatible path: the OpenAI path only
// serves a handful of models, while Converse is Bedrock's uniform interface to
// every chat family (Anthropic Claude, Amazon Nova, Meta Llama, Mistral,
// DeepSeek, ...) including image input.
//
//   POST {runtime}/model/{modelId}/converse          JSON in / JSON out
//   POST {runtime}/model/{modelId}/converse-stream   JSON in / AWS event stream out
//   GET  {control}/foundation-models                 model catalog (+ modalities)
//   GET  {control}/inference-profiles                cross-region profiles
//   header  Authorization: Bearer <Bedrock API key>
//
// Verified 2026-10-04 that all three Bedrock endpoints accept API keys as bearer
// tokens (an invalid key is rejected by format, not by auth scheme).
//
// Bedrock-specific traps handled here, so the generic fallback never has to
// abandon a model that would work:
//  * Many newer models are invocable ONLY through an inference profile
//    ("apac.anthropic.claude-..."); calling the raw model id fails with
//    "on-demand throughput isn't supported". Discovery maps raw ids to the best
//    regional profile and requests are rewritten transparently.
//  * Claude 4.x rejects temperature and top_p together; some models reject
//    top_p entirely. A 400 about top_p retries once without it.
//  * Output-token caps differ per model (2048 for some Llama). A 400 about the
//    token limit retries once at the limit the error reports.

import type { AiProviderSettings } from "../config/schema"
import type { GenerateRequest, LlmProvider, ModelInfo, ProviderHealth } from "./providers"
import { bedrockControlEndpoint, bedrockRegionOf } from "./bedrockRegions"

// ---------------------------------------------------------------------------
// AWS event-stream decoding (application/vnd.amazon.eventstream)
// ---------------------------------------------------------------------------

export type EventStreamHeaderValue = string | number | boolean

export interface EventStreamMessage {
  headers: Record<string, EventStreamHeaderValue>
  payload: Uint8Array
}

const MAX_FRAME = 16 * 1024 * 1024

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function parseHeaders(view: DataView, bytes: Uint8Array, start: number, end: number) {
  const headers: Record<string, EventStreamHeaderValue> = {}
  const utf8 = new TextDecoder()
  let o = start
  while (o < end) {
    const nameLen = bytes[o]
    o += 1
    const name = utf8.decode(bytes.subarray(o, o + nameLen))
    o += nameLen
    const type = bytes[o]
    o += 1
    switch (type) {
      case 0:
        headers[name] = true
        break
      case 1:
        headers[name] = false
        break
      case 2:
        headers[name] = view.getInt8(o)
        o += 1
        break
      case 3:
        headers[name] = view.getInt16(o)
        o += 2
        break
      case 4:
        headers[name] = view.getInt32(o)
        o += 4
        break
      case 5:
      case 8: // int64 / timestamp (ms)
        headers[name] = Number(view.getBigInt64(o))
        o += 8
        break
      case 6: // byte array
      case 7: {
        // string
        const len = view.getUint16(o)
        o += 2
        const slice = bytes.subarray(o, o + len)
        headers[name] = type === 7 ? utf8.decode(slice) : Buffer.from(slice).toString("base64")
        o += len
        break
      }
      case 9: // uuid
        headers[name] = Buffer.from(bytes.subarray(o, o + 16)).toString("hex")
        o += 16
        break
      default:
        throw new Error(`Malformed event stream: unknown header type ${type}`)
    }
  }
  return headers
}

/**
 * Split a growing byte buffer into complete event-stream messages. Frames may
 * arrive split across network reads, so the unconsumed tail is returned as
 * `rest` for the caller to prepend to the next chunk.
 *
 * Frame: [total u32][headers-len u32][prelude crc u32][headers][payload][crc u32]
 */
export function decodeEventStream(buffer: Uint8Array): {
  messages: EventStreamMessage[]
  rest: Uint8Array
} {
  const messages: EventStreamMessage[] = []
  let offset = 0
  while (buffer.length - offset >= 12) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
    const total = view.getUint32(0)
    const headersLen = view.getUint32(4)
    if (total < 16 || total > MAX_FRAME || headersLen > total - 16) {
      throw new Error("Malformed event stream frame")
    }
    if (buffer.length - offset < total) break
    const frame = buffer.subarray(offset, offset + total)
    const frameView = new DataView(frame.buffer, frame.byteOffset, total)
    messages.push({
      headers: parseHeaders(frameView, frame, 12, 12 + headersLen),
      payload: frame.subarray(12 + headersLen, total - 4),
    })
    offset += total
  }
  return { messages, rest: buffer.subarray(offset) }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

function imageFormat(base64: string): "png" | "jpeg" | "gif" | "webp" {
  const head = Buffer.from(base64.slice(0, 24), "base64")
  if (head[0] === 0x89 && head[1] === 0x50) return "png"
  if (head[0] === 0x47 && head[1] === 0x49) return "gif"
  if (head.toString("ascii", 8, 12) === "WEBP") return "webp"
  return "jpeg"
}

/** Default output budget; reasoning models spend tokens before answering. */
export const BEDROCK_DEFAULT_MAX_TOKENS = 4096

export interface ConverseParams {
  includeTopP: boolean
  maxTokens: number
}

/** Converse request body. Images go before the text, as Anthropic recommends. */
export function buildConverseBody(request: GenerateRequest, params: ConverseParams) {
  const content: unknown[] = (request.images ?? []).map((img) => ({
    image: { format: imageFormat(img), source: { bytes: img } },
  }))
  content.push({ text: request.prompt })
  const inferenceConfig: Record<string, number> = {
    maxTokens: params.maxTokens,
    // Bedrock models take temperature in [0, 1]; the app allows up to 2.
    temperature: Math.min(Math.max(request.options.temperature, 0), 1),
  }
  if (params.includeTopP && request.options.topP > 0 && request.options.topP <= 1) {
    inferenceConfig.topP = request.options.topP
  }
  return { messages: [{ role: "user", content }], inferenceConfig }
}

/**
 * Adjust parameters after a 400 the MODEL raised about a parameter WE chose, so
 * a working model is not abandoned over a tunable. Returns null when the error
 * is not one we can fix by changing parameters.
 */
export function adjustForValidationError(
  message: string,
  current: ConverseParams
): ConverseParams | null {
  const m = message.toLowerCase()
  if (!/\b400\b/.test(m) && !/validation/.test(m)) return null
  if (current.includeTopP && /top[_ ]?p|topp/.test(m)) {
    return { ...current, includeTopP: false }
  }
  if (/max[_ ]?tokens|maxtokens|max_gen_len|max_new_tokens|maximum (?:number of )?(?:output )?tokens/.test(m)) {
    // Read limits only from the model's message: the "Provider API error 400:"
    // prefix would otherwise be mistaken for a 400-token cap.
    const detail = m.replace(/^.*?provider api error \d{3}:\s*/, "")
    const limits = (detail.match(/\d{3,6}/g) ?? [])
      .map(Number)
      .filter((n) => n >= 256 && n < current.maxTokens)
    const next = limits.length > 0 ? Math.min(...limits) : Math.min(2048, current.maxTokens - 1)
    if (next >= 256 && next < current.maxTokens) return { ...current, maxTokens: next }
  }
  return null
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const EXCEPTION_STATUS: Record<string, number> = {
  throttlingexception: 429,
  servicequotaexceededexception: 429,
  modelnotreadyexception: 429,
  serviceunavailableexception: 503,
  internalserverexception: 500,
  modelstreamerrorexception: 500,
  modelerrorexception: 500,
  modeltimeoutexception: 408,
  validationexception: 400,
  accessdeniedexception: 403,
  resourcenotfoundexception: 404,
}

/** Shared "Provider API error <status>: <Type>: <message>" shape for the classifier. */
export function bedrockError(status: number, type: string, message: string): Error {
  const kind = type.split(":")[0].trim()
  const code = status || EXCEPTION_STATUS[kind.toLowerCase()] || 500
  return new Error(`Provider API error ${code}: ${kind ? `${kind}: ` : ""}${message}`.slice(0, 700))
}

async function httpError(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "")
  let message = text
  try {
    const parsed = JSON.parse(text)
    message = String(parsed?.message ?? parsed?.Message ?? parsed?.error?.message ?? text)
  } catch {
    /* not JSON */
  }
  return bedrockError(res.status, res.headers.get("x-amzn-errortype") ?? "", message || res.statusText)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface FoundationModelSummary {
  modelId: string
  inputModalities?: string[]
  outputModalities?: string[]
  inferenceTypesSupported?: string[]
  modelLifecycle?: { status?: string }
}

interface InferenceProfileSummary {
  inferenceProfileId: string
  status?: string
  models?: { modelArn?: string }[]
}

/**
 * Raw model id -> inference profile id, per endpoint, for models that can only
 * be invoked through a profile. Module-level because LLMHelper creates a fresh
 * provider per request; discovery runs first (cached 30s), so the map is ready.
 */
const profileForModel = new Map<string, Map<string, string>>()

/**
 * Profile prefixes to prefer for a region, most local first: country-level
 * profiles keep traffic (and data) closest, then the geography, then global.
 */
export function profilePrefixes(region: string): string[] {
  const country: Record<string, string> = {
    "ap-southeast-2": "au.",
    "ap-southeast-4": "au.",
    "ap-northeast-1": "jp.",
    "ap-northeast-3": "jp.",
  }
  const geo = region.startsWith("ap-")
    ? "apac."
    : region.startsWith("us-gov-")
      ? "us-gov."
      : region.startsWith("us-")
        ? "us."
        : region.startsWith("eu-")
          ? "eu."
          : region.startsWith("ca-")
            ? "ca."
            : ""
  return [country[region], geo, "global."].filter((p): p is string => Boolean(p))
}

function modelIdFromArn(arn: string | undefined): string | null {
  const m = String(arn ?? "").match(/foundation-model\/(.+)$/)
  return m ? m[1] : null
}

/**
 * Build the usable chat-model list from the two catalog calls. Pure, so the
 * mapping rules are unit-testable.
 */
export function buildBedrockCatalog(
  summaries: FoundationModelSummary[],
  profiles: InferenceProfileSummary[],
  region: string
): { models: { name: string; vision: boolean }[]; profileFor: Map<string, string> } {
  const isChat = (s: FoundationModelSummary) =>
    (s.outputModalities ?? []).includes("TEXT") &&
    (s.inputModalities ?? ["TEXT"]).includes("TEXT") &&
    (s.modelLifecycle?.status ?? "ACTIVE") === "ACTIVE"
  const byId = new Map(summaries.map((s) => [s.modelId, s]))
  const vision = (s: FoundationModelSummary) => (s.inputModalities ?? []).includes("IMAGE")

  const models: { name: string; vision: boolean }[] = []
  const seen = new Set<string>()
  const add = (name: string, v: boolean) => {
    if (!seen.has(name)) {
      seen.add(name)
      models.push({ name, vision: v })
    }
  }

  // Models invocable directly.
  for (const s of summaries) {
    if (isChat(s) && (s.inferenceTypesSupported ?? []).includes("ON_DEMAND")) add(s.modelId, vision(s))
  }

  // Inference profiles whose underlying model is a current chat model.
  const prefixes = profilePrefixes(region)
  const profileFor = new Map<string, string>()
  const rank = (id: string) => {
    const i = prefixes.findIndex((p) => id.startsWith(p))
    return i < 0 ? prefixes.length : i
  }
  for (const p of profiles) {
    if ((p.status ?? "ACTIVE") !== "ACTIVE") continue
    const underlying = (p.models ?? []).map((m) => modelIdFromArn(m.modelArn)).find((id) => id && byId.has(id))
    const summary = underlying ? byId.get(underlying) : undefined
    if (!summary || !isChat(summary)) continue
    add(p.inferenceProfileId, vision(summary))
    const current = profileFor.get(summary.modelId)
    if (!current || rank(p.inferenceProfileId) < rank(current)) {
      profileFor.set(summary.modelId, p.inferenceProfileId)
    }
  }
  return { models, profileFor }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class BedrockProvider implements LlmProvider {
  constructor(
    readonly config: AiProviderSettings,
    private readonly getApiKey: () => string | null
  ) {}

  private headers(json = true): Record<string, string> {
    const key = this.getApiKey()
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    }
  }

  private get region(): string {
    return bedrockRegionOf(this.config.endpoint) ?? "ap-southeast-2"
  }

  private async getJson(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: this.headers(false),
      signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 30_000)),
    })
    if (!res.ok) throw await httpError(res)
    return res.json()
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.getApiKey()) throw new Error(`${this.config.name} requires an API key.`)
    const control = bedrockControlEndpoint(this.config.endpoint)
    const fm = await this.getJson(`${control}/foundation-models`)
    // Profiles are optional: a key without ListInferenceProfiles permission
    // still gets every on-demand model.
    const profiles: InferenceProfileSummary[] = []
    try {
      let next: string | undefined
      for (let page = 0; page < 5; page++) {
        const qs = new URLSearchParams({ maxResults: "1000", typeEquals: "SYSTEM_DEFINED" })
        if (next) qs.set("nextToken", next)
        const data = await this.getJson(`${control}/inference-profiles?${qs}`)
        profiles.push(...(data?.inferenceProfileSummaries ?? []))
        next = data?.nextToken
        if (!next) break
      }
    } catch {
      /* best-effort */
    }
    const { models, profileFor } = buildBedrockCatalog(fm?.modelSummaries ?? [], profiles, this.region)
    profileForModel.set(this.config.endpoint, profileFor)
    return models.map((m) => ({
      providerId: this.config.id,
      name: m.name,
      vision: m.vision,
      capabilities: m.vision ? ["text", "json", "streaming", "vision"] : ["text", "json", "streaming"],
    }))
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    const checkedAt = new Date().toISOString()
    if (!this.getApiKey()) {
      return { providerId: this.config.id, ok: false, checkedAt, error: "API key is required but not configured." }
    }
    try {
      const models = await this.listModels()
      return { providerId: this.config.id, ok: true, checkedAt, latencyMs: Date.now() - started, modelCount: models.length }
    } catch (err: any) {
      return { providerId: this.config.id, ok: false, checkedAt, error: err?.message ?? String(err) }
    }
  }

  /** A raw model id that can only run through a profile is rewritten to it. */
  private resolveModelId(model: string): string {
    return profileForModel.get(this.config.endpoint)?.get(model) ?? model
  }

  async generate(request: GenerateRequest): Promise<string> {
    if (this.config.apiKeyRequired && !this.getApiKey()) {
      throw new Error(`${this.config.name} requires an API key.`)
    }
    let params: ConverseParams = {
      includeTopP: true,
      maxTokens: Math.max(request.options.numPredict, BEDROCK_DEFAULT_MAX_TOKENS),
    }
    // Up to two parameter repairs (top_p, then token cap) before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.converse(request, params)
      } catch (err: any) {
        if (request.signal?.aborted || err?.streamed) throw err
        const adjusted = attempt < 2 ? adjustForValidationError(err?.message ?? "", params) : null
        if (!adjusted) throw err
        params = adjusted
      }
    }
  }

  private async converse(request: GenerateRequest, params: ConverseParams): Promise<string> {
    const base = this.config.endpoint.replace(/\/+$/, "")
    const modelId = encodeURIComponent(this.resolveModelId(request.model))
    const url = `${base}/model/${modelId}/${request.stream ? "converse-stream" : "converse"}`

    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const kick = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), this.config.timeoutMs)
    }
    const onAbort = () => ctl.abort()
    if (request.signal?.aborted) ctl.abort()
    request.signal?.addEventListener("abort", onAbort, { once: true })
    kick()
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(buildConverseBody(request, params)),
        signal: ctl.signal,
      })
      kick()
      if (!res.ok) throw await httpError(res)

      if (!request.stream) {
        const data: any = await res.json()
        const parts: any[] = data?.output?.message?.content ?? []
        const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
        if (!text) throw emptyAnswerError(data?.stopReason)
        return text
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body reader available.")
      let pending: Uint8Array = new Uint8Array(0)
      let full = ""
      let stopReason: string | undefined
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          kick()
          request.onActivity?.()
          const { messages, rest } = decodeEventStream(concat(pending, value))
          pending = rest
          for (const msg of messages) {
            const kind = String(msg.headers[":message-type"] ?? "event")
            const payloadText = new TextDecoder().decode(msg.payload)
            if (kind === "exception" || kind === "error") {
              let message = String(msg.headers[":error-message"] ?? payloadText)
              try {
                message = JSON.parse(payloadText)?.message ?? message
              } catch {
                /* plain text */
              }
              const type = String(msg.headers[":exception-type"] ?? msg.headers[":error-code"] ?? "")
              const e: any = bedrockError(0, type, message)
              e.streamed = full.length > 0
              throw e
            }
            const event = String(msg.headers[":event-type"] ?? "")
            let payload: any
            try {
              payload = JSON.parse(payloadText)
            } catch {
              continue
            }
            if (event === "contentBlockDelta") {
              const text = payload?.delta?.text
              // reasoningContent deltas are progress, not answer (onActivity above).
              if (typeof text === "string" && text) {
                full += text
                request.onToken?.(text)
              }
            } else if (event === "messageStop") {
              stopReason = payload?.stopReason
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (!full) throw emptyAnswerError(stopReason)
      return full
    } catch (err: any) {
      if (ctl.signal.aborted && !request.signal?.aborted) {
        throw new Error("Request timed out (no data received).")
      }
      if (request.signal?.aborted) throw new Error("Request cancelled.")
      throw err
    } finally {
      if (timer) clearTimeout(timer)
      request.signal?.removeEventListener("abort", onAbort)
    }
  }
}

function emptyAnswerError(stopReason: string | undefined): Error {
  if (stopReason === "max_tokens") {
    return bedrockError(400, "ValidationException", "maxTokens reached before any answer text (reasoning used the budget)")
  }
  if (stopReason === "guardrail_intervened" || stopReason === "content_filtered") {
    return bedrockError(400, "ValidationException", `request blocked (${stopReason})`)
  }
  return new Error("No response content received from provider.")
}
