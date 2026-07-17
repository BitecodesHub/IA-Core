// Static provider API keys.
//
// SECURITY: this file is committed to source control, so it must NEVER contain a
// live API key. Provide the OpenRouter key at runtime instead — either:
//   • set the OPENROUTER_API_KEY environment variable (seeded into the encrypted
//     SecretStore on launch, see main.ts), or
//   • enter it in Settings → Models (stored encrypted via safeStorage).
//
// The value below is an env-var passthrough with an empty fallback, so a clone of
// this repository carries no secret. An empty string is treated the same as "no
// key" everywhere downstream (SecretStore / OpenAICompatibleProvider).
export const STATIC_PROVIDER_KEYS: Record<string, string> = {
  openrouter: process.env.OPENROUTER_API_KEY ?? "",
}
