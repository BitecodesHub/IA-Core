// Pure, dependency-free helpers for the model-picker combobox and the settings
// search. No React/Electron imports so they are unit-testable under Node.

export interface ModelLike {
  name: string
  vision: boolean
  /** Free-tier model (set during provider discovery, e.g. OpenRouter ":free"). */
  free?: boolean
}

export type ComboKind = "auto" | "model" | "configured"

/** A small status pill rendered on the right of an option row. */
export interface ComboBadge {
  text: string
  /** ok = green, warn = amber, muted = grey. Defaults to muted. */
  tone?: "ok" | "warn" | "muted"
}

export interface ComboOption {
  /** The value written to settings ("" for Auto). */
  value: string
  label: string
  vision?: boolean
  free?: boolean
  kind: ComboKind
  /** Secondary line under the label (e.g. a provider endpoint host). */
  detail?: string
  /**
   * Generic status pills. `free`/`vision` stay as dedicated fields because they
   * carry their own semantics in the model picker; this is for everything else
   * (provider state, "no key", and so on).
   */
  badges?: ComboBadge[]
}

export interface BuildOptions {
  /** The currently-configured value ("" = Auto). */
  value: string
  /** Restrict the model list to vision-capable models. */
  visionOnly?: boolean
  /** Label for the Auto option (default "Auto"). */
  autoLabel?: string
}

/**
 * Known-strong free-tier model families, best first. Used only to order the
 * "Free models" section — a name matching none of these simply sorts after the
 * curated ones (alphabetically), so staleness degrades gracefully as providers
 * rotate their free catalog.
 */
const FREE_FAMILY_RANK = [
  "deepseek-r1",
  "deepseek",
  "llama-4",
  "llama-3.3",
  "qwen3",
  "qwq",
  "qwen",
  "gemini-2",
  "gemma-3",
  "glm",
  "kimi",
  "mistral",
  "hermes",
  "phi",
]

/** Rank a free model by curated family quality; unknown families sort last. */
export function rankFreeModel(name: string): number {
  const n = name.toLowerCase()
  const i = FREE_FAMILY_RANK.findIndex((family) => n.includes(family))
  return i < 0 ? FREE_FAMILY_RANK.length : i
}

// Capability ranking lives in the main-process module so the model PICKER (this
// file) and the runtime FALLBACK planner (LLMHelper) order models identically.
import { rankModelCapability } from "../../electron/llm/modelFit"
export { rankModelCapability }

/**
 * Build the option list for a model slot: an Auto option first, then (if the
 * configured value is not present in the discovered list — e.g. a hand-entered
 * or vision-filtered slug) a pinned "(configured)" option preserving it, then the
 * discovered models — free-tier models first, then paid, each group ordered
 * most-capable-first (see rankModelCapability). Preserving the configured
 * value mirrors the old ModelsTab "(configured)" affordance so a valid slug is
 * never silently dropped.
 */
export function buildModelOptions(models: ModelLike[], opts: BuildOptions): ComboOption[] {
  const { value, visionOnly, autoLabel } = opts
  // Vision slot: normally restrict to vision-flagged models. But capability
  // detection is heuristic and provider-dependent — NVIDIA NIM and many
  // gateways report no modality metadata, so a strict filter can flag ZERO
  // models and strand the user on "Auto" with nothing to pick. When that
  // happens, fall back to the full list so a vision model can still be chosen
  // by hand; selecting it also teaches discovery (it matches config.visionModel).
  const visionList = models.filter((m) => m.vision)
  const list = visionOnly ? (visionList.length > 0 ? visionList : models) : models
  const options: ComboOption[] = [{ value: "", label: autoLabel ?? "Auto", kind: "auto" }]

  if (value && !list.some((m) => m.name === value)) {
    const known = models.find((m) => m.name === value)
    options.push({
      value,
      label: `${value} (configured)`,
      vision: known?.vision,
      kind: "configured",
    })
  }

  // Most capable first, within each group. Free models stay grouped ahead of
  // paid so the "Free models" section header (Combobox) still lands correctly;
  // within both groups the order is capability-ranked (best at top), tie-broken
  // by name for stability.
  const byCapability = (a: ModelLike, b: ModelLike) =>
    rankModelCapability(a.name) - rankModelCapability(b.name) || a.name.localeCompare(b.name)
  const free = list.filter((m) => m.free).sort(byCapability)
  const paid = list.filter((m) => !m.free).sort(byCapability)
  for (const m of [...free, ...paid]) {
    options.push({ value: m.name, label: m.name, vision: m.vision, free: m.free, kind: "model" })
  }
  return options
}

/** Rank a label against a lowercased query: 0 = prefix, 1 = word-boundary, 2 = substring, -1 = no match. */
function rankLabel(label: string, query: string): number {
  const idx = label.indexOf(query)
  if (idx < 0) return -1
  if (idx === 0) return 0
  return /[^a-z0-9]/i.test(label[idx - 1]) ? 1 : 2
}

/**
 * Best (lowest) rank across an option's label and detail line.
 * `rankLabel` uses -1 for "no match" and 0..2 for match quality, so the two
 * scores cannot simply be min()'d — a -1 would win and drop a real match.
 */
function bestScore(option: ComboOption, query: string): number {
  const scores = [rankLabel(option.label.toLowerCase(), query)]
  if (option.detail) scores.push(rankLabel(option.detail.toLowerCase(), query))
  const matches = scores.filter((s) => s >= 0)
  return matches.length === 0 ? -1 : Math.min(...matches)
}

/**
 * Filter+rank options by a search query. The Auto and configured options are
 * always kept (pinned first); only model options are filtered. Ranking prefers
 * prefix, then word-boundary, then substring matches; ties keep discovery order.
 */
export function filterOptions(options: ComboOption[], query: string): ComboOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  const pinned = options.filter((o) => o.kind !== "model")
  const scored = options
    .filter((o) => o.kind === "model")
    // Match the detail line too, so a provider can be found by its host
    // ("groq.com") as well as by its display name.
    .map((o, i) => ({ o, i, score: bestScore(o, q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.o)
  return [...pinned, ...scored]
}

/** Cap the rendered option count (perf for providers with hundreds of models). */
export function capOptions(
  options: ComboOption[],
  max: number
): { visible: ComboOption[]; hiddenCount: number } {
  if (options.length <= max) return { visible: options, hiddenCount: 0 }
  return { visible: options.slice(0, max), hiddenCount: options.length - max }
}

/** Human hint describing what Auto does for a slot (matches router.ts fallbacks). */
export function autoHintForSlot(slot: "low" | "high" | "vision"): string {
  switch (slot) {
    case "vision":
      return "Auto — use a vision-capable model (falls back to the High, then Low model)."
    case "high":
      return "Auto — use the strong model (falls back to the Low model)."
    case "low":
    default:
      return "Auto — use the fast model (falls back to the High, then Vision model)."
  }
}

/** Case-insensitive label match for the settings search box. Empty query matches all. */
export function matchesSetting(label: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return label.toLowerCase().includes(q)
}
