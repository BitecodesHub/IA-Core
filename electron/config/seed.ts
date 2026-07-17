// Pure decision helper for one-time provider-key seeding from the environment.
// Electron-free so it can be unit-tested; the side-effecting seed (reading env,
// writing SecretStore) lives in main.ts and calls this to decide whether to act.

/**
 * Seed a provider key from an env var only when:
 *  - secure storage is available (never persist an unencrypted key), AND
 *  - no key is already stored for the provider (never overwrite a user's key), AND
 *  - the env var holds a non-empty value.
 */
export function shouldSeedProviderKey(
  hasStoredKey: boolean,
  envValue: string | undefined,
  encryptionAvailable: boolean
): boolean {
  return encryptionAvailable && !hasStoredKey && typeof envValue === "string" && envValue.trim() !== ""
}
