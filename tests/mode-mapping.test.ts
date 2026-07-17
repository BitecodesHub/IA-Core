import { describe, it, expect } from "vitest"
import {
  OFFLINE_PROVIDER_ID,
  ONLINE_PROVIDER_ID,
  providerIdForMode,
  modeForProviderId,
  toggleProviderId,
  shouldAutoHealthCheck,
} from "../electron/llm/mode"

describe("mode <-> provider mapping", () => {
  it("maps modes to provider ids", () => {
    expect(providerIdForMode("offline")).toBe(OFFLINE_PROVIDER_ID)
    expect(providerIdForMode("online")).toBe(ONLINE_PROVIDER_ID)
    expect(OFFLINE_PROVIDER_ID).toBe("ollama")
    expect(ONLINE_PROVIDER_ID).toBe("openrouter")
  })

  it("derives mode from provider id (offline only for ollama)", () => {
    expect(modeForProviderId("ollama")).toBe("offline")
    expect(modeForProviderId("openrouter")).toBe("online")
    // Any non-Ollama provider (or a missing id) is treated as online — the
    // stealth-safe direction: never claim offline while a remote provider is active.
    expect(modeForProviderId("openai-compatible")).toBe("online")
    expect(modeForProviderId(null)).toBe("online")
    expect(modeForProviderId(undefined)).toBe("online")
  })

  it("round-trips mode <-> provider id", () => {
    expect(modeForProviderId(providerIdForMode("offline"))).toBe("offline")
    expect(modeForProviderId(providerIdForMode("online"))).toBe("online")
  })

  it("toggles between offline and online", () => {
    expect(toggleProviderId("ollama")).toBe("openrouter")
    expect(toggleProviderId("openrouter")).toBe("ollama")
    // Toggling from any online-ish provider returns to offline.
    expect(toggleProviderId("openai-compatible")).toBe("ollama")
  })
})

describe("shouldAutoHealthCheck (offline stealth gate)", () => {
  const ollama = { id: "ollama", allowRemote: false }
  const openrouter = { id: "openrouter", allowRemote: true }

  it("always auto-checks local providers", () => {
    expect(shouldAutoHealthCheck(ollama, "ollama")).toBe(true)
    expect(shouldAutoHealthCheck(ollama, "openrouter")).toBe(true)
  })

  it("auto-checks a remote provider ONLY when it is the active one (online)", () => {
    expect(shouldAutoHealthCheck(openrouter, "openrouter")).toBe(true)
  })

  it("never auto-contacts a remote provider while offline (active = ollama)", () => {
    // This is the stealth guarantee: opening Diagnostics offline must not reach openrouter.ai.
    expect(shouldAutoHealthCheck(openrouter, "ollama")).toBe(false)
  })
})
