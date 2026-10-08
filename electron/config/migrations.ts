// Settings migrations.
//
// Each entry transforms settings written by version N into the shape expected by
// version N+1. They run in order during load when the persisted `version` is
// behind `SETTINGS_VERSION`. Coercion (`coerceSettings`) runs afterwards, so a
// migration only needs to move/rename data — it does not need to fill defaults.

export type Migration = (settings: Record<string, unknown>) => Record<string, unknown>

/** Keyed by the from-version. `migrations[1]` upgrades v1 -> v2, etc. */
export const migrations: Record<number, Migration> = {
  // v1 -> v2: split the single `ollama.defaultModel` into low/high reasoning
  // tiers and introduce reasoningMode. The old model seeds both tiers so
  // behaviour is unchanged until the user picks distinct models.
  1: (s) => {
    const ollama = (
      s.ollama && typeof s.ollama === "object" ? { ...(s.ollama as object) } : {}
    ) as Record<string, unknown>
    const prev = typeof ollama.defaultModel === "string" ? ollama.defaultModel : ""
    if (ollama.lowModel == null) ollama.lowModel = prev
    if (ollama.highModel == null) ollama.highModel = prev
    if (ollama.reasoningMode == null) ollama.reasoningMode = "auto"
    delete ollama.defaultModel
    return { ...s, ollama }
  },

  // v2 -> v3: introduce provider profiles while preserving the local-first
  // Ollama settings users already configured.
  2: (s) => {
    const ollama = (
      s.ollama && typeof s.ollama === "object" ? { ...(s.ollama as object) } : {}
    ) as Record<string, unknown>
    const ai = (s.ai && typeof s.ai === "object" ? { ...(s.ai as object) } : {}) as Record<
      string,
      unknown
    >
    const providers =
      ai.providers && typeof ai.providers === "object"
        ? ({ ...(ai.providers as object) } as Record<string, unknown>)
        : {}
    providers.ollama = {
      id: "ollama",
      name: "Ollama",
      type: "ollama",
      enabled: true,
      endpoint: ollama.endpoint,
      allowRemote: false,
      apiKeyRequired: false,
      lowModel: ollama.lowModel,
      highModel: ollama.highModel,
      visionModel: ollama.visionModel,
      temperature: ollama.temperature,
      topP: ollama.topP,
      topK: ollama.topK,
      numCtx: ollama.numCtx,
      numPredict: ollama.numPredict,
      timeoutMs: ollama.timeoutMs,
      keepAlive: ollama.keepAlive,
    }
    return {
      ...s,
      ai: {
        ...ai,
        activeProviderId: ai.activeProviderId ?? "ollama",
        fallbackProviderIds: ai.fallbackProviderIds ?? [],
        reasoningMode: ai.reasoningMode ?? ollama.reasoningMode ?? "auto",
        requestRetries: ai.requestRetries ?? 1,
        healthCheckOnStart: ai.healthCheckOnStart ?? true,
        providers,
      },
      localShortcuts: s.localShortcuts ?? { bindings: {} },
    }
  },

  // v3 -> v4: add the "openrouter" online-mode provider profile. Existing users
  // keep their offline default (activeProviderId is untouched). Idempotent: only
  // seeds the profile when it is absent, so re-running never clobbers user edits.
  3: (s) => {
    const ai = (s.ai && typeof s.ai === "object" ? { ...(s.ai as object) } : {}) as Record<
      string,
      unknown
    >
    const providers =
      ai.providers && typeof ai.providers === "object"
        ? ({ ...(ai.providers as object) } as Record<string, unknown>)
        : {}
    if (!providers.openrouter) {
      providers.openrouter = {
        id: "openrouter",
        name: "OpenRouter",
        type: "openai-compatible",
        enabled: true,
        endpoint: "https://openrouter.ai/api/v1",
        allowRemote: true,
        apiKeyRequired: true,
        lowModel: "anthropic/claude-sonnet-5",
        highModel: "anthropic/claude-sonnet-5",
        visionModel: "anthropic/claude-sonnet-5",
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 1024,
        timeoutMs: 120000,
        keepAlive: "30m",
      }
    }
    return { ...s, ai: { ...ai, providers } }
  },

  // v4 -> v5: drop the generic "openai-compatible" local slot. Cloud providers
  // cover the OpenAI-compatible protocol, and a user-added custom endpoint is
  // still reconstructed from CUSTOM_PROVIDER_TEMPLATE during coercion — so this
  // only removes the unused default entry. If it was the active provider or in
  // the fallback chain, drop those references so nothing points at a provider
  // that no longer exists (coercion would otherwise fall back to the default
  // active id anyway, but clearing it here keeps the persisted file honest).
  4: (s) => {
    const ai = (s.ai && typeof s.ai === "object" ? { ...(s.ai as object) } : {}) as Record<
      string,
      unknown
    >
    const providers =
      ai.providers && typeof ai.providers === "object"
        ? ({ ...(ai.providers as object) } as Record<string, unknown>)
        : {}
    delete providers["openai-compatible"]
    if (ai.activeProviderId === "openai-compatible") ai.activeProviderId = "ollama"
    const fallbacks = Array.isArray(ai.fallbackProviderIds) ? ai.fallbackProviderIds : []
    ai.fallbackProviderIds = fallbacks.filter((id) => id !== "openai-compatible")
    return { ...s, ai: { ...ai, providers } }
  },

  // v5 -> v6: raise the output-token budget from 1024 to 4096. Reasoning models
  // (nemotron-3-super, gpt-oss, DeepSeek R1, Gemini 2.5) spend tokens thinking
  // before answering; at 1024 they routinely exhausted the budget and returned
  // NO answer for a coding screenshot. Only values still at the old default are
  // changed — a number the user chose is kept.
  5: (s) => {
    const raise = (p: unknown) =>
      p && typeof p === "object" && (p as Record<string, unknown>).numPredict === 1024
        ? { ...(p as object), numPredict: 4096 }
        : p
    const ai = (s.ai && typeof s.ai === "object" ? { ...(s.ai as object) } : {}) as Record<string, unknown>
    if (ai.providers && typeof ai.providers === "object") {
      ai.providers = Object.fromEntries(
        Object.entries(ai.providers as Record<string, unknown>).map(([id, p]) => [id, raise(p)])
      )
    }
    const ollama = raise(s.ollama)
    return { ...s, ai, ...(s.ollama !== undefined ? { ollama } : {}) }
  },

  // v6 -> v7: make the Bitecodes model the default. The provider entry itself
  // arrives from DEFAULT_SETTINGS during coercion; this only moves the active
  // provider. Whatever the user was using becomes the FIRST fallback, so their
  // app keeps answering exactly as before until they sign in to Bitecodes (a
  // signed-out Bitecodes provider fails as "auth" and the chain moves on).
  6: (s) => {
    const ai = (s.ai && typeof s.ai === "object" ? { ...(s.ai as object) } : {}) as Record<string, unknown>
    const previous = typeof ai.activeProviderId === "string" ? ai.activeProviderId : null
    const fallbacks = Array.isArray(ai.fallbackProviderIds)
      ? (ai.fallbackProviderIds as unknown[]).filter((x): x is string => typeof x === "string")
      : []
    if (previous !== "bitecodes") {
      ai.activeProviderId = "bitecodes"
      ai.fallbackProviderIds = [
        ...(previous ? [previous] : []),
        ...fallbacks.filter((id) => id !== previous && id !== "bitecodes"),
      ]
    }
    return { ...s, ai }
  },
}

export function runMigrations(
  raw: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  registry: Record<number, Migration> = migrations
): Record<string, unknown> {
  let current = raw
  for (let v = fromVersion; v < toVersion; v++) {
    const migrate = registry[v]
    if (migrate) {
      current = migrate(current)
    }
  }
  return current
}
