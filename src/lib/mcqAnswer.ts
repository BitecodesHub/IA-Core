// Detects the selected option(s) of a multiple-choice answer from a completed
// assistant message, so the overlay can blink the answer as a COUNT of dots in a
// top-left row (A=1, B=2, C=3, D=4, E=5 dots; multiple options play in sequence).
//
// Detection is deliberately two-tiered, most-reliable first:
//   1. A machine-readable marker the model is asked to append, e.g.
//      `<!--MCQ:B-->` or `<!--MCQ:A,C-->` (or `<!--MCQ:NONE-->` for non-MCQ).
//      This is unambiguous and is the primary signal.
//   2. A conservative text heuristic used ONLY when no marker is present. It
//      fires exclusively on an explicit "Answer: X" style declaration, because a
//      wrong dot is worse than no dot — so anything less than explicit yields no
//      hint rather than a guess.
//
// The marker is stripped before the message is displayed (see stripMcqMarker),
// so it never appears in the UI.

/** Option letters the overlay can encode (A=1 … E=5 dots). Anything else is ignored. */
const POSITIONAL_LETTERS = ["A", "B", "C", "D", "E"] as const
export type McqLetter = (typeof POSITIONAL_LETTERS)[number]

// A single marker: <!--MCQ:B-->, <!--MCQ:A, C-->, <!--MCQ:NONE-->. Whitespace
// tolerant. Case-insensitive on the MCQ tag and the NONE sentinel.
const MARKER_RE = /<!--\s*MCQ\s*:\s*([^>]*?)\s*-->/i
// Global variant used only for stripping (a stray duplicate marker is removed too).
const MARKER_STRIP_RE = /<!--\s*MCQ\s*:[^>]*?-->/gi

// Heuristic fallback: an explicit final-answer declaration such as
// "Answer: B", "Correct answer: A and C", "Answers - B, D". We capture the text
// AFTER the colon/dash up to the end of that line and pull option letters from it.
const ANSWER_LINE_RE = /(?:correct\s+)?answers?\s*[:\-–]\s*([^\n\r]+)/i

/**
 * Extract standalone option letters (A–E) from a short fragment. Requires each
 * letter to stand alone — bounded by a non-letter on both sides — so words like
 * "Add" or "Cat" in an answer's prose do not register as options "A"/"C".
 */
function lettersFromFragment(fragment: string): McqLetter[] {
  const found = new Set<McqLetter>()
  // Match a letter that is not part of a longer word: (^|non-letter) L (non-letter|$)
  const re = /(^|[^A-Za-z])([A-Ea-e])(?![A-Za-z])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment)) !== null) {
    const letter = m[2].toUpperCase() as McqLetter
    if ((POSITIONAL_LETTERS as readonly string[]).includes(letter)) found.add(letter)
  }
  // Preserve canonical A→E order for deterministic dot placement.
  return POSITIONAL_LETTERS.filter((l) => found.has(l))
}

export interface McqAnswer {
  letters: McqLetter[]
  /** How the answer was detected — useful for tests and future telemetry gating. */
  source: "marker" | "heuristic"
}

/**
 * Parse the MCQ selection from a completed assistant message. Returns null when
 * the message is not a multiple-choice answer, when the marker explicitly says
 * NONE, or when no positional (A–E) option can be confidently determined.
 */
export function parseMcqAnswer(text: string): McqAnswer | null {
  if (!text || typeof text !== "string") return null

  const marker = text.match(MARKER_RE)
  if (marker) {
    const payload = marker[1].trim()
    if (/^none$/i.test(payload)) return null
    const letters = lettersFromFragment(payload)
    return letters.length > 0 ? { letters, source: "marker" } : null
  }

  // No marker — fall back to an explicit answer declaration only.
  const answerLine = text.match(ANSWER_LINE_RE)
  if (answerLine) {
    const letters = lettersFromFragment(answerLine[1])
    if (letters.length > 0) return { letters, source: "heuristic" }
  }
  return null
}

/**
 * Remove the MCQ marker (and any whitespace it leaves behind) so it is never
 * shown to the user. Safe to call on any text; returns the input unchanged when
 * no marker is present.
 */
export function stripMcqMarker(text: string): string {
  if (!text || typeof text !== "string") return text
  if (!MARKER_STRIP_RE.test(text)) return text
  return text
    .replace(MARKER_STRIP_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}$/g, "\n\n")
    .trimEnd()
}
