import type { AiCapability, AiProviderSettings } from "../config/schema"
import { heuristicVision, takeLines } from "./parse"

export interface ModelInfo {
  providerId: string
  name: string
  vision: boolean
  capabilities: AiCapability[]
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
  signal?: AbortSignal
}

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

function createTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  }
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
    const timeout = createTimeoutSignal(undefined, Math.min(this.config.timeoutMs, 15_000))
    try {
      const response = await fetch(joinUrl(this.config.endpoint, "/api/tags"), {
        signal: timeout.signal,
      })
      if (!response.ok) throw new Error(`Ollama model discovery failed: ${response.status}`)
      const data: any = await response.json()
      const names: string[] = Array.isArray(data.models)
        ? data.models.map((m: any) => String(m.name))
        : []
      const detailed = await Promise.all(
        names.map(async (name) => {
          const vision = await this.refreshCapability(name)
          return {
            providerId: this.config.id,
            name,
            vision,
            capabilities: capabilitiesFor(vision),
          }
        })
      )
      return detailed
    } finally {
      timeout.cleanup()
    }
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
      const timeout = createTimeoutSignal(undefined, Math.min(this.config.timeoutMs, 15_000))
      const response = await fetch(joinUrl(this.config.endpoint, "/api/show"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model }),
        signal: timeout.signal,
      }).finally(timeout.cleanup)
      if (!response.ok) {
        const fallback = heuristicVision(model)
        this.visionCache.set(model, fallback)
        return fallback
      }
      const data: any = await response.json()
      const caps: string[] = Array.isArray(data?.capabilities) ? data.capabilities : []
      const families: string[] = Array.isArray(data?.details?.families) ? data.details.families : []
      const vision =
        caps.includes("vision") ||
        families.some((f) => ["clip", "mllama"].includes(String(f).toLowerCase())) ||
        heuristicVision(model)
      this.visionCache.set(model, vision)
      return vision
    } catch {
      const fallback = heuristicVision(model)
      this.visionCache.set(model, fallback)
      return fallback
    }
  }

  isVisionCached(model: string): boolean {
    return this.visionCache.get(model) ?? heuristicVision(model)
  }

  async generate(request: GenerateRequest): Promise<string> {
    const timeout = createTimeoutSignal(request.signal, this.config.timeoutMs)
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
        signal: timeout.signal,
      })
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
        throw new Error(
          `Request timed out after ${Math.round(this.config.timeoutMs / 1000)}s or was cancelled.`
        )
      }
      throw err
    } finally {
      timeout.cleanup()
    }
  }
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    readonly config: AiProviderSettings,
    private readonly getApiKey: () => string | null
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    const headers = this.headers()
    const timeout = createTimeoutSignal(undefined, Math.min(this.config.timeoutMs, 15_000))
    try {
      const response = await fetch(joinUrl(this.config.endpoint, "/models"), {
        headers,
        signal: timeout.signal,
      })
      if (!response.ok)
        throw new Error(
          `Model discovery failed: ${response.status} ${await safeErrorBody(response)}`
        )
      const data: any = await response.json()
      const names: string[] = Array.isArray(data.data)
        ? data.data.map((m: any) => String(m.id))
        : []
      return names.map((name) => {
        const vision = heuristicVision(name) || name === this.config.visionModel
        return {
          providerId: this.config.id,
          name,
          vision,
          capabilities: capabilitiesFor(vision),
        }
      })
    } finally {
      timeout.cleanup()
    }
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

  async generate(request: GenerateRequest): Promise<string> {
    if (this.config.apiKeyRequired && !this.getApiKey()) {
      throw new Error(`${this.config.name} requires an API key.`)
    }
    const timeout = createTimeoutSignal(request.signal, this.config.timeoutMs)
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
      // OpenRouter native model fallback: if fallback models are configured, send a
      // `models` array (primary first) so OpenRouter fails over to the next model on
      // rate-limit/downtime. Harmless for endpoints that ignore the field.
      const fallbacks = (this.config.fallbackModels ?? []).filter((m) => m && m !== request.model)
      if (fallbacks.length > 0) body.models = [request.model, ...fallbacks]
      const response = await fetch(joinUrl(this.config.endpoint, "/chat/completions"), {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeout.signal,
      })
      if (!response.ok) {
        throw new Error(`Provider API error ${response.status}: ${await safeErrorBody(response)}`)
      }
      if (!request.stream) {
        const data = (await response.json()) as OpenAIChoiceDelta
        const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text
        if (!content) throw new Error("No response content received from provider.")
        return content
      }
      return this.readSse(response, request.onToken)
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request timed out after ${Math.round(this.config.timeoutMs / 1000)}s or was cancelled.`
        )
      }
      throw err
    } finally {
      timeout.cleanup()
    }
  }

  private headers(): Record<string, string> {
    const key = this.getApiKey()
    return key ? { Authorization: `Bearer ${key}` } : {}
  }

  private async readSse(response: Response, onToken?: (token: string) => void): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body reader available.")
    const decoder = new TextDecoder()
    let full = ""
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { lines, rest } = takeLines(buffer)
        buffer = rest
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(":")) continue
          const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed
          if (payload === "[DONE]") return full
          try {
            const data = JSON.parse(payload) as OpenAIChoiceDelta
            const errMsg = streamErrorMessage(data)
            if (errMsg) throw new Error(`Provider stream error: ${errMsg.slice(0, 500)}`)
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
    if (!full) throw new Error("No response content received from provider stream.")
    return full
  }
}
