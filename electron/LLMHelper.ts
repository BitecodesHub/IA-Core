import fs from "fs"
import { SettingsService } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import { AudioService } from "./audio/AudioService"
import type { AiProviderSettings } from "./config/schema"
import { cleanJsonResponse, heuristicVision } from "./llm/parse"
import { selectModel, type TaskContext, type ModelTiers } from "./llm/router"
import { pickModel } from "./llm/pick"
import { isTransientError, backoffDelayMs } from "./llm/retry"
import { recommendedModels } from "./llm/defaults"
import { VertexGeminiProvider } from "./llm/vertex"
import { BedrockProvider } from "./llm/bedrock"
import { BitecodesProvider, LOGIN_REQUIRED } from "./llm/bitecodes"
import { BitecodesAuth, notesClient } from "./bitecodesAuth"
import { UpdateChecker } from "./updateCheck"
import { buildHealPatch, classifyModelError, planCandidateModels } from "./llm/modelFit"
import { shouldAutoHealthCheck } from "./llm/mode"
import {
  OllamaProvider,
  OpenAICompatibleProvider,
  isOpenRouterEndpoint,
  type GenerateOptions,
  type LlmProvider,
  type ModelInfo,
  type ModelDiscoveryResult,
  type ProviderHealth,
  type RequestKind,
} from "./llm/providers"

interface GenerateOpts {
  stream?: boolean
  images?: string[]
  model?: string
  providerId?: string
  /** Providers to leave out of the sequence (e.g. one already tried). */
  skipProviderIds?: string[]
  onToken?: (token: string) => void
  signal?: AbortSignal
  temperatureCap?: number
  /** Reported to Bitecodes' prompt log (chat, screenshot, solution, debug). */
  kind?: RequestKind
}

// Extra retry budget for transient failures, on top of the user's requestRetries
// setting. Slow networks should recover rather than surface an error, so these are
// generous; total wall-clock is bounded only by the idle-timeout per attempt.
const MAX_TRANSIENT_RETRIES = 5
const RETRY_BASE_MS = 500
/**
 * Streaming hedge: if a remote model has not produced its FIRST token within
 * this window and another candidate model exists, abandon it and try the next.
 * Measured on NVIDIA NIM's free tier: llama-3.2-90b-vision queued 13-32s and
 * once stalled ~160s, while llama-3.2-11b-vision answered in 0.4s. Without a
 * hedge a queued model held the screenshot flow hostage for minutes ("stuck").
 * Generous enough that a healthy large model normally answers within it.
 */
const FIRST_TOKEN_DEADLINE_MS = 30_000
/** Known number in the vision-probe image, and how long the probe may take. */
const VISION_PROBE_NUMBER = "4827"
const VISION_PROBE_TIMEOUT_MS = 25_000

/** Stage 1 of screenshot analysis: faithful transcription, no reasoning. */
const SCREENSHOT_TRANSCRIBE_PROMPT = `Transcribe the meaningful content of this screenshot exactly, character for character.
Include: any question or problem statement (with its title), all options/choices, constraints, examples with their inputs and outputs, tables, formulas, and any code (keep indentation and the exact function/class signatures).
Ignore browser chrome, menus, toolbars and other UI clutter.
Do NOT solve, explain or summarise anything. Output only the transcription.`

/** A transcription worth reasoning over (not empty, not a refusal). */
function isUsableTranscript(text: string): boolean {
  const t = String(text ?? "").trim()
  if (t.length < 20) return false
  return !/(not able|unable|can(?:no|')t) (?:to )?(?:view|see|read|process) (?:the )?images?/i.test(t.slice(0, 300))
}

/** Stage 2 prompt: the original task, answered from the transcription. */
function buildSolvePrompt(task: string, transcript: string): string {
  return `${task}

You cannot see the screenshot directly. It has been transcribed exactly below; treat this transcription as the screenshot and base your answer ONLY on it. Pay close attention to the exact problem title, function signature and examples.
If it is a programming problem, the screenshot may not show the constraints: assume the LARGEST constraints usual for that problem and use the asymptotically optimal algorithm (never a naive simulation when inputs can be huge). Keep the exact function signature shown.

<<<SCREENSHOT
${transcript.trim()}
SCREENSHOT>>>`
}
// Stealth: model-healing notes mention model ids/timing — dev only.
const isDev = process.env.NODE_ENV === "development"
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
  /**
   * Models a provider has proven gone (404/410) in this session, per provider.
   * They are skipped instead of re-failing on every request until the app
   * restarts or the provider's endpoint changes.
   */
  private deadModels = new Map<string, Set<string>>()
  /**
   * Vision-probe verdicts per "<provider>::<model>". Catalog metadata is not
   * trustworthy here — on Sharon AI, nemotron-3-super advertises "image" but
   * returns 422, and gpt-oss-120b advertises "image" but replies "I'm not able
   * to view images". A one-time probe per model per session settles it.
   */
  private visionVerdicts = new Map<string, boolean>()
  private probeImage: Promise<string | null> | null = null

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

  private providerSequence(providerId?: string, skip: string[] = []): AiProviderSettings[] {
    const ai = this.settings.get("ai")
    const ids = providerId ? [providerId] : [ai.activeProviderId, ...ai.fallbackProviderIds]
    const seen = new Set<string>(skip)
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
    if (config.type === "bitecodes") {
      return new BitecodesProvider(config, () => SecretStore.getInstance().getProviderApiKey(config.id), {
        onUnauthorized: () => BitecodesAuth.getInstance().handleRevoked(),
        client: notesClient(),
      })
    }
    if (config.type === "bedrock-converse") {
      return new BedrockProvider(config, () =>
        SecretStore.getInstance().getProviderApiKey(config.id)
      )
    }
    if (config.type === "vertex-gemini") {
      return new VertexGeminiProvider(config, () =>
        SecretStore.getInstance().getProviderApiKey(config.id)
      )
    }
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

  /**
   * Notes only works for signed-in Bitecodes users. Enforced here, in the main
   * process, so no renderer path (shortcuts, auto-screenshot, chat) gets around
   * it. A token is enough: a revoked one is caught by BitecodesAuth.status(),
   * which deletes it.
   */
  private requireSignIn(): void {
    if (UpdateChecker.getInstance().isUpdateRequired()) {
      throw new Error("This version of Notes is no longer supported. Download the update to continue.")
    }
    if (!SecretStore.getInstance().hasProviderApiKey("bitecodes")) throw new Error(LOGIN_REQUIRED)
  }

  private async generate(prompt: string, opts: GenerateOpts = {}): Promise<string> {
    this.requireSignIn()
    const ctx: TaskContext = { prompt, hasImage: Boolean(opts.images?.length) }
    const providers = this.providerSequence(opts.providerId, opts.skipProviderIds)
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
    for (const [providerIndex, config] of providers.entries()) {
      // A revoked sign-in (401 from Bitecodes) ends the chain: no fallback
      // provider may answer for a signed-out user.
      this.requireSignIn()
      const provider = this.createProvider(config)
      // When another provider is waiting, a struggling one gets a short leash:
      // the generous transient budget exists for a user with ONE provider on a
      // flaky link. With a fallback available, burning ~40s of backoff on a dead
      // provider before trying a healthy one measured 434s end to end.
      const hasFallbackProvider = providerIndex < providers.length - 1

      // Ordered list of models to try on this provider. An explicit model is
      // honoured strictly; otherwise start with the routed choice and fall back
      // to the user's other configured models, then to the best models the
      // provider actually serves (vision-capable ones for screenshots).
      let candidates: string[]
      let discovered: ModelInfo[] | null = null
      if (opts.model) {
        candidates = [opts.model]
      } else {
        let primary: string
        try {
          primary = await this.chooseModel(config, ctx)
        } catch (err: any) {
          errors.push(`${config.name}: ${err?.message ?? err}`)
          continue
        }
        // chooseModel just populated the 30s discovery cache, so this is free.
        discovered = await this.discoverModels(config.id).catch((): null => null)
        candidates = planCandidateModels({
          config,
          hasImage: ctx.hasImage,
          primary,
          discovered,
          dead: this.deadSet(config.id),
          nativeFallback: isOpenRouterEndpoint(config.endpoint),
          guessVision: heuristicVision,
        })
      }

      const gone: string[] = []
      // Models that answered the vision probe wrongly: still fine for text, so
      // they are never marked dead — only healed out of the vision slot.
      const blind: string[] = []
      let nextProvider = false
      for (const [index, model] of candidates.entries()) {
        if (nextProvider) break
        // Bitecodes verifies vision server-side; probing it would cost a round trip.
        if (ctx.hasImage && !opts.model && config.type !== "ollama" && config.type !== "bitecodes") {
          const sees = await this.verifyVision(provider, config, model, opts.signal)
          if (opts.signal?.aborted) throw new Error("Request cancelled.")
          if (!sees) {
            blind.push(model)
            errors.push(`${config.name}/${model}: cannot read images (vision check failed)`)
            continue
          }
        }
        let attempt = 0
        for (;;) {
          // Hedge only when it can help: a streaming request (so "first token"
          // is observable), a remote provider (local Ollama cold-loads are slow
          // but legitimate), and another candidate left to fall back to.
          const hedge =
            (opts.stream ?? false) &&
            Boolean(onToken) &&
            config.type !== "ollama" &&
            index < candidates.length - 1
          const attemptCtl = new AbortController()
          const forwardAbort = () => attemptCtl.abort()
          if (opts.signal?.aborted) attemptCtl.abort()
          else opts.signal?.addEventListener("abort", forwardAbort, { once: true })
          let firstTokenSeen = false
          let deadlineHit = false
          const deadline = hedge
            ? setTimeout(() => {
                if (!firstTokenSeen) {
                  deadlineHit = true
                  attemptCtl.abort()
                }
              }, FIRST_TOKEN_DEADLINE_MS)
            : undefined
          const attemptOnToken = onToken
            ? (t: string) => {
                firstTokenSeen = true
                if (deadline) clearTimeout(deadline)
                onToken(t)
              }
            : undefined
          // Reasoning models stream "thinking" before any answer token; that is
          // progress, not a stall, so it also disarms the hedge.
          const onActivity = () => {
            firstTokenSeen = true
            if (deadline) clearTimeout(deadline)
          }
          try {
            const output = await provider.generate({
              prompt,
              model,
              stream: opts.stream ?? false,
              images: opts.images,
              onToken: attemptOnToken,
              onActivity,
              signal: attemptCtl.signal,
              options: this.generationOptions(config, opts.temperatureCap),
              kind: opts.kind,
            })
            // A different model just worked on this same provider, so the key
            // and endpoint are fine: replace the dead configured models in saved
            // settings so the next request (and the next launch) does not fail.
            if (gone.length > 0 || blind.length > 0) {
              this.healModels(config.id, gone, model, ctx.hasImage, blind)
            }
            return output
          } catch (err: any) {
            const message = err?.message ?? String(err)
            if (opts.signal?.aborted) throw new Error("Request cancelled.")
            // Never replay a partially-streamed response (would duplicate output).
            if (streamedAny) throw err instanceof Error ? err : new Error(message)
            if (deadlineHit) {
              // Queued/slow, not broken: move on without marking it dead.
              errors.push(
                `${config.name}/${model}: no response within ${FIRST_TOKEN_DEADLINE_MS / 1000}s`
              )
              break
            }

            const kind = classifyModelError(message)
            const label = `${config.name}/${model}: ${message}`
            if (kind === "auth") {
              // Every model on this provider will fail the same way.
              errors.push(label)
              nextProvider = true
              break
            }
            if (kind === "gone") {
              this.deadSet(config.id).add(model)
              gone.push(model)
              errors.push(label)
              break // next model, immediately — retrying a retired model is pointless
            }
            if (kind === "unavailable") {
              // Account-level: skip it for this session, but never heal it out of
              // settings — the user may enable access to it later.
              this.deadSet(config.id).add(model)
              errors.push(label)
              break
            }
            if (kind === "incompatible") {
              errors.push(label)
              break // this model cannot take this request; another one might
            }

            // ratelimit / transient / other: retry with backoff, then move on.
            const budget =
              kind === "transient" || kind === "ratelimit"
                ? hasFallbackProvider
                  ? Math.min(retries, 1)
                  : Math.max(retries, MAX_TRANSIENT_RETRIES)
                : retries
            if (attempt >= budget) {
              errors.push(label)
              // A network-level outage affects every model on this provider;
              // a rate limit is often per-model on free tiers, so keep trying.
              if (kind === "transient") nextProvider = true
              break
            }
            attempt++
            await new Promise((resolve) =>
              setTimeout(resolve, backoffDelayMs(attempt, RETRY_BASE_MS, RETRY_CAP_MS))
            )
          } finally {
            if (deadline) clearTimeout(deadline)
            opts.signal?.removeEventListener("abort", forwardAbort)
          }
        }
      }
    }
    throw new Error(`All configured providers failed. ${errors.join(" | ")}`)
  }

  /** A small synthetic image with a known number, rendered once. */
  private getProbeImage(): Promise<string | null> {
    if (!this.probeImage) {
      this.probeImage = (async () => {
        try {
          const sharp = require("sharp")
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="100%" height="100%" fill="#ffffff"/><text x="40" y="112" font-size="96" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="#000000">${VISION_PROBE_NUMBER}</text></svg>`
          const jpeg: Buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
          return jpeg.toString("base64")
        } catch {
          return null // no renderer available: fall back to trusting metadata
        }
      })()
    }
    return this.probeImage
  }

  /**
   * Can this model actually read an image? Asks it to read a known number.
   * Definitive answers are cached per session; inconclusive outcomes (network,
   * auth, rate limit, timeout) are NOT cached and do not block the request.
   */
  private async verifyVision(
    provider: LlmProvider,
    config: AiProviderSettings,
    model: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const key = `${config.id}::${model}`
    const cached = this.visionVerdicts.get(key)
    if (cached !== undefined) return cached
    const image = await this.getProbeImage()
    if (!image) return true

    const ctl = new AbortController()
    const forward = () => ctl.abort()
    signal?.addEventListener("abort", forward, { once: true })
    const timer = setTimeout(() => ctl.abort(), VISION_PROBE_TIMEOUT_MS)
    try {
      const reply = await provider.generate({
        prompt: "What number is written in this image? Reply with only the digits.",
        model,
        stream: false,
        images: [image],
        signal: ctl.signal,
        options: { ...this.generationOptions(config, 0), numPredict: 512 },
      })
      const sees = String(reply).replace(/[^0-9]/g, "").includes(VISION_PROBE_NUMBER)
      this.visionVerdicts.set(key, sees)
      if (isDev) console.log(`[LLMHelper] vision probe ${key}: ${sees ? "pass" : "FAIL"}`)
      return sees
    } catch (err: any) {
      const kind = classifyModelError(err?.message ?? String(err))
      if (kind === "incompatible" || kind === "gone" || kind === "unavailable") {
        this.visionVerdicts.set(key, false)
        return false
      }
      return true // inconclusive — let the real request decide
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", forward)
    }
  }

  private deadSet(providerId: string): Set<string> {
    let set = this.deadModels.get(providerId)
    if (!set) {
      set = new Set<string>()
      this.deadModels.set(providerId, set)
    }
    return set
  }

  /** Persist replacements for configured models proven gone. See buildHealPatch. */
  private healModels(
    providerId: string,
    gone: string[],
    replacement: string,
    hasImage: boolean,
    blind: string[] = []
  ) {
    const config = this.settings.get("ai").providers[providerId]
    if (!config) return
    let patch: Record<string, unknown> | null = buildHealPatch(config, gone, replacement, hasImage)
    // A model that cannot see is only removed from the VISION slot.
    if (hasImage && blind.includes(config.visionModel) && replacement !== config.visionModel) {
      patch = { ...(patch ?? {}), visionModel: replacement }
    }
    if (!patch) return
    if (isDev) {
      console.log(`[LLMHelper] healed ${providerId}: ${gone.join(", ")} -> ${replacement}`, patch)
    }
    this.settings.set({ ai: { providers: { [providerId]: patch } } })
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
      const responseText = await this.generate(prompt, { stream: true, signal, kind: "solution" })
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
        kind: "debug",
      })
      return this.validateAndStructureResponse(responseText, "solution_generation")
    } catch (error: any) {
      console.error("Error debugging solution with images:", error)
      return this.createFallbackResponse("solution_generation", `Debug error: ${error.message}`)
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    this.requireSignIn()
    return AudioService.getInstance().transcribeFile(audioPath)
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    this.requireSignIn()
    return AudioService.getInstance().transcribeBase64(data, mimeType)
  }

  public async chat(message: string): Promise<string> {
    return this.generate(message, { stream: false, kind: "chat" })
  }

  public async chatStream(
    message: string,
    onToken: (t: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    return this.generate(message, { stream: true, onToken, signal, kind: "chat" })
  }

  /**
   * Screenshot analysis in two stages: READ, then SOLVE.
   *
   * Measured on a real LeetCode screenshot: llama-3.2-90b-vision transcribed
   * the problem correctly (title, statement, examples), yet when asked to solve
   * it directly it confidently answered a DIFFERENT problem. Small vision
   * models read well and reason badly. So the vision model only transcribes,
   * and the strongest TEXT model (routed normally, can be another provider)
   * reasons over the transcript. If either stage cannot be done, it degrades to
   * the old single-stage path rather than failing.
   */
  public async streamImageAnalysis(
    prompt: string,
    images: string[],
    onToken: (t: string) => void,
    signal?: AbortSignal,
    temperature?: number
  ): Promise<string> {
    const temperatureCap = temperature ?? 0.0

    // Signed in to Bitecodes: the server already does read-then-solve with the
    // operator's providers, so send the screenshot once and let it. Doing the
    // two stages here as well would double the round trips and the cost.
    const first = this.providerSequence()[0]
    let skipProviderIds: string[] = []
    if (first?.type === "bitecodes" && SecretStore.getInstance().hasProviderApiKey(first.id)) {
      let streamed = false
      try {
        return await this.generate(prompt, {
          kind: "screenshot",
          stream: true,
          images,
          signal,
          temperatureCap,
          providerId: first.id,
          onToken: (t) => {
            streamed = true
            onToken(t)
          },
        })
      } catch (err) {
        if (signal?.aborted || streamed) throw err
        // Bitecodes is down: fall back to the local providers, two-stage.
        skipProviderIds = [first.id]
      }
    }

    const direct = () =>
      this.generate(prompt, { stream: true, images, onToken, signal, temperatureCap, skipProviderIds, kind: "screenshot" })

    let transcript = ""
    try {
      transcript = await this.generate(SCREENSHOT_TRANSCRIBE_PROMPT, {
        kind: "screenshot",
        stream: false,
        images,
        signal,
        temperatureCap: 0,
        skipProviderIds,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw err // no vision model could read it at all — same outcome as before
    }
    if (!isUsableTranscript(transcript)) return direct()

    let streamed = false
    try {
      return await this.generate(buildSolvePrompt(prompt, transcript), {
        kind: "screenshot",
        stream: true,
        onToken: (t) => {
          streamed = true
          onToken(t)
        },
        signal,
        temperatureCap,
        skipProviderIds,
      })
    } catch (err) {
      if (signal?.aborted || streamed) throw err
      return direct()
    }
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
      this.deadModels.delete(providerId)
      for (const key of [...this.visionVerdicts.keys()]) {
        if (key.startsWith(`${providerId}::`)) this.visionVerdicts.delete(key)
      }
      return
    }
    this.modelCache.clear()
    this.deadModels.clear()
    this.visionVerdicts.clear()
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

  public async testConnection(
    providerId?: string
  ): Promise<{ success: boolean; error?: string; warning?: string }> {
    try {
      const health = await this.getProviderHealth(providerId)
      if (!health.ok) return { success: false, error: health.error }
      // Connectivity alone is not enough: a reachable provider whose configured
      // models were retired still fails every request. Cross-check the slots
      // against the live catalog (no billable call) and say so plainly.
      const target = providerId
        ? this.settings.get("ai").providers[providerId]
        : this.activeProvider
      let warning: string | undefined
      if (target && target.type !== "ollama") {
        const models = await this.discoverModels(target.id).catch((): ModelInfo[] => [])
        if (models.length > 0) {
          const listed = new Set(models.map((m) => m.name))
          const missing = [
            ...new Set(
              [target.visionModel, target.highModel, target.lowModel, ...(target.fallbackModels ?? [])]
                .filter((id) => id && !listed.has(id))
            ),
          ]
          if (missing.length > 0) {
            warning = `Connected, but ${target.name} does not currently offer: ${missing.join(", ")}. Requests will fall back automatically; pick a listed model to avoid the detour.`
          }
        }
      }
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
      return warning ? { success: true, warning } : { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
