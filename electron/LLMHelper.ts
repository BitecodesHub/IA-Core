import fs from "fs"
import { SettingsService } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import { AudioService } from "./audio/AudioService"
import type { AiProviderSettings } from "./config/schema"
import { cleanJsonResponse } from "./llm/parse"
import { selectModel, type TaskContext, type ModelTiers } from "./llm/router"
import { pickModel } from "./llm/pick"
import { isTransientError, backoffDelayMs } from "./llm/retry"
import { recommendedModels } from "./llm/defaults"
import { shouldAutoHealthCheck } from "./llm/mode"
import {
  OllamaProvider,
  OpenAICompatibleProvider,
  type GenerateOptions,
  type LlmProvider,
  type ModelInfo,
  type ModelDiscoveryResult,
  type ProviderHealth,
} from "./llm/providers"

interface GenerateOpts {
  stream?: boolean
  images?: string[]
  model?: string
  providerId?: string
  onToken?: (token: string) => void
  signal?: AbortSignal
  temperatureCap?: number
}

// Extra retry budget for transient failures, on top of the user's requestRetries
// setting. Slow networks should recover rather than surface an error, so these are
// generous; total wall-clock is bounded only by the idle-timeout per attempt.
const MAX_TRANSIENT_RETRIES = 5
const RETRY_BASE_MS = 500
const RETRY_CAP_MS = 8000

/**
 * Provider-aware LLM facade.
 *
 * The rest of the app keeps calling the same high-level methods, while this
 * class owns provider discovery, low/high/vision routing, timeouts, retry, and
 * graceful fallback across enabled provider profiles.
 */
export class LLMHelper {
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private settings = SettingsService.getInstance()
  private autoModels = new Map<string, string>()
  private modelCache = new Map<string, { at: number; models: ModelInfo[] }>()

  constructor() {
    this.initialize().catch((err) =>
      console.error("[LLMHelper] Initialization warning:", err?.message ?? err)
    )
  }

  public get ollamaUrl(): string {
    return this.settings.get("ai").providers.ollama?.endpoint || "http://localhost:11434"
  }

  private get activeProvider(): AiProviderSettings {
    const ai = this.settings.get("ai")
    return ai.providers[ai.activeProviderId] ?? ai.providers.ollama
  }

  private providerSequence(providerId?: string): AiProviderSettings[] {
    const ai = this.settings.get("ai")
    const ids = providerId ? [providerId] : [ai.activeProviderId, ...ai.fallbackProviderIds]
    const seen = new Set<string>()
    return ids
      .filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((id) => ai.providers[id])
      .filter((p): p is AiProviderSettings => Boolean(p && p.enabled))
  }

  private createProvider(config: AiProviderSettings): LlmProvider {
    if (config.type === "ollama") return new OllamaProvider(config)
    return new OpenAICompatibleProvider(config, () =>
      SecretStore.getInstance().getProviderApiKey(config.id)
    )
  }

  private generationOptions(config: AiProviderSettings, temperatureCap?: number): GenerateOptions {
    return {
      temperature:
        typeof temperatureCap === "number"
          ? Math.min(config.temperature, temperatureCap)
          : config.temperature,
      topP: config.topP,
      topK: config.topK,
      numCtx: config.numCtx,
      numPredict: config.numPredict,
      keepAlive: config.keepAlive,
    }
  }

  private tiers(config: AiProviderSettings): ModelTiers {
    const low = config.lowModel || this.autoModels.get(config.id) || ""
    return {
      low,
      high: config.highModel || low,
      vision: config.visionModel || config.highModel || low,
    }
  }

  private async initialize(): Promise<void> {
    const active = this.activeProvider
    await this.discoverModels(active.id).catch((): ModelInfo[] => [])
    if (this.settings.get("general").warmModelOnStart && active.type === "ollama") {
      const warm = this.tiers(active).low || this.tiers(active).vision
      if (warm) this.preloadModel(warm, active.id).catch(() => {})
    }
  }

  public async preloadModel(model: string, providerId = "ollama"): Promise<void> {
    if (!model) return
    const provider = this.settings.get("ai").providers[providerId]
    if (!provider || provider.type !== "ollama") return
    try {
      await new OllamaProvider(provider).generate({
        prompt: "",
        model,
        stream: false,
        options: this.generationOptions(provider),
      })
    } catch {
      /* best-effort warm-up */
    }
  }

  private async discoverModels(
    providerId: string,
    opts: { force?: boolean; retry?: boolean } = {}
  ): Promise<ModelInfo[]> {
    const cached = this.modelCache.get(providerId)
    if (!opts.force && cached && Date.now() - cached.at < 30_000) return cached.models
    const config = this.settings.get("ai").providers[providerId]
    if (!config || !config.enabled) return []
    const provider = this.createProvider(config)

    // Discovery is normally best-effort and NOT retried (it must not stall the
    // hot generation path). The UI path opts into a short transient-aware retry
    // so a slow/flaky link recovers instead of showing an empty list.
    let attempt = 0
    let models: ModelInfo[]
    for (;;) {
      try {
        models = await provider.listModels()
        break
      } catch (err: any) {
        const message = err?.message ?? String(err)
        if (!opts.retry || attempt >= 2 || !isTransientError(message)) throw err
        attempt++
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt, RETRY_BASE_MS, RETRY_CAP_MS)))
      }
    }

    this.modelCache.set(providerId, { at: Date.now(), models })
    // The "first discovered model" convenience is Ollama-only. For a remote
    // provider it would let an empty (Auto) slot silently resolve to an arbitrary
    // billable model; remote Auto is handled by curated defaults instead.
    if (config.type === "ollama" && models.length > 0 && !this.autoModels.has(providerId)) {
      this.autoModels.set(providerId, models[0].name)
    }
    return models
  }

  /**
   * Discover models for a provider and report success/failure distinctly, so the
   * renderer can show a real error state instead of an ambiguous empty list.
   * Uses force+retry (user-initiated UI refresh path).
   */
  public async discoverModelsResult(providerId?: string): Promise<ModelDiscoveryResult> {
    const id = providerId || this.activeProvider.id
    try {
      const models = await this.discoverModels(id, { force: true, retry: true })
      return { providerId: id, ok: true, models }
    } catch (err: any) {
      return { providerId: id, ok: false, models: [], error: err?.message ?? String(err) }
    }
  }

  private async chooseModel(config: AiProviderSettings, ctx: TaskContext): Promise<string> {
    const configured = selectModel(this.settings.get("ai").reasoningMode, ctx, this.tiers(config))
    const models = await this.discoverModels(config.id).catch((): ModelInfo[] => [])
    const rec = recommendedModels(config)
    return pickModel({
      config,
      hasImage: ctx.hasImage,
      configured,
      models,
      autoModel: this.autoModels.get(config.id),
      recommended: rec ? (ctx.hasImage ? rec.vision : rec.high) : "",
    })
  }

  private async generate(prompt: string, opts: GenerateOpts = {}): Promise<string> {
    const ctx: TaskContext = { prompt, hasImage: Boolean(opts.images?.length) }
    const providers = this.providerSequence(opts.providerId)
    if (providers.length === 0) throw new Error("No enabled AI provider is configured.")

    const errors: string[] = []
    const retries = this.settings.get("ai").requestRetries
    // Track whether any token was streamed to the consumer. Consumers accumulate
    // with `+=`, so retrying/falling back after partial output would DUPLICATE the
    // already-shown text. Once a stream has emitted, we fail instead of replaying.
    let streamedAny = false
    const onToken = opts.onToken
      ? (t: string) => {
          streamedAny = true
          opts.onToken!(t)
        }
      : undefined
    for (const config of providers) {
      const provider = this.createProvider(config)
      let model = opts.model
      try {
        model = model || (await this.chooseModel(config, ctx))
      } catch (err: any) {
        errors.push(`${config.name}: ${err?.message ?? err}`)
        continue
      }

      // Retry budget: a transient/network failure gets the generous transient
      // budget so a slow or flaky connection recovers on its own; a terminal
      // error (auth, bad request) is not retried and moves to the next provider.
      let attempt = 0
      while (true) {
        try {
          return await provider.generate({
            prompt,
            model,
            stream: opts.stream ?? false,
            images: opts.images,
            onToken,
            signal: opts.signal,
            options: this.generationOptions(config, opts.temperatureCap),
          })
        } catch (err: any) {
          const message = err?.message ?? String(err)
          if (opts.signal?.aborted) throw new Error("Request cancelled.")
          // Never replay a partially-streamed response (would duplicate output).
          if (streamedAny) throw err instanceof Error ? err : new Error(message)
          const transient = isTransientError(message)
          const budget = transient ? Math.max(retries, MAX_TRANSIENT_RETRIES) : retries
          if (attempt >= budget) {
            errors.push(`${config.name}/${model}: ${message}`)
            break // give up on this provider; try the next in the sequence
          }
          attempt++
          // Exponential backoff with jitter, capped, so retries do not hammer a
          // struggling endpoint while still recovering quickly from a blip.
          const delay = backoffDelayMs(attempt, RETRY_BASE_MS, RETRY_CAP_MS)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }
    throw new Error(`All configured providers failed. ${errors.join(" | ")}`)
  }

  // --- response cleaning / structuring ------------------------------------

  private validateAndStructureResponse(response: any, expectedStructure: string): any {
    try {
      if (typeof response === "object" && response !== null) {
        return this.ensureResponseStructure(response, expectedStructure)
      }
      if (typeof response === "string") {
        const cleaned = cleanJsonResponse(response)
        const parsed = JSON.parse(cleaned)
        return this.ensureResponseStructure(parsed, expectedStructure)
      }
      throw new Error("Invalid response format")
    } catch (error) {
      console.error("[LLMHelper] Error validating response:", error)
      return this.createFallbackResponse(expectedStructure, response)
    }
  }

  private ensureResponseStructure(response: any, expectedStructure: string): any {
    switch (expectedStructure) {
      case "problem_extraction":
        return {
          problem_statement:
            response.problem_statement ||
            "Unable to extract problem statement from the provided content.",
          context: response.context || "No additional context available.",
          suggested_responses: Array.isArray(response.suggested_responses)
            ? response.suggested_responses
            : [
                "Review the content manually",
                "Provide more specific information",
                "Try a different approach",
              ],
          reasoning: response.reasoning || "Analysis completed with available information.",
        }

      case "solution_generation": {
        const code =
          response.solution?.code ||
          response.code ||
          "// No code generated\n// Please provide more specific requirements"
        const validation = this.validateCodeSyntax(code)
        let finalCode = code
        if (!validation.isValid) {
          finalCode = `${code}\n\n/* VALIDATION WARNINGS:\n${validation.errors
            .map((e) => ` * ${e}`)
            .join("\n")}\n */`
        }
        return {
          solution: {
            code: finalCode,
            problem_statement:
              response.solution?.problem_statement ||
              response.problem_statement ||
              "Problem statement not available",
            context: response.solution?.context || response.context || "Context not available",
            suggested_responses: Array.isArray(response.solution?.suggested_responses)
              ? response.solution.suggested_responses
              : Array.isArray(response.suggested_responses)
                ? response.suggested_responses
                : [
                    "Test the provided solution",
                    "Review and modify as needed",
                    "Check for edge cases",
                  ],
            reasoning:
              response.solution?.reasoning ||
              response.reasoning ||
              "Solution generated based on available information",
            validation: { isValid: validation.isValid, errors: validation.errors },
          },
        }
      }

      case "image_analysis":
        return {
          text: response.text || response.description || "Image analysis completed",
          timestamp: response.timestamp || Date.now(),
        }

      default:
        return response
    }
  }

  private createFallbackResponse(expectedStructure: string, originalResponse: any): any {
    const fallbackText =
      typeof originalResponse === "string"
        ? originalResponse
        : "Unable to process the request properly. Please try again."

    switch (expectedStructure) {
      case "problem_extraction":
        return {
          problem_statement: "Error processing the provided content.",
          context: fallbackText,
          suggested_responses: [
            "Try rephrasing your request",
            "Provide clearer information",
            "Check the input format",
          ],
          reasoning: "Fallback response due to processing error.",
        }
      case "solution_generation":
        return {
          solution: {
            code: `// Error generating solution\n// ${fallbackText.substring(0, 200)}`,
            problem_statement: "Unable to generate proper solution due to processing error",
            context: `Processing failed: ${fallbackText}`,
            suggested_responses: [
              "Review and clarify the requirements",
              "Try breaking down the problem into smaller parts",
              "Provide more specific technical details",
            ],
            reasoning: "Fallback response generated due to processing error.",
          },
        }
      case "image_analysis":
        return {
          text: `Image analysis failed: ${fallbackText}. Please ensure the image is clear and try again.`,
          timestamp: Date.now(),
        }
      default:
        return {
          error: "Processing failed",
          original_response: fallbackText,
          timestamp: Date.now(),
        }
    }
  }

  private validateCodeSyntax(code: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    if (!code || code.trim().length === 0) {
      errors.push("Code is empty")
      return { isValid: false, errors }
    }
    if (!this.hasMatching(code, "{", "}")) errors.push("Mismatched braces {}")
    if (!this.hasMatching(code, "(", ")")) errors.push("Mismatched parentheses ()")
    if (!this.hasMatching(code, "[", "]")) errors.push("Mismatched brackets []")
    return { isValid: errors.length === 0, errors }
  }

  private hasMatching(code: string, open: string, close: string): boolean {
    let count = 0
    for (const char of code) {
      if (char === open) count++
      if (char === close) count--
      if (count < 0) return false
    }
    return count === 0
  }

  // --- public AI operations ------------------------------------------------

  public async generateSolution(problemInfo: any, signal?: AbortSignal) {
    try {
      const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The complete, working code solution here. Include proper syntax, comments, and error handling.",
    "problem_statement": "Restate the problem or situation clearly.",
    "context": "Relevant background/context and technical considerations.",
    "suggested_responses": ["First possible next step", "Second possible next step", "Third possible next step"],
    "reasoning": "Detailed explanation of the solution approach."
  }
}\n\nIMPORTANT: Return ONLY the JSON object, without markdown formatting or code blocks. Ensure the code is syntactically correct and complete.`
      const responseText = await this.generate(prompt, { stream: true, signal })
      return this.validateAndStructureResponse(responseText, "solution_generation")
    } catch (error: any) {
      console.error("[LLMHelper] Error in generateSolution:", error)
      return this.createFallbackResponse("solution_generation", error.message)
    }
  }

  public async debugSolutionWithImages(
    problemInfo: any,
    currentCode: string,
    debugImagePaths: string[],
    signal?: AbortSignal
  ) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman debugging assistant. Given:
1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}
2. The current response or approach: ${currentCode}
3. The debug information in the provided images

Please analyze the debug information and provide feedback in this JSON format:
{
  "solution": {
    "code": "The corrected, complete, working code solution.",
    "problem_statement": "Restate the problem and identify what went wrong.",
    "context": "Analysis of the debug information and technical context from the images.",
    "suggested_responses": ["First debugging step", "Second debugging step", "Third debugging step"],
    "reasoning": "Detailed explanation of what caused the issue and how the fix works."
  }
}

IMPORTANT: Return ONLY the JSON object, without markdown formatting or code blocks.`
      const base64Images = await Promise.all(
        debugImagePaths.map(async (p) => (await fs.promises.readFile(p)).toString("base64"))
      )
      const responseText = await this.generate(prompt, {
        stream: true,
        images: base64Images,
        temperatureCap: 0.2,
        signal,
      })
      return this.validateAndStructureResponse(responseText, "solution_generation")
    } catch (error: any) {
      console.error("Error debugging solution with images:", error)
      return this.createFallbackResponse("solution_generation", `Debug error: ${error.message}`)
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    return AudioService.getInstance().transcribeFile(audioPath)
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    return AudioService.getInstance().transcribeBase64(data, mimeType)
  }

  public async chat(message: string): Promise<string> {
    return this.generate(message, { stream: false })
  }

  public async chatStream(
    message: string,
    onToken: (t: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    return this.generate(message, { stream: true, onToken, signal })
  }

  public async streamImageAnalysis(
    prompt: string,
    images: string[],
    onToken: (t: string) => void,
    signal?: AbortSignal,
    temperature?: number
  ): Promise<string> {
    return this.generate(prompt, {
      stream: true,
      images,
      onToken,
      signal,
      temperatureCap: temperature ?? 0.0,
    })
  }

  // --- model/provider management -----------------------------------------

  public isUsingOllama(): boolean {
    return this.activeProvider.type === "ollama"
  }

  public getCurrentProvider(): string {
    return this.activeProvider.id
  }

  public getCurrentModel(): string {
    return this.tiers(this.activeProvider).low || this.tiers(this.activeProvider).high || ""
  }

  public async ensureVisionModel(): Promise<string> {
    for (const config of this.providerSequence()) {
      try {
        return await this.chooseModel(config, { prompt: "image analysis", hasImage: true })
      } catch {
        /* try next provider */
      }
    }
    throw new Error("No enabled provider has a vision-capable model configured or discovered.")
  }

  public async getOllamaModels(): Promise<string[]> {
    return (await this.discoverModels("ollama", { force: true }).catch((): ModelInfo[] => [])).map(
      (m) => m.name
    )
  }

  public async getOllamaModelsDetailed(): Promise<Array<{ name: string; vision: boolean }>> {
    return (await this.discoverModels("ollama", { force: true }).catch((): ModelInfo[] => [])).map(
      ({ name, vision }) => ({
        name,
        vision,
      })
    )
  }

  public async getProviderModelsDetailed(providerId?: string): Promise<ModelInfo[]> {
    const id = providerId || this.activeProvider.id
    return this.discoverModels(id, { force: true })
  }

  public async getProviderHealth(providerId?: string): Promise<ProviderHealth> {
    const config = providerId ? this.settings.get("ai").providers[providerId] : this.activeProvider
    if (!config) {
      return {
        providerId: providerId ?? "unknown",
        ok: false,
        checkedAt: new Date().toISOString(),
        error: "Provider is not configured.",
      }
    }
    if (!config.enabled) {
      return {
        providerId: config.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        error: "Provider is disabled.",
      }
    }
    return this.createProvider(config).healthCheck()
  }

  public async getProvidersHealth(): Promise<ProviderHealth[]> {
    const ai = this.settings.get("ai")
    const providers = Object.values(ai.providers)
    return Promise.all(
      providers.map((p) => {
        // Preserve the offline/local-only guarantee: never auto-contact a remote
        // provider that is not the active one (e.g. the Diagnostics tab must not
        // reach openrouter.ai while the user is in offline mode). Explicit,
        // user-initiated single-provider checks (getProviderHealth) still run.
        if (!shouldAutoHealthCheck(p, ai.activeProviderId)) {
          return Promise.resolve<ProviderHealth>({
            providerId: p.id,
            ok: false,
            checkedAt: new Date().toISOString(),
            error: "Not checked in offline mode (remote provider).",
          })
        }
        return this.getProviderHealth(p.id)
      })
    )
  }

  public invalidateProviderCache(providerId?: string): void {
    if (providerId) {
      this.modelCache.delete(providerId)
      this.autoModels.delete(providerId)
      return
    }
    this.modelCache.clear()
    this.autoModels.clear()
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    const patch: any = { ai: { activeProviderId: "ollama", providers: { ollama: {} } }, ollama: {} }
    if (url) {
      patch.ai.providers.ollama.endpoint = url
      patch.ollama.endpoint = url
    }
    if (model) {
      patch.ai.providers.ollama.lowModel = model
      patch.ollama.lowModel = model
    }
    this.settings.set(patch)
    this.invalidateProviderCache("ollama")
    if (!model) await this.initialize()
  }

  public async testConnection(providerId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const health = await this.getProviderHealth(providerId)
      if (!health.ok) return { success: false, error: health.error }
      // Only warm up a local (Ollama) model with a probe generation. For a remote
      // paid provider the health check (models fetch) already proves connectivity
      // and auth; a probe would be a billable completion on every screenshot.
      const config = providerId
        ? this.settings.get("ai").providers[providerId]
        : this.activeProvider
      if (config?.type === "ollama") {
        await this.generate("Hello, respond with just 'OK'", {
          stream: false,
          providerId,
          temperatureCap: 0,
        })
      }
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
