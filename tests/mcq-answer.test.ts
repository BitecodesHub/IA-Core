import { describe, it, expect } from "vitest"
import { parseMcqAnswer, stripMcqMarker } from "../src/lib/mcqAnswer"

describe("parseMcqAnswer — marker (primary signal)", () => {
  it("parses a single-letter marker", () => {
    expect(parseMcqAnswer("B. 42\n<!--MCQ:B-->")).toEqual({ letters: ["B"], source: "marker" })
  })

  it("parses a multi-letter marker and canonicalizes order", () => {
    expect(parseMcqAnswer("A and C are correct\n<!--MCQ:C, A-->")).toEqual({
      letters: ["A", "C"],
      source: "marker",
    })
  })

  it("supports the center option E", () => {
    expect(parseMcqAnswer("<!--MCQ:E-->")).toEqual({ letters: ["E"], source: "marker" })
  })

  it("is whitespace- and case-tolerant", () => {
    expect(parseMcqAnswer("<!--  mcq : b , d -->")).toEqual({
      letters: ["B", "D"],
      source: "marker",
    })
  })

  it("returns null for the NONE sentinel (non-MCQ questions)", () => {
    expect(parseMcqAnswer("The capital of France is Paris.\n<!--MCQ:NONE-->")).toBeNull()
  })

  it("ignores letters outside the A–E positional range", () => {
    expect(parseMcqAnswer("<!--MCQ:F-->")).toBeNull()
    expect(parseMcqAnswer("<!--MCQ:B,Z-->")).toEqual({ letters: ["B"], source: "marker" })
  })

  it("prefers the marker over any heuristic text", () => {
    // Text says 'A' but the marker (authoritative) says 'D'.
    expect(parseMcqAnswer("Answer: A\n<!--MCQ:D-->")).toEqual({
      letters: ["D"],
      source: "marker",
    })
  })
})

describe("parseMcqAnswer — heuristic fallback (marker absent)", () => {
  it("reads an explicit 'Answer:' declaration", () => {
    expect(parseMcqAnswer("Answer: C")).toEqual({ letters: ["C"], source: "heuristic" })
  })

  it("reads multiple answers written out", () => {
    expect(parseMcqAnswer("Correct answer: B and D")).toEqual({
      letters: ["B", "D"],
      source: "heuristic",
    })
  })

  it("does not treat option letters embedded in words as selections", () => {
    // "Add" / "Element" must not register as A / E.
    expect(parseMcqAnswer("Add the Element to the list.")).toBeNull()
  })

  it("returns null for prose with no explicit answer declaration", () => {
    expect(parseMcqAnswer("This is a coding question, not multiple choice.")).toBeNull()
    expect(parseMcqAnswer("")).toBeNull()
    expect(parseMcqAnswer(null as unknown as string)).toBeNull()
  })
})

describe("stripMcqMarker", () => {
  it("removes the marker and trailing whitespace", () => {
    expect(stripMcqMarker("C. 42\n\n<!--MCQ:C-->")).toBe("C. 42")
  })

  it("removes a marker mid-text and any duplicate", () => {
    expect(stripMcqMarker("A<!--MCQ:A--> then more<!--MCQ:A-->")).toBe("A then more")
  })

  it("leaves marker-free text unchanged", () => {
    expect(stripMcqMarker("The answer is 42.")).toBe("The answer is 42.")
    expect(stripMcqMarker("")).toBe("")
  })
})
