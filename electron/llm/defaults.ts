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
  // Re-verified 2026-10-06 on the live NVIDIA catalog (free tier): deepseek-v4.1-
  // flash, kimi-k3 and glm-5.3 never answered within 40s; mistral-large-2 and
  // nemotron-ultra-253b returned 404; nemotron-3-super reasoned past a 16k
  // budget on a hard problem. gpt-oss-20b answered and got the examples right,
  // so it is the default — NVIDIA works best as a FALLBACK provider for text.
  // Vision: llama-3.2-90b is the only NVIDIA model that transcribed a full
  // LeetCode screenshot correctly (11b dropped the key details). Stale ids are
  // safe: runtime fallback + self-healing replace them.
  nvidia: {
    low: "openai/gpt-oss-20b",
    high: "openai/gpt-oss-20b",
    vision: "meta/llama-3.2-90b-vision-instruct",
  },
  // Sharon AI has no model that can actually read images (all fail the vision
  // probe), so screenshots fall through to the next provider automatically.
  vertex: {
    low: "gemini-2.5-flash",
    high: "gemini-2.5-flash",
    vision: "gemini-2.5-flash",
  },
  sharonai: {
    low: "deepseek-ai/DeepSeek-V4-Flash-0731",
    high: "deepseek-ai/DeepSeek-V4-Flash-0731",
    vision: "",
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
