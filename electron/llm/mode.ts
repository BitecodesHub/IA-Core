// Pure mapping between the user-facing "offline/online" mode and the underlying
// AI provider id. Kept free of any Electron import so it can be unit-tested in a
// plain Node/Vitest context and imported by both the main process and tests.
//
// Mode is derived from `ai.activeProviderId` (the single source of truth):
//   offline  <-> local Ollama
//   online   <-> OpenRouter (or any non-Ollama provider)
// This is the stealth-safe direction: it never reports "offline" while a
// non-local provider is active.

export type AiMode = "offline" | "online"

/** The local, offline provider. */
export const OFFLINE_PROVIDER_ID = "ollama"
/** The default online provider (OpenRouter). */
export const ONLINE_PROVIDER_ID = "openrouter"

/** Provider id to activate for a given mode. */
export function providerIdForMode(mode: AiMode): string {
  return mode === "online" ? ONLINE_PROVIDER_ID : OFFLINE_PROVIDER_ID
}

/** Mode implied by an active provider id. Anything other than Ollama is online. */
export function modeForProviderId(providerId: string | null | undefined): AiMode {
  return providerId === OFFLINE_PROVIDER_ID ? "offline" : "online"
}

/**
 * The provider id to switch to when toggling from the given active provider.
 * offline (ollama) -> online (openrouter); any online-ish provider -> offline.
 */
export function toggleProviderId(activeProviderId: string): string {
  return activeProviderId === OFFLINE_PROVIDER_ID ? ONLINE_PROVIDER_ID : OFFLINE_PROVIDER_ID
}

/**
 * Whether a provider may be contacted during an AUTOMATIC (non-user-initiated)
 * health sweep. A remote provider is only auto-contacted when it is the active
 * one — i.e. the app is actually online. This preserves the offline/local-only
 * guarantee so, e.g., opening the Diagnostics tab in offline mode never reaches
 * a remote host. Explicit per-provider checks bypass this gate.
 */
export function shouldAutoHealthCheck(
  provider: { id: string; allowRemote: boolean },
  activeProviderId: string
): boolean {
  if (!provider.allowRemote) return true
  return provider.id === activeProviderId
}
