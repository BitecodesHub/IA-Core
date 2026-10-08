import { describe, it, expect } from "vitest"
import {
  cleanJsonResponse,
  heuristicVision,
  takeLines,
  visionFromModality,
} from "../electron/llm/parse"

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

  it("detects NVIDIA NIM-style multimodal ids (the stuck-on-Auto bug)", () => {
    for (const m of [
      "meta/llama-3.2-90b-vision-instruct",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/llama-4-maverick-17b-128e-instruct",
      "meta/llama-4-scout-17b-16e-instruct",
      "microsoft/phi-3.5-vision-instruct",
      "mistralai/pixtral-12b",
      "qwen/qwen2-vl-72b-instruct",
      "opengvlab/internvl2-26b",
      "nvidia/vila",
    ]) {
      expect(heuristicVision(m), m).toBe(true)
    }
  })

  it("does not flag NVIDIA coding/text or image-generation models as vision", () => {
    for (const m of [
      "qwen/qwen2.5-coder-32b-instruct",
      "deepseek-ai/deepseek-r1",
      "meta/llama-3.3-70b-instruct",
      "mistralai/mixtral-8x22b-instruct-v0.1",
      // image GENERATION — takes text, emits an image; not a vision-input model.
      "black-forest-labs/flux.1-dev",
      "stabilityai/sdxl",
    ]) {
      expect(heuristicVision(m), m).toBe(false)
    }
  })
})

describe("visionFromModality", () => {
  it("returns true when input_modalities includes image (case-insensitive)", () => {
    expect(visionFromModality({ architecture: { input_modalities: ["text", "image"] } })).toBe(true)
    expect(visionFromModality({ architecture: { input_modalities: ["Image"] } })).toBe(true)
  })

  it("returns false when modalities are present but exclude image (metadata is authoritative)", () => {
    expect(visionFromModality({ architecture: { input_modalities: ["text"] } })).toBe(false)
  })

  it("supports the legacy modality string", () => {
    expect(visionFromModality({ architecture: { modality: "text+image->text" } })).toBe(true)
    expect(visionFromModality({ architecture: { modality: "text->text" } })).toBe(false)
  })

  it("returns undefined when there is no modality metadata (caller falls back to name heuristic)", () => {
    expect(visionFromModality({ id: "x" })).toBeUndefined()
    expect(visionFromModality({ architecture: {} })).toBeUndefined()
    expect(visionFromModality(null)).toBeUndefined()
    expect(visionFromModality("nope")).toBeUndefined()
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
