import { describe, it, expect } from "vitest"
import { cleanJsonResponse, heuristicVision, takeLines } from "../electron/llm/parse"

describe("cleanJsonResponse", () => {
  it("strips ```json fences", () => {
    expect(cleanJsonResponse('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it("extracts the JSON object from surrounding prose", () => {
    expect(cleanJsonResponse('Here you go:\n{"a":1}\nThanks!')).toBe('{"a":1}')
  })

  it("returns plain JSON unchanged", () => {
    expect(cleanJsonResponse('{"a":1}')).toBe('{"a":1}')
  })
})

describe("heuristicVision", () => {
  it("is true for known vision models", () => {
    for (const m of [
      "llava:13b",
      "llama3.2-vision",
      "qwen2.5-vl:7b",
      "qwen2.5vl:3b",
      "moondream",
    ]) {
      expect(heuristicVision(m)).toBe(true)
    }
  })

  it("is false for text-only models", () => {
    for (const m of ["llama3.1:8b", "mistral", "qwen2.5:7b"]) {
      expect(heuristicVision(m)).toBe(false)
    }
  })
})

describe("takeLines", () => {
  it("returns complete lines and keeps the partial remainder", () => {
    const { lines, rest } = takeLines('{"a":1}\n{"b":2}\n{"c":')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('{"c":')
  })

  it("reassembles a frame split across two reads", () => {
    // Simulate two network chunks splitting one JSON frame mid-way.
    let buffer = ""
    const seen: string[] = []
    for (const chunk of ['{"respo', 'nse":"hi"}\n']) {
      buffer += chunk
      const { lines, rest } = takeLines(buffer)
      buffer = rest
      seen.push(...lines)
    }
    expect(seen).toEqual(['{"response":"hi"}'])
    expect(JSON.parse(seen[0]).response).toBe("hi")
  })

  it("drops blank lines and returns empty rest when buffer ends on a newline", () => {
    const { lines, rest } = takeLines("a\n\nb\n")
    expect(lines).toEqual(["a", "b"])
    expect(rest).toBe("")
  })
})
