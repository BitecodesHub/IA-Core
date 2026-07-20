// Pure, dependency-free helpers for the model-picker combobox and the settings
// search. No React/Electron imports so they are unit-testable under Node.

export interface ModelLike {
  name: string
  vision: boolean
}

export type ComboKind = "auto" | "model" | "configured"

export interface ComboOption {
  /** The value written to settings ("" for Auto). */
  value: string
  label: string
  vision?: boolean
  kind: ComboKind
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
 * Build the option list for a model slot: an Auto option first, then (if the
 * configured value is not present in the discovered list — e.g. a hand-entered
 * or vision-filtered slug) a pinned "(configured)" option preserving it, then the
 * discovered models. Preserving the configured value mirrors the old ModelsTab
 * "(configured)" affordance so a valid slug is never silently dropped.
 */
export function buildModelOptions(models: ModelLike[], opts: BuildOptions): ComboOption[] {
  const { value, visionOnly, autoLabel } = opts
  const list = visionOnly ? models.filter((m) => m.vision) : models
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

  for (const m of list) {
    options.push({ value: m.name, label: m.name, vision: m.vision, kind: "model" })
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
    .map((o, i) => ({ o, i, score: rankLabel(o.label.toLowerCase(), q) }))
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
