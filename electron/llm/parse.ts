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

/** Name-based vision-capability guess, used when /api/show is unavailable. */
export function heuristicVision(modelName: string): boolean {
  const known = [
    "llama3.2-vision",
    "llava",
    "llava-llama3",
    "llava-phi3",
    "gemma3",
    "bakllava",
    "moondream",
    "cogvlm",
    "minicpm-v",
    "qwen2-vl",
    "qwen2.5-vl",
    "qwen2.5vl",
  ]
  const m = modelName.toLowerCase()
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
