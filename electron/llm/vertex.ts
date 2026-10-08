// Google Vertex AI (Gemini) provider — Express-mode API key.
//
// Vertex does NOT speak the OpenAI protocol with an API key (its OpenAI-compatible
// endpoint needs a GCP project + short-lived OAuth token), so this talks to the
// native Gemini API:
//   POST {endpoint}/publishers/google/models/{model}:streamGenerateContent?alt=sse
//   POST {endpoint}/publishers/google/models/{model}:generateContent
//   header  x-goog-api-key: <key>
// The pinned endpoint is the Sydney region (australia-southeast1), so requests
// are served from Australia.
//
// Verified 2026-10-01 with a live Express key: text + SSE streaming on the
// global and Sydney endpoints, and gemini-2.5-flash transcribed a full LeetCode
// screenshot correctly in ~3s (NVIDIA's best vision model needed 50-70s).

import type { AiProviderSettings } from "../config/schema"
import type { GenerateRequest, LlmProvider, ModelInfo, ProviderHealth } from "./providers"
import { takeLines } from "./parse"

/**
 * Express mode has no model-listing endpoint, so the catalog is curated. All
 * current Gemini models accept images. Ids that Google retires surface as
 * 404s, which the runtime fallback + self-healing in LLMHelper absorb.
 */
export const VERTEX_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const

/**
 * Gemini 2.5 models "think" before answering, and thinking tokens count
 * against maxOutputTokens — a small cap (the app default is 1024) can be fully
 * consumed by thinking and return an EMPTY answer. Give them headroom.
 */
const MIN_OUTPUT_TOKENS = 8192

function mimeOf(base64: string): string {
  const head = Buffer.from(base64.slice(0, 24), "base64")
  if (head[0] === 0x89 && head[1] === 0x50) return "image/png"
  if (head[0] === 0x47 && head[1] === 0x49) return "image/gif"
  if (head.toString("ascii", 8, 12) === "WEBP") return "image/webp"
  return "image/jpeg"
}

/** Answer text from a Gemini response chunk; "thought" parts are not the answer. */
function textOf(chunk: any): { text: string; any: boolean } {
  const parts: any[] = chunk?.candidates?.[0]?.content?.parts ?? []
  let text = ""
  for (const p of parts) if (typeof p?.text === "string" && !p.thought) text += p.text
  return { text, any: parts.length > 0 }
}

function errorMessage(status: number, body: string): string {
  let detail = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body)
    detail = String(parsed?.error?.message ?? parsed?.[0]?.error?.message ?? detail).slice(0, 500)
  } catch {
    /* non-JSON body (Google's HTML 404 page) */
    if (/<html/i.test(body)) detail = "Not Found"
  }
  return `Provider API error ${status}: ${detail}`
}

export class VertexGeminiProvider implements LlmProvider {
  constructor(
    readonly config: AiProviderSettings,
    private readonly getApiKey: () => string | null
  ) {}

  private url(model: string, method: "generateContent" | "streamGenerateContent" | "countTokens") {
    const base = this.config.endpoint.replace(/\/+$/, "")
    const suffix = method === "streamGenerateContent" ? "?alt=sse" : ""
    return `${base}/publishers/google/models/${encodeURIComponent(model)}:${method}${suffix}`
  }

  private headers(): Record<string, string> {
    const key = this.getApiKey()
    return { "Content-Type": "application/json", ...(key ? { "x-goog-api-key": key } : {}) }
  }

  async listModels(): Promise<ModelInfo[]> {
    return VERTEX_GEMINI_MODELS.map((name) => ({
      providerId: this.config.id,
      name,
      vision: true,
      capabilities: ["text", "json", "streaming", "vision"],
    }))
  }

  /**
   * Validates the key with countTokens — free, no generation billed — against
   * the configured (or default) model, so a bad key or a retired model shows
   * up in the Test button instead of on the first real request.
   */
  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    const checkedAt = new Date().toISOString()
    if (!this.getApiKey()) {
      return { providerId: this.config.id, ok: false, checkedAt, error: "API key is required but not configured." }
    }
    const model = this.config.highModel || this.config.lowModel || VERTEX_GEMINI_MODELS[0]
    try {
      const res = await fetch(this.url(model, "countTokens"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
        signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 20_000)),
      })
      if (!res.ok) {
        return { providerId: this.config.id, ok: false, checkedAt, error: errorMessage(res.status, await res.text()) }
      }
      return {
        providerId: this.config.id,
        ok: true,
        checkedAt,
        latencyMs: Date.now() - started,
        modelCount: VERTEX_GEMINI_MODELS.length,
      }
    } catch (err: any) {
      return { providerId: this.config.id, ok: false, checkedAt, error: err?.message ?? String(err) }
    }
  }

  async generate(request: GenerateRequest): Promise<string> {
    if (this.config.apiKeyRequired && !this.getApiKey()) {
      throw new Error(`${this.config.name} requires an API key.`)
    }
    const parts: any[] = [{ text: request.prompt }]
    for (const img of request.images ?? []) {
      parts.push({ inline_data: { mime_type: mimeOf(img), data: img } })
    }
    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: Math.min(Math.max(request.options.temperature, 0), 2),
        topP: request.options.topP,
        topK: request.options.topK > 0 ? request.options.topK : undefined,
        maxOutputTokens: Math.max(request.options.numPredict, MIN_OUTPUT_TOKENS),
      },
    }

    // Idle (not total) timeout, matching the other providers.
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
      const res = await fetch(
        this.url(request.model, request.stream ? "streamGenerateContent" : "generateContent"),
        { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: ctl.signal }
      )
      kick()
      if (!res.ok) throw new Error(errorMessage(res.status, await res.text().catch(() => "")))

      if (!request.stream) {
        const data = await res.json()
        const { text } = textOf(data)
        if (!text) throw new Error(blockedReason(data) ?? "No response content received from provider.")
        return text
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body reader available.")
      const decoder = new TextDecoder()
      let buffer = ""
      let full = ""
      let last: any = null
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          kick()
          request.onActivity?.()
          buffer += decoder.decode(value, { stream: true })
          const { lines, rest } = takeLines(buffer)
          buffer = rest
          for (const line of lines) {
            const payload = line.startsWith("data:") ? line.slice(5).trim() : line.trim()
            if (!payload || payload === "[DONE]") continue
            let chunk: any
            try {
              chunk = JSON.parse(payload)
            } catch {
              continue
            }
            if (chunk?.error) throw new Error(errorMessage(chunk.error.code ?? 500, JSON.stringify(chunk)))
            last = chunk
            const { text } = textOf(chunk)
            if (text) {
              full += text
              request.onToken?.(text)
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (!full) throw new Error(blockedReason(last) ?? "No response content received from provider stream.")
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

/** Gemini signals refusals via finishReason/promptFeedback rather than an error. */
function blockedReason(data: any): string | null {
  const block = data?.promptFeedback?.blockReason
  if (block) return `Provider API error 400: request blocked (${block})`
  const finish = data?.candidates?.[0]?.finishReason
  if (finish && finish !== "STOP") return `Provider API error 400: generation stopped (${finish})`
  return null
}
