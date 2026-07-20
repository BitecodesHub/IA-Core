// Pure retry helpers for the LLM request path. Kept dependency-free so they can
// be unit-tested in isolation (no electron imports).

/**
 * Classify an error message as transient (worth retrying) vs terminal.
 *
 * Transient: network drops, stalls/timeouts, and 408/409/425/429/5xx — these
 * clear up on their own, so on a slow or flaky connection we retry rather than
 * surface an error. Terminal: auth/permission and malformed-request errors
 * (400/401/403/404, missing API key) — retrying only wastes time and hides the
 * real cause, so we fail fast and move on.
 */
export function isTransientError(message: string): boolean {
  const m = message.toLowerCase()

  // The providers format HTTP failures as "... error <code>: ...". When a status
  // code is present it is authoritative — decide by it, so a 5xx whose body text
  // merely contains "404" is still treated as the transient 5xx it is.
  const statusMatch = m.match(/error\s+(\d{3})\b/)
  if (statusMatch) {
    const code = Number(statusMatch[1])
    return code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
  }

  // No status code: auth / missing-key phrasing is terminal.
  if (
    m.includes("api key") ||
    m.includes("requires an api key") ||
    m.includes("unauthorized") ||
    m.includes("forbidden")
  ) {
    return false
  }

  // Network drops, stalls, timeouts, and provider "busy" signals are transient.
  return (
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("enotfound") ||
    m.includes("eai_again") ||
    m.includes("socket") ||
    m.includes("stalled") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("no data") ||
    m.includes("no response") ||
    m.includes("rate limit") ||
    m.includes("overloaded") ||
    m.includes("temporarily") ||
    m.includes("unavailable") ||
    m.includes("capacity")
  )
}

/**
 * Exponential backoff (base * 2^attempt) capped at `capMs`, plus up to `jitterMs`
 * of random jitter to avoid synchronized retries hammering a struggling endpoint.
 * `attempt` is 1-based (first retry = 1). `random` is injectable for tests.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  jitterMs = 250,
  random: () => number = Math.random
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
  return exp + Math.floor(random() * jitterMs)
}
