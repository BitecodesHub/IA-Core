import { describe, it, expect } from "vitest"
import { isTransientError, backoffDelayMs } from "../electron/llm/retry"

describe("isTransientError", () => {
  it("treats network / connection failures as transient", () => {
    for (const m of [
      "fetch failed",
      "network error",
      "ECONNRESET",
      "ETIMEDOUT",
      "getaddrinfo ENOTFOUND openrouter.ai",
      "socket hang up",
      "No data from OpenRouter for 120s (connection stalled).",
      "Request timed out",
    ]) {
      expect(isTransientError(m), m).toBe(true)
    }
  })

  it("treats 429 and 5xx as transient", () => {
    expect(isTransientError("Provider API error 429: rate limited")).toBe(true)
    expect(isTransientError("Provider API error 500: internal")).toBe(true)
    expect(isTransientError("Provider API error 503: unavailable")).toBe(true)
    expect(isTransientError("Provider API error 502: bad gateway")).toBe(true)
  })

  it("treats auth / bad-request errors as terminal (no retry)", () => {
    expect(isTransientError("Provider API error 401: invalid key")).toBe(false)
    expect(isTransientError("Provider API error 403: forbidden")).toBe(false)
    expect(isTransientError("Provider API error 400: bad request")).toBe(false)
    expect(isTransientError("OpenRouter requires an API key.")).toBe(false)
    expect(isTransientError("API key is required but not configured.")).toBe(false)
  })

  it("decides by the authoritative leading status code, not body text", () => {
    // A 5xx whose body text merely contains '404' is still the transient 5xx.
    expect(isTransientError("Provider API error 500: upstream 404-ish text")).toBe(true)
    expect(isTransientError("Provider API error 503: took 4000ms")).toBe(true)
    expect(isTransientError("Provider API error 404: model not found")).toBe(false)
  })

  it("treats provider busy/overload phrasing (200 error frames) as transient", () => {
    expect(isTransientError("Provider stream error: rate limit exceeded")).toBe(true)
    expect(isTransientError("Provider stream error: model is overloaded")).toBe(true)
    expect(isTransientError("Provider stream error: temporarily unavailable")).toBe(true)
  })
})

describe("backoffDelayMs", () => {
  const noJitter = () => 0

  it("grows exponentially from the base", () => {
    expect(backoffDelayMs(1, 500, 8000, 250, noJitter)).toBe(500)
    expect(backoffDelayMs(2, 500, 8000, 250, noJitter)).toBe(1000)
    expect(backoffDelayMs(3, 500, 8000, 250, noJitter)).toBe(2000)
    expect(backoffDelayMs(4, 500, 8000, 250, noJitter)).toBe(4000)
  })

  it("is capped", () => {
    expect(backoffDelayMs(10, 500, 8000, 250, noJitter)).toBe(8000)
  })

  it("adds bounded jitter", () => {
    expect(backoffDelayMs(1, 500, 8000, 250, () => 0.999)).toBe(500 + 249)
  })
})
