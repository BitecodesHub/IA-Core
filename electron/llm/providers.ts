import type { AiCapability, AiProviderSettings } from "../config/schema"
import { heuristicVision, isUsableCatalogEntry, takeLines, visionFromModality } from "./parse"
import { mapWithConcurrency } from "./concurrency"
import { isTransientError, backoffDelayMs } from "./retry"

// Model discovery / capability probes run on a slow-or-flaky link too, so they get
// the same resilience as generation: an idle (not total) timeout, and a short
// transient-aware retry. Idle is capped so a Settings refresh stays responsive —
// on a truly dead socket the fetch rejects fast and the retry gives up quickly.
const DISCOVERY_IDLE_CAP_MS = 45_000
const DISCOVERY_RETRY_CAP = 2

function discoveryIdleMs(timeoutMs: number): number {
  return Math.min(timeoutMs, DISCOVERY_IDLE_CAP_MS)
}

async function withDiscoveryRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (attempt >= DISCOVERY_RETRY_CAP || !isTransientError(msg)) throw err
      attempt++
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt, 400, 4000)))
    }
  }
}

export interface ModelInfo {
  providerId: string
  name: string
  vision: boolean
  /** Free-tier model (OpenRouter ":free" suffix or zero pricing). Absent for local providers. */
  free?: boolean
  capabilities: AiCapability[]
}

/**
 * OpenRouter tags its free tier with a ":free" id suffix and zero prompt AND
 * completion pricing (its "openrouter/auto" router uses "-1" pricing, which
 * must not count). Other OpenAI-compatible catalogs carry no pricing metadata,
 * so this stays false there unless they adopt the same suffix convention.
 */
export function isFreeModelEntry(name: string, entry: unknown): boolean {
  if (name.endsWith(":free")) return true
  const pricing = (entry as any)?.pricing
  if (!pricing || typeof pricing !== "object") return false
  // parseFloat (never Number): null/""/[] must read as unknown (NaN), not 0 — a
  // paid model whose catalog reports "price unknown" must never be labeled free.
  return parseFloat(pricing.prompt) === 0 && parseFloat(pricing.completion) === 0
}

/**
 * Result of a model-discovery attempt. Lets the renderer distinguish a genuine
 * failure (`ok:false`, show `error`) from a reachable-but-empty catalog
 * (`ok:true`, `models:[]`) instead of collapsing both into an empty list.
 */
export interface ModelDiscoveryResult {
  providerId: string
  ok: boolean
  models: ModelInfo[]
  error?: string
}

export interface ProviderHealth {
  providerId: string
  ok: boolean
  checkedAt: string
  latencyMs?: number
  modelCount?: number
  error?: string
}

export interface GenerateOptions {
  temperature: number
  topP: number
  topK: number
  numCtx: number
  numPredict: number
  keepAlive: string
}

export interface GenerateRequest {
  prompt: string
  model: string
  stream: boolean
  images?: string[]
  options: GenerateOptions
  onToken?: (token: string) => void
  /**
   * Called on ANY streamed progress, including reasoning text that is not part
   * of the answer. Lets the caller distinguish a model that is thinking from
   * one that is stuck in a queue.
   */
  onActivity?: () => void
  signal?: AbortSignal
  /** What the app is doing; only the Bitecodes provider reports it (for its log). */
  kind?: RequestKind
}

export type RequestKind = "chat" | "screenshot" | "solution" | "debug" | "other"

export interface LlmProvider {
  readonly config: AiProviderSettings
  listModels(): Promise<ModelInfo[]>
  healthCheck(): Promise<ProviderHealth>
  generate(request: GenerateRequest): Promise<string>
}

interface OpenAIChoiceDelta {
  choices?: Array<{
    delta?: { content?: string }
    message?: { content?: string }
    text?: string
  }>
  // OpenRouter can emit an error frame with HTTP 200 (rate limit, moderation,
  // upstream failure); surface it instead of reporting empty content.
  error?: { message?: string } | string
}

/** True when an endpoint is OpenRouter, the only provider with native `models` failover. */
export function isOpenRouterEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.toLowerCase().endsWith("openrouter.ai")
  } catch {
    return false
  }
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`
}

/**
 * Detect the image MIME type from base64 bytes so the data URI is labeled
 * correctly. Anthropic (via OpenRouter) validates media_type against the actual
 * bytes, so a PNG mislabeled as JPEG can be rejected. Defaults to jpeg.
 */
function imageMimeFromBase64(base64: string): string {
  const head = Buffer.from(base64.slice(0, 24), "base64")
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return "image/png"
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
  if (head.length >= 4 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif"
  if (
    head.length >= 12 &&
    head.toString("ascii", 0, 4) === "RIFF" &&
    head.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp"
  return "image/jpeg"
}

/** Extract a human-readable error message from an OpenAI/OpenRouter payload. */
function streamErrorMessage(data: OpenAIChoiceDelta): string | undefined {
  const err = data.error
  if (!err) return undefined
  if (typeof err === "string") return err
  return err.message ?? "provider error"
}

/**
 * An INACTIVITY (idle) timeout rather than a total one. The timer aborts only
 * after `idleMs` elapses with no progress; every received chunk calls `kick()`
 * to reset it. This is what makes generation robust on a slow connection: a
 * response that keeps trickling in — however slowly — is never killed, and total
 * wall-clock time is unbounded. A truly stalled connection (no bytes for the
 * whole idle window) still aborts so the caller can retry. `state.timedOut`
 * distinguishes an idle abort from a user cancellation via `signal`.
 */
function createIdleTimeoutSignal(signal: AbortSignal | undefined, idleMs: number) {
  const controller = new AbortController()
  const state = { timedOut: false }
  let timer: ReturnType<typeof setTimeout>
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      state.timedOut = true
      controller.abort()
    }, idleMs)
  }
  arm()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return { signal: controller.signal, kick: arm, cleanup: () => clearTimeout(timer), state }
}

async function safeErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return ""
  try {
    const parsed = JSON.parse(text)
    return String(parsed.error?.message ?? parsed.error ?? text).slice(0, 500)
  } catch {
    return text.slice(0, 500)
  }
}

function capabilitiesFor(vision: boolean): AiCapability[] {
  const capabilities: AiCapability[] = ["text", "json", "streaming"]
  if (vision) capabilities.push("vision")
  return capabilities
}

export class OllamaProvider implements LlmProvider {
  private visionCache = new Map<string, boolean>()

  constructor(readonly config: AiProviderSettings) {}

  async listModels(): Promise<ModelInfo[]> {
    const names = await withDiscoveryRetry<string[]>(async () => {
      const idle = createIdleTimeoutSignal(undefined, discoveryIdleMs(this.config.timeoutMs))
      try {
        const response = await fetch(joinUrl(this.config.endpoint, "/api/tags"), {
          signal: idle.signal,
        })
        idle.kick()
        if (!response.ok) throw new Error(`Ollama model discovery failed: ${response.status}`)
        const data: any = await response.json()
        return Array.isArray(data.models) ? data.models.map((m: any) => String(m.name)) : []
      } finally {
        idle.cleanup()
      }
    })
    // Bound the per-model /api/show fan-out so a long model list does not open
    // dozens of simultaneous requests (order is preserved).
    return mapWithConcurrency(names, 4, async (name) => {
      const vision = await this.refreshCapability(name)
      return { providerId: this.config.id, name, vision, capabilities: capabilitiesFor(vision) }
    })
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      const models = await this.listModels()
      return {
        providerId: this.config.id,
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        modelCount: models.length,
      }
    } catch (err: any) {
      return {
        providerId: this.config.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        error: err?.message ?? String(err),
      }
    }
  }

  async refreshCapability(model: string): Promise<boolean> {
    try {
      // Idle timeout + short retry so a slow-but-live /api/show still yields the
      // authoritative capability instead of silently degrading to the name guess.
      const data: any = await withDiscoveryRetry(async () => {
        const idle = createIdleTimeoutSignal(undefined, discoveryIdleMs(this.config.timeoutMs))
        try {
          const response = await fetch(joinUrl(this.config.endpoint, "/api/show"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: model }),
            signal: idle.signal,
          })
          idle.kick()
          if (!response.ok) throw new Error(`Ollama /api/show failed: ${response.status}`)
          return await response.json()
        } finally {
          idle.cleanup()
        }
      })
      const caps: string[] = Array.isArray(data?.capabilities) ? data.capabilities : []
      const families: string[] = Array.isArray(data?.details?.families) ? data.details.families : []
      const vision =
        caps.includes("vision") ||
        families.some((f) => ["clip", "mllama"].includes(String(f).toLowerCase())) ||
        heuristicVision(model)
      this.visionCache.set(model, vision)
      return vision
    } catch {
      // Network/HTTP failure after retries → fall back to the name heuristic.
      const fallback = heuristicVision(model)
      this.visionCache.set(model, fallback)
      return fallback
    }
  }

  isVisionCached(model: string): boolean {
    return this.visionCache.get(model) ?? heuristicVision(model)
  }

  async generate(request: GenerateRequest): Promise<string> {
    const idle = createIdleTimeoutSignal(request.signal, this.config.timeoutMs)
    try {
      const response = await fetch(joinUrl(this.config.endpoint, "/api/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          stream: request.stream,
          images: request.images,
          keep_alive: request.options.keepAlive,
          options: {
            temperature: request.options.temperature,
            top_p: request.options.topP,
            top_k: request.options.topK,
            num_ctx: request.options.numCtx,
            num_predict: request.options.numPredict,
          },
        }),
        signal: idle.signal,
      })
      idle.kick() // headers received — reset the inactivity window
      if (!response.ok) {
        throw new Error(`Ollama API error ${response.status}: ${await safeErrorBody(response)}`)
      }
      if (!request.stream) {
        const data: any = await response.json()
        if (!data.response) throw new Error("No response content received from Ollama.")
        return data.response
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body reader available.")
      const decoder = new TextDecoder()
      let full = ""
      let buffer = ""
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          idle.kick() // progress — a slow but live stream must never time out
          buffer += decoder.decode(value, { stream: true })
          const { lines, rest } = takeLines(buffer)
          buffer = rest
          for (const line of lines) {
            let data: any
            try {
              data = JSON.parse(line)
            } catch {
              // Skip a malformed NDJSON line rather than aborting the whole stream.
              continue
            }
            if (data.error) {
              throw new Error(`Ollama stream error: ${String(data.error).slice(0, 500)}`)
            }
            if (data.response) {
              full += data.response
              request.onToken?.(data.response)
            }
            if (data.done) return full
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (!full) throw new Error("No response content received from streaming.")
      return full
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (idle.state.timedOut) {
          throw new Error(
            `No data from Ollama for ${Math.round(this.config.timeoutMs / 1000)}s (connection stalled).`
          )
        }
        throw new Error("Request cancelled.")
      }
      throw err
    } finally {
      idle.cleanup()
    }
  }
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    readonly config: AiProviderSettings,
    private readonly getApiKey: () => string | null
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const entries: any[] = await withDiscoveryRetry(async () => {
      const idle = createIdleTimeoutSignal(undefined, discoveryIdleMs(this.config.timeoutMs))
      try {
        const response = await fetch(joinUrl(this.config.endpoint, "/models"), {
          headers: this.headers(),
          signal: idle.signal,
        })
        idle.kick()
        if (!response.ok)
          throw new Error(
            `Model discovery failed: ${response.status} ${await safeErrorBody(response)}`
          )
        const data: any = await response.json()
        return Array.isArray(data.data) ? data.data : []
      } finally {
        idle.cleanup()
      }
    })
    return entries
      .filter((entry) => isUsableCatalogEntry(entry))
      .map((entry) => {
        const name = String(entry?.id ?? "")
        // Provider modality metadata (OpenRouter architecture.input_modalities)
        // is authoritative; fall back to a name/config heuristic only when the
        // endpoint returns no modality info (vanilla OpenAI, LM Studio, …).
        const vision =
          visionFromModality(entry) ?? (heuristicVision(name) || name === this.config.visionModel)
        return {
          providerId: this.config.id,
          name,
          vision,
          free: isFreeModelEntry(name, entry),
          capabilities: capabilitiesFor(vision),
        }
      })
      .filter((m) => m.name)
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now()
    if (this.config.apiKeyRequired && !this.getApiKey()) {
      return {
        providerId: this.config.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        error: "API key is required but not configured.",
      }
    }
    try {
      const models = await this.listModels()
      return {
        providerId: this.config.id,
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        modelCount: models.length,
      }
    } catch (err: any) {
      return {
        providerId: this.config.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        error: err?.message ?? String(err),
      }
    }
  }

  /**
   * If a reasoning model spends its whole budget thinking (no answer text), try
   * once more with a larger budget before reporting failure — the model works,
   * it just needed room. Nothing was streamed to the user in that case, so the
   * retry cannot duplicate output.
   */
  async generate(request: GenerateRequest): Promise<string> {
    try {
      return await this.generateOnce(request)
    } catch (err: any) {
      const budget = request.options.numPredict
      if (!/max_tokens exhausted before any answer/.test(err?.message ?? "") || budget >= 16384) {
        throw err
      }
      return this.generateOnce({
        ...request,
        options: { ...request.options, numPredict: Math.min(Math.max(budget * 4, 8192), 16384) },
      })
    }
  }

  private async generateOnce(request: GenerateRequest): Promise<string> {
    if (this.config.apiKeyRequired && !this.getApiKey()) {
      throw new Error(`${this.config.name} requires an API key.`)
    }
    const idle = createIdleTimeoutSignal(request.signal, this.config.timeoutMs)
    try {
      const content =
        request.images && request.images.length > 0
          ? [
              { type: "text", text: request.prompt },
              ...request.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${imageMimeFromBase64(image)};base64,${image}` },
              })),
            ]
          : request.prompt
      const body: Record<string, unknown> = {
        model: request.model,
        messages: [{ role: "user", content }],
        stream: request.stream,
        temperature: request.options.temperature,
        top_p: request.options.topP,
        max_tokens: request.options.numPredict,
      }
      // OpenRouter native model fallback: send a `models` array (primary first) so
      // OpenRouter fails over server-side on rate-limit/downtime. ONLY for
      // OpenRouter: strict OpenAI-compatible validators (NVIDIA NIM) reject any
      // unknown field with "400 Unsupported parameter(s): models", which made every
      // request fail as soon as a fallback list was configured. Other providers get
      // client-side fallback in LLMHelper instead.
      const fallbacks = (this.config.fallbackModels ?? []).filter((m) => m && m !== request.model)
      if (fallbacks.length > 0 && isOpenRouterEndpoint(this.config.endpoint)) {
        body.models = [request.model, ...fallbacks]
      }
      const response = await fetch(joinUrl(this.config.endpoint, "/chat/completions"), {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: idle.signal,
      })
      idle.kick() // headers received — reset the inactivity window
      if (!response.ok) {
        throw new Error(`Provider API error ${response.status}: ${await safeErrorBody(response)}`)
      }
      if (!request.stream) {
        const data = (await response.json()) as OpenAIChoiceDelta
        const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text
        if (!content || !String(content).trim()) {
          const msg: any = data.choices?.[0]?.message
          throw emptyAnswerError(
            Boolean(msg?.reasoning_content || msg?.reasoning),
            (data.choices?.[0] as any)?.finish_reason
          )
        }
        return content
      }
      // Every received chunk is progress — including reasoning deltas that carry
      // no answer text — so report it as activity as well as resetting the idle timer.
      return this.readSse(response, request.onToken, () => {
        idle.kick()
        request.onActivity?.()
      })
    } catch (err: any) {
      if (err?.name === "AbortError") {
        if (idle.state.timedOut) {
          throw new Error(
            `No data from ${this.config.name} for ${Math.round(this.config.timeoutMs / 1000)}s (connection stalled).`
          )
        }
        throw new Error("Request cancelled.")
      }
      throw err
    } finally {
      idle.cleanup()
    }
  }

  private headers(): Record<string, string> {
    const key = this.getApiKey()
    return key ? { Authorization: `Bearer ${key}` } : {}
  }

  private async readSse(
    response: Response,
    onToken?: (token: string) => void,
    kick?: () => void
  ): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body reader available.")
    const decoder = new TextDecoder()
    let full = ""
    let buffer = ""
    let sawReasoning = false
    let finishReason: string | undefined
    let finished = false
    try {
      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        kick?.() // progress — a slow but live stream must never time out
        buffer += decoder.decode(value, { stream: true })
        const { lines, rest } = takeLines(buffer)
        buffer = rest
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(":")) continue
          const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
          // [DONE] ends the stream, but must still fall through to the empty-
          // answer check below: returning `full` here let a reasoning model that
          // spent its whole budget thinking "succeed" with an EMPTY answer, which
          // then blocked every fallback.
          if (payload === "[DONE]") {
            finished = true
            break
          }
          try {
            const data = JSON.parse(payload) as OpenAIChoiceDelta
            const errMsg = streamErrorMessage(data)
            if (errMsg) throw new Error(`Provider stream error: ${errMsg.slice(0, 500)}`)
            const delta: any = data.choices?.[0]?.delta
            if (delta?.reasoning_content || delta?.reasoning) sawReasoning = true
            const reason = (data.choices?.[0] as any)?.finish_reason
            if (reason) finishReason = reason
            const token = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.text ?? ""
            if (token) {
              full += token
              onToken?.(token)
            }
          } catch (err: any) {
            // Re-throw a real provider error frame; only swallow JSON parse noise
            // from permissive local gateways.
            if (err instanceof Error && err.message.startsWith("Provider stream error:")) throw err
            /* Skip non-JSON SSE lines. */
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
    if (!full.trim()) throw emptyAnswerError(sawReasoning, finishReason)
    return full
  }
}

/**
 * An empty answer is a failure, never a success — so fallback can take over.
 * Shaped as a 400 when the cause is the token budget, so the classifier treats
 * it as "this model cannot take this request as configured" and moves on
 * (another model, or the same one with a larger budget, can succeed).
 */
function emptyAnswerError(sawReasoning: boolean, finishReason?: string): Error {
  if (finishReason === "length" || sawReasoning) {
    return new Error(
      `Provider API error 400: max_tokens exhausted before any answer text${sawReasoning ? " (the model spent it reasoning)" : ""}`
    )
  }
  return new Error("No response content received from provider stream.")
}
