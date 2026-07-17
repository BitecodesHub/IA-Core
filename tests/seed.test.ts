import { describe, it, expect } from "vitest"
import { shouldSeedProviderKey } from "../electron/config/seed"

describe("shouldSeedProviderKey", () => {
  it("seeds only when encryption is available, no key is stored, and env is non-empty", () => {
    expect(shouldSeedProviderKey(false, "sk-or-v1-abc", true)).toBe(true)
  })

  it("does not overwrite an already-stored key", () => {
    expect(shouldSeedProviderKey(true, "sk-or-v1-abc", true)).toBe(false)
  })

  it("does not seed without a usable env value", () => {
    expect(shouldSeedProviderKey(false, undefined, true)).toBe(false)
    expect(shouldSeedProviderKey(false, "", true)).toBe(false)
    expect(shouldSeedProviderKey(false, "   ", true)).toBe(false)
  })

  it("does not seed when secure storage is unavailable (never persist plaintext)", () => {
    expect(shouldSeedProviderKey(false, "sk-or-v1-abc", false)).toBe(false)
  })
})
