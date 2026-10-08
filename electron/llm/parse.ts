import { isChatModel } from "./modelFit"

// Pure, dependency-free parsing helpers for the local LLM path. Extracted from
// LLMHelper so they can be unit-tested without constructing the class (whose
// constructor performs network I/O). No Electron imports here.

/**
 * Strip markdown code fences and extract the first JSON object from a model
 * response. Best-effort: models often wrap JSON in ```json fences or prose.
 */
export function cleanJsonResponse(text: string): string {
  text = text.replace(
    /^```(?:json|javascript|typescript|python|java|cpp|c\+\+|csharp|php|ruby|go|rust|swift|kotlin)?\n?/gim,
    ""
  )
  text = text.replace(/\n?```$/gm, "")
  text = text.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) text = jsonMatch[0]
  return text
}

/**
 * Vision capability derived from an OpenAI-compatible `/models` entry's metadata
 * (OpenRouter exposes `architecture.input_modalities`; some gateways use a
 * legacy `architecture.modality` string). Returns `undefined` when no modality
 * metadata is present, so the caller can fall back to a name heuristic.
 *
 * Explicit metadata is authoritative: a model that advertises modalities WITHOUT
 * "image" returns `false` even if its name looks vision-like — the provider is
 * the source of truth over a guess.
 */
export function visionFromModality(rawEntry: unknown): boolean | undefined {
  if (typeof rawEntry !== "object" || rawEntry === null) return undefined
  // TokenVisor-style gateways (Sharon AI) publish a flat capabilities list,
  // e.g. ["chat", "tool", "reasoning", "image"].
  const caps = (rawEntry as { capabilities?: unknown }).capabilities
  if (Array.isArray(caps) && caps.every((c) => typeof c === "string")) {
    return caps.some((c) => /^(image|vision|multimodal)$/i.test(c))
  }
  const arch = (rawEntry as { architecture?: unknown }).architecture
  if (typeof arch !== "object" || arch === null) return undefined
  const mods = (arch as { input_modalities?: unknown }).input_modalities
  if (Array.isArray(mods)) {
    return mods.some((m) => typeof m === "string" && m.toLowerCase() === "image")
  }
  const modality = (arch as { modality?: unknown }).modality
  if (typeof modality === "string") return /image|vision|multimodal/i.test(modality)
  return undefined
}

/**
 * Name-based vision-capability guess, used when a provider's catalog carries no
 * modality metadata (NVIDIA NIM, most self-hosted gateways). Two layers:
 *
 *  1. Generic multimodal tokens that appear across providers' naming
 *     ("vision", "multimodal", "vlm", a "-vl" suffix). These catch hyphenated
 *     NVIDIA ids like "meta/llama-3.2-90b-vision-instruct" that an exact-family
 *     list kept missing.
 *  2. Known multimodal families whose names do NOT contain a vision token —
 *     Llama 4 (maverick/scout), Pixtral, LLaVA, InternVL, etc.
 *
 * Deliberately excludes a bare "image" token so image-GENERATION models (which
 * take text and emit an image) are not mistaken for vision-INPUT chat models.
 */
export function heuristicVision(modelName: string): boolean {
  const m = modelName.toLowerCase()
  // An embedding/retriever that ACCEPTS images ("...-vlm-embed") is not a
  // vision chat model; never offer one for screenshot analysis.
  if (!isChatModel(m)) return false
  if (/vision|multimodal|vlm|-vl\b|\bvl-/.test(m)) return true
  const known = [
    "llava",
    "bakllava",
    "moondream",
    "cogvlm",
    "minicpm-v",
    "qwen2-vl",
    "qwen2.5-vl",
    "qwen2.5vl",
    "qwen2vl",
    "gemma3",
    "gemma-3",
    "pixtral",
    "llama-4",
    "llama4",
    "maverick",
    "scout",
    "internvl",
    "vila",
    "neva",
    "kosmos",
    "paligemma",
    "molmo",
    "aria",
  ]
  return known.some((v) => m.includes(v))
}

/**
 * Split a growing NDJSON buffer into complete lines, returning the leftover
 * partial line as `rest`. Callers accumulate `rest` across stream chunks so a
 * JSON frame split across two network reads is never dropped (the token-loss bug
 * a naive per-chunk `split('\n')` causes).
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = []
  let nl: number
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line) lines.push(line)
  }
  return { lines, rest: buffer }
}

/**
 * Whether a raw /models entry is a usable, current chat model according to the
 * provider's own metadata. Gateways like TokenVisor (Sharon AI) publish a
 * `type` ("llm", "embedding", ...) and an `expiration_date`; an expired entry
 * would fail with 410 and a non-LLM entry cannot answer a chat completion, so
 * both are dropped at discovery time. Entries without such metadata (OpenAI,
 * OpenRouter, NVIDIA) are kept — name-based filtering covers those.
 */
export function isUsableCatalogEntry(rawEntry: unknown, now: number = Date.now()): boolean {
  if (typeof rawEntry !== "object" || rawEntry === null) return true
  const e = rawEntry as { type?: unknown; expiration_date?: unknown }
  if (typeof e.type === "string" && !/^(llm|vlm|chat|model|text-generation)$/i.test(e.type)) {
    return false
  }
  if (typeof e.expiration_date === "string" && e.expiration_date) {
    const at = Date.parse(e.expiration_date)
    if (Number.isFinite(at) && at <= now) return false
  }
  return true
}
