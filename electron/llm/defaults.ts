// Curated per-provider default models, used to make "Auto" (an empty model slot)
// SAFE for remote providers: without this, an empty slot on a remote provider
// would either throw ("no model configured") or silently resolve to an arbitrary
// discovered model (a billable surprise). Ollama keeps its own permissive
// first-discovered / "llama3.2" fallback and does not use this map.
//
// NOTE: the openrouter slugs below intentionally mirror the seeded defaults in
// electron/config/schema.ts (DEFAULT_SETTINGS.ai.providers.openrouter) and the
// v3->v4 migration in electron/config/migrations.ts. Keep them in sync — they are
// a deliberate documented duplicate (kept separate to avoid a config->llm import
// cycle), not a second source of truth for the persisted shape.

import type { AiProviderSettings } from "../config/schema"

export interface RecommendedModels {
  low: string
  high: string
  vision: string
}

export const RECOMMENDED_MODELS: Record<string, RecommendedModels> = {
  openrouter: {
    low: "anthropic/claude-sonnet-5",
    high: "anthropic/claude-sonnet-5",
    vision: "anthropic/claude-sonnet-5",
  },
}

/**
 * The curated defaults for a provider, or `undefined` when none apply (Ollama,
 * generic local OpenAI-compatible endpoints). Keyed by provider id AND by an
 * `openrouter.ai` endpoint host, so a renamed slot pointing at OpenRouter still
 * resolves.
 */
export function recommendedModels(config: AiProviderSettings): RecommendedModels | undefined {
  if (RECOMMENDED_MODELS[config.id]) return RECOMMENDED_MODELS[config.id]
  try {
    if (new URL(config.endpoint).hostname.toLowerCase().endsWith("openrouter.ai")) {
      return RECOMMENDED_MODELS.openrouter
    }
  } catch {
    /* malformed endpoint — no recommendation */
  }
  return undefined
}
