import { describe, it, expect } from "vitest"
import { STATIC_PROVIDER_KEYS } from "../electron/config/staticKeys"

describe("STATIC_PROVIDER_KEYS", () => {
  it("carries NO hardcoded secret in source — value comes from the env var", () => {
    // The repository must never ship a live key. staticKeys.ts is an env passthrough
    // with an empty fallback; the real key is provided via OPENROUTER_API_KEY or Settings.
    const key = STATIC_PROVIDER_KEYS.openrouter
    expect(typeof key).toBe("string")
    expect(key).toBe(process.env.OPENROUTER_API_KEY ?? "")
  })
})
