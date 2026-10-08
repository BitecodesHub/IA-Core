// Turn a raw provider failure into one short, readable line for the chat.
//
// The main process reports failures like:
//   All configured providers failed. NVIDIA NIM/meta/llama-3.1-8b-instruct:
//   Provider API error 410: {"title":"Gone","status":410,"detail":"The model ...
//   has reached its end of life ..."} | NVIDIA NIM/other-model: ...
// The chat used to replace all of that with "Couldn't complete that. Try again.",
// which made every failure — dead model, bad key, rate limit — look identical
// and undiagnosable. Pure and dependency-free so it is unit-testable.

const MAX_LEN = 240

/** Pull the human sentence out of a JSON error body, if there is one. */
function detailFromBody(body: string): string | null {
  const start = body.indexOf("{")
  if (start < 0) return null
  try {
    const parsed = JSON.parse(body.slice(start))
    const candidates = [
      parsed?.detail,
      parsed?.error?.message,
      parsed?.message,
      parsed?.Message, // AWS services capitalise it
      typeof parsed?.error === "string" ? parsed.error : undefined,
      parsed?.title,
    ]
    const found = candidates.find((c) => typeof c === "string" && c.trim())
    return found ? String(found).trim() : null
  } catch {
    return null
  }
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > MAX_LEN ? `${oneLine.slice(0, MAX_LEN - 1)}…` : oneLine
}

/**
 * Format a provider error for display. Reports the FIRST failure (the model the
 * user actually configured), plus how many fallbacks were also tried.
 */
export function formatProviderError(raw: unknown): string {
  const text = String(raw ?? "").trim()
  if (!text) return "Couldn't complete that. Try again."

  const body = text.replace(/^All configured providers failed\.\s*/i, "")
  const failures = body.split(/\s\|\s/).filter((f) => f.trim())
  const first = failures[0] ?? body

  // "<Provider>/<model>: Provider API error <code>: <body>"
  const m = first.match(/^(.+?)\/(\S+?):\s*(?:Provider API error\s+(\d{3}):\s*)?([\s\S]*)$/)
  if (!m) return clip(first)

  const [, provider, model, status, rest] = m
  const reason = detailFromBody(rest) ?? rest.trim()
  const more = failures.length > 1 ? ` (+${failures.length - 1} fallback${failures.length > 2 ? "s" : ""} also failed)` : ""
  const code = status ? ` [${status}]` : ""
  return clip(`${provider} · ${model}${code}: ${reason || "request failed"}${more}`)
}
