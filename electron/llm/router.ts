// Pure model-routing logic: given a task and the configured tiers, decide which
// model to use. No Electron/Node deps so it is fully unit-testable. The "auto"
// heuristic uses only fast on-device signals (no extra model call).

import type { ReasoningMode } from "../config/schema"

export interface TaskContext {
  /** The user prompt / message being sent. */
  prompt: string
  /** True when an image accompanies the task (screenshot analysis). */
  hasImage?: boolean
  /** Number of prior messages in the conversation (longer ⇒ more context). */
  historyLength?: number
}

export type Tier = "low" | "high"

export interface ModelTiers {
  low: string
  high: string
  vision: string
}

// Signals that a prompt needs the stronger model.
const COMPLEX_PATTERNS = [
  /\balgorithm\b/i,
  /\bcomplexity\b/i,
  /\bprove\b/i,
  /\bderive\b/i,
  /\boptimi[sz]e\b/i,
  /\brefactor\b/i,
  /\bdebug\b/i,
  /\bstep[-\s]?by[-\s]?step\b/i,
  /\bdesign\b/i,
  /\barchitect/i,
  /\banaly[sz]e\b/i,
  /\bexplain why\b/i,
  /\bdynamic programming\b/i,
  /\brecursi/i,
  /\bregex|regular expression\b/i,
  /```/, // contains a code block
  /\bclass\b|\bfunction\b|\bdef\b|\bimport\b|=>/, // looks like code
]

const LONG_PROMPT_CHARS = 600
const DEEP_HISTORY = 6

/**
 * Heuristically classify a task as needing the low or high reasoning tier.
 * Fast and deterministic — pure string/length signals, no model call.
 */
export function classifyComplexity(ctx: TaskContext): Tier {
  const prompt = ctx.prompt ?? ""
  if (prompt.length >= LONG_PROMPT_CHARS) return "high"
  if ((ctx.historyLength ?? 0) >= DEEP_HISTORY) return "high"
  if (COMPLEX_PATTERNS.some((re) => re.test(prompt))) return "high"
  // Multi-question or clearly multi-step prompts.
  const questionMarks = (prompt.match(/\?/g) || []).length
  if (questionMarks >= 3) return "high"
  return "low"
}

/**
 * Resolve the model name for a task given the configured tiers and mode.
 * Image tasks always use the vision model. Falls back across tiers when a tier
 * is empty so a partially-configured setup still works.
 */
export function selectModel(mode: ReasoningMode, ctx: TaskContext, tiers: ModelTiers): string {
  if (ctx.hasImage) {
    return tiers.vision || tiers.high || tiers.low
  }
  let tier: Tier
  if (mode === "low") tier = "low"
  else if (mode === "high") tier = "high"
  else tier = classifyComplexity(ctx)

  const primary = tier === "high" ? tiers.high : tiers.low
  const secondary = tier === "high" ? tiers.low : tiers.high
  return primary || secondary || tiers.vision
}
