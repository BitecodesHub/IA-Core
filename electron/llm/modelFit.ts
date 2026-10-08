// Pure model-fitness logic: which discovered models are usable for chat, how
// capable they are, how to classify a provider failure, and which models to try
// (in order) for a request. No Electron imports, so all of it is unit-testable.
//
// WHY THIS EXISTS
// ---------------
// Provider catalogs churn. NVIDIA NIM retires models on a schedule (HTTP 410
// "reached its end of life") and some listed entries answer 404 "Function not
// found". Before this module, a single dead configured model made EVERY request
// fail with an opaque "Couldn't complete" — chat and screenshots alike — and the
// per-provider fallback list only worked on OpenRouter (which fails over
// server-side). This module lets LLMHelper fall back client-side to models the
// provider actually serves, and decide when it is safe to heal saved settings.

import type { AiProviderSettings } from "../config/schema"

/** Minimal shape of a discovered model (structurally compatible with ModelInfo). */
export interface DiscoveredModel {
  name: string
  vision: boolean
}

// ---------------------------------------------------------------------------
// Chat-model filter
// ---------------------------------------------------------------------------

/**
 * Catalog entries that are NOT conversational models: embeddings, rerankers,
 * retrievers, reward/judge models, safety guards, document parsers,
 * translators, detectors, CLIP-style encoders, speech and image generation.
 * Sending a chat completion to one of these fails or returns nonsense, so they
 * must never be auto-selected — NVIDIA's catalog mixes all of them together.
 */
const NON_CHAT =
  /embed|rerank|retriever|reward|guard|safety|topic-control|parse|translate|detector|calibration|clip|deplot|whisper|ocr|diffusion|stable-diffusion|sdxl|flux/

export function isChatModel(name: string): boolean {
  const n = name.toLowerCase()
  if (NON_CHAT.test(n)) return false
  if (/(^|[^a-z])(tts|asr)([^a-z]|$)/.test(n)) return false
  return true
}

// ---------------------------------------------------------------------------
// Capability ranking (shared with the renderer's model picker)
// ---------------------------------------------------------------------------

/**
 * Frontier/family capability tiers, best first. Heuristic and name-based — an
 * OpenAI-compatible /models list carries no quality metadata. Kept compact on
 * purpose: a long list of exact ids would rot every release; parameter size
 * (parsed from the name) does the fine-grained ordering within a tier.
 */
const CAPABILITY_TIERS: RegExp[] = [
  // Tier 0 — current frontier.
  /claude.*opus|gpt-?4o|gpt-?4\.1|gpt-?5|\bo1\b|\bo3\b|gemini.*2\.5.*pro|gemini-?3|llama-?4.*maverick|deepseek[.-]?r1|nova-?premier|deepseek.*v[3-9]|qwen.*max|qwen3|grok-?[2-9]|mistral-?large|pixtral-?large|kimi-?k[2-9]|glm-?[5-9]|nemotron.*ultra/,
  // Tier 1 — strong current-gen.
  /claude.*sonnet|gemini.*(2|1\.5).*pro|gemini.*2|llama-?4|llama-?3[.-]3|nova-?pro|qwen2\.5|qwq|deepseek|command-?r\+?|mixtral-?8x22|nemotron|gemma-?4|gpt-oss/,
  // Tier 2 — capable mid-tier.
  /claude.*haiku|llama-?3[.-]2|llama-?3[.-]1|nova-?lite|gemma-?3|gemma-?2|qwen2|phi-?4|phi-?3\.5|mistral|mixtral|pixtral|granite|codestral/,
]

/**
 * Capability score, LOWER = more capable = shown/tried first. Family tier
 * dominates; within a tier the parameter count encoded in the name breaks
 * ties (larger first). Non-chat models always sort last. Purely an ordering
 * heuristic — it never hides a model.
 */
export function rankModelCapability(name: string): number {
  const n = name.toLowerCase()
  if (!isChatModel(n)) return 99_000
  let tier = CAPABILITY_TIERS.length
  for (let i = 0; i < CAPABILITY_TIERS.length; i++) {
    if (CAPABILITY_TIERS[i].test(n)) {
      tier = i
      break
    }
  }
  // Largest "<number>b" token = parameter count in billions ("128e" expert
  // counts have no trailing 'b' and are ignored; "a12b" active-param tokens are
  // smaller than the total and lose to it under max()).
  let sizeB = 0
  for (const tok of n.match(/(\d+(?:\.\d+)?)b\b/g) ?? []) {
    const v = parseFloat(tok)
    if (Number.isFinite(v)) sizeB = Math.max(sizeB, v)
  }
  return tier * 1000 - Math.min(sizeB, 999)
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 *  - gone:         the model is retired / does not exist here. Never retry it;
 *                  move to the next model immediately. Safe to heal settings
 *                  once a replacement succeeds.
 *  - incompatible: the request shape does not suit THIS model (unsupported
 *                  parameter, context too long, no image input). Try another
 *                  model, but never heal — the model itself is fine.
 *  - unavailable:  this ACCOUNT cannot use this model (Bedrock: model access not
 *                  enabled / not offered in the region). Skip it for the session,
 *                  but never heal settings — access can be granted later.
 *  - auth:         the key is missing/invalid. Other models will fail the same
 *                  way, so skip to the next provider.
 *  - ratelimit:    429. Free tiers are often limited per model, so another
 *                  model may still work.
 *  - transient:    network blip / 5xx. Retry with backoff.
 *  - other:        unclassified; retry within the normal budget.
 */
export type ModelErrorKind =
  | "gone"
  | "unavailable"
  | "incompatible"
  | "auth"
  | "ratelimit"
  | "transient"
  | "other"

const GONE_TEXT =
  /end of life|model identifier is invalid|no longer available|decommission|has been (?:removed|retired|deprecated)|does not exist|model not found|unknown model|invalid model|function not found|not found for account|model .{0,80}not (?:found|available|supported)/

/** Per-model (not per-key) access refusals. */
const MODEL_ACCESS_TEXT =
  /access to the model|model access|not (?:enabled|authorized|available) for (?:this|your) (?:account|model)|not available in (?:this|your) region|isn't available in this region/

const INCOMPATIBLE_TEXT =
  /unsupported parameter|validation|context length|maximum context|too many tokens|too long|image(?:s)? (?:input )?(?:is |are )?not supported|does not support (?:image|vision)|invalid image/

export function classifyModelError(message: string): ModelErrorKind {
  const m = String(message ?? "").toLowerCase()
  const status = Number(m.match(/error\s+(\d{3})\b/)?.[1] ?? NaN)

  // A 403 can mean "bad key" (stop using the provider) or "this account may not
  // use THIS model" (try another model) — Bedrock answers the latter with
  // AccessDeniedException "You don't have access to the model ...".
  if (status === 403 && MODEL_ACCESS_TEXT.test(m)) return "unavailable"
  if (status === 401 || status === 403) return "auth"
  if (status === 404 || status === 410) return "gone"
  if (status === 429) return "ratelimit"
  if (status === 408 || status === 409 || status === 425 || status >= 500) return "transient"
  if (status === 400 || status === 422) {
    // Some gateways report a missing model as a 400 — trust the text.
    if (GONE_TEXT.test(m)) return "gone"
    return "incompatible"
  }

  // No status code: decide by phrasing.
  if (MODEL_ACCESS_TEXT.test(m)) return "unavailable"
  if (/requires an api key|api key|unauthori[sz]ed|forbidden|invalid (?:auth|credentials)/.test(m)) {
    return "auth"
  }
  if (GONE_TEXT.test(m)) return "gone"
  if (INCOMPATIBLE_TEXT.test(m)) return "incompatible"
  if (
    /network|fetch failed|econnreset|econnrefused|etimedout|timed out|timeout|socket|stalled|aborted|busy|overloaded|temporarily/.test(
      m
    )
  ) {
    return "transient"
  }
  return "other"
}

// ---------------------------------------------------------------------------
// Candidate planning
// ---------------------------------------------------------------------------

export interface PlanInput {
  config: AiProviderSettings
  hasImage: boolean
  /** The model the router/pickModel chose first. */
  primary: string
  /** Discovered catalog, or null when discovery failed (unknown availability). */
  discovered: DiscoveredModel[] | null
  /** Models already proven dead for this provider in this session. */
  dead: ReadonlySet<string>
  /**
   * OpenRouter fails over server-side via its native `models` array, so its
   * fallback list must not ALSO be replayed client-side.
   */
  nativeFallback: boolean
  /** Upper bound on models tried per request, to bound latency. */
  max?: number
  /** Vision heuristic for names not present in the catalog. */
  guessVision?: (name: string) => boolean
}

/**
 * Ordered, de-duplicated list of models to try for one request:
 *   0. the routed primary (always first, so a dead one is proven and healed),
 *   1. the user's other configured models (slot + fallbacks) that the provider
 *      actually LISTS,
 *   2. the best-ranked listed chat models (vision-capable for screenshots),
 *   3. configured models that are NOT listed — last resort, since a provider's
 *      catalog omits retired models (NVIDIA does) but may also be incomplete.
 * Dead models are never retried within a session.
 */
export function planCandidateModels(input: PlanInput): string[] {
  const { config, hasImage, primary, discovered, dead, nativeFallback } = input
  const max = Math.max(1, input.max ?? 5)
  const guessVision = input.guessVision ?? (() => false)
  const known = new Map((discovered ?? []).map((m) => [m.name, m]))
  const haveCatalog = known.size > 0

  const usableForRequest = (id: string): boolean => {
    if (!id || dead.has(id) || !isChatModel(id)) return false
    if (!hasImage) return true
    const entry = known.get(id)
    return entry ? entry.vision : guessVision(id)
  }

  const configured = [
    primary,
    ...(hasImage ? [config.visionModel] : [config.highModel, config.lowModel]),
    ...(nativeFallback ? [] : (config.fallbackModels ?? [])),
  ].filter((id) => usableForRequest(id))

  const listedConfigured = configured.filter((id) => !haveCatalog || known.has(id))
  const unlistedConfigured = configured.filter((id) => haveCatalog && !known.has(id))

  const auto = haveCatalog
    ? [...known.values()]
        .filter((m) => usableForRequest(m.name))
        .sort((a, b) => rankModelCapability(a.name) - rankModelCapability(b.name) || a.name.localeCompare(b.name))
        .map((m) => m.name)
    : []

  // The routed primary always goes first when it is still usable, even if the
  // catalog omits it: one quick attempt either works (incomplete catalog) or
  // returns a definitive 404/410 — and that proof is what allows LLMHelper to
  // heal the saved setting. Skipping it silently would answer via a fallback
  // forever while the dead model stayed configured.
  const head = usableForRequest(primary) ? [primary] : []

  const ordered: string[] = []
  for (const id of [...head, ...listedConfigured, ...auto, ...unlistedConfigured]) {
    if (!ordered.includes(id)) ordered.push(id)
    if (ordered.length >= max) break
  }
  // Always attempt at least the primary choice, even if every heuristic above
  // rejected it — failing loudly beats silently doing nothing.
  if (ordered.length === 0 && primary && !dead.has(primary)) ordered.push(primary)
  return ordered
}

// ---------------------------------------------------------------------------
// Settings healing
// ---------------------------------------------------------------------------

/**
 * Settings patch that replaces models proven gone with a model that just
 * succeeded on the same provider (which proves the endpoint and key are fine,
 * so this can never be triggered by a provider-wide outage). Only the slots
 * matching the request type are healed: a vision request heals the vision slot,
 * a text request heals the text slots. Dead entries are dropped from the
 * fallback list. Returns null when nothing needs to change.
 */
export function buildHealPatch(
  config: AiProviderSettings,
  gone: readonly string[],
  replacement: string,
  hasImage: boolean
): Partial<Pick<AiProviderSettings, "lowModel" | "highModel" | "visionModel" | "fallbackModels">> | null {
  const dead = new Set(gone.filter(Boolean))
  if (dead.size === 0 || !replacement || dead.has(replacement)) return null
  const patch: Partial<Pick<AiProviderSettings, "lowModel" | "highModel" | "visionModel" | "fallbackModels">> = {}

  if (hasImage) {
    if (dead.has(config.visionModel)) patch.visionModel = replacement
  } else {
    if (dead.has(config.highModel)) patch.highModel = replacement
    if (dead.has(config.lowModel)) patch.lowModel = replacement
  }
  const fallbacks = config.fallbackModels ?? []
  const keptFallbacks = fallbacks.filter((id) => !dead.has(id))
  if (keptFallbacks.length !== fallbacks.length) patch.fallbackModels = keptFallbacks

  return Object.keys(patch).length > 0 ? patch : null
}
