import { describe, it, expect } from "vitest"
import { runMigrations, migrations, type Migration } from "../electron/config/migrations"
import { coerceSettings } from "../electron/config/schema"

describe("runMigrations", () => {
  it("returns input unchanged when from === to", () => {
    const input = { a: 0 }
    expect(runMigrations(input, 1, 1, {})).toBe(input)
  })

  it("applies migrations in order, chaining each output into the next", () => {
    const registry: Record<number, Migration> = {
      1: (s) => ({ ...s, step1: true }),
      2: (s) => ({ ...s, step2: (s as any).step1 === true }),
    }
    const out = runMigrations({ a: 0 }, 1, 3, registry) as any
    expect(out.step1).toBe(true)
    // step2 only true if it saw step1's output → proves chaining.
    expect(out.step2).toBe(true)
  })

  it("skips a missing version without throwing", () => {
    const registry: Record<number, Migration> = {
      2: (s) => ({ ...s, ran2: true }),
    }
    const out = runMigrations({ a: 0 }, 1, 3, registry) as any
    expect(out.ran2).toBe(true)
    expect(out.a).toBe(0)
  })
})

describe("v1 -> v2 migration (model tiers)", () => {
  it("splits ollama.defaultModel into low/high and adds reasoningMode", () => {
    const out = migrations[1]({
      ollama: { defaultModel: "llama3.1:8b", visionModel: "llava" },
    }) as any
    expect(out.ollama.lowModel).toBe("llama3.1:8b")
    expect(out.ollama.highModel).toBe("llama3.1:8b")
    expect(out.ollama.reasoningMode).toBe("auto")
    expect(out.ollama.visionModel).toBe("llava")
    expect("defaultModel" in out.ollama).toBe(false)
  })

  it("is safe when ollama or defaultModel is absent", () => {
    const out = migrations[1]({}) as any
    expect(out.ollama.lowModel).toBe("")
    expect(out.ollama.highModel).toBe("")
    expect(out.ollama.reasoningMode).toBe("auto")
  })

  it("does not clobber tiers a user already set", () => {
    const out = migrations[1]({
      ollama: { defaultModel: "old", lowModel: "keep-low", highModel: "keep-high" },
    }) as any
    expect(out.ollama.lowModel).toBe("keep-low")
    expect(out.ollama.highModel).toBe("keep-high")
  })
})

describe("v2 -> v3 migration (AI providers)", () => {
  it("moves existing Ollama settings into the Ollama provider profile", () => {
    const out = migrations[2]({
      ollama: {
        endpoint: "http://localhost:11434",
        lowModel: "llama3.2",
        highModel: "qwen2.5:14b",
        visionModel: "llava",
        reasoningMode: "auto",
        temperature: 0.2,
        topP: 0.8,
        topK: 20,
        numCtx: 8192,
        numPredict: 512,
        timeoutMs: 90000,
        keepAlive: "15m",
      },
    }) as any

    expect(out.ai.activeProviderId).toBe("ollama")
    expect(out.ai.reasoningMode).toBe("auto")
    expect(out.ai.providers.ollama.lowModel).toBe("llama3.2")
    expect(out.ai.providers.ollama.highModel).toBe("qwen2.5:14b")
    expect(out.ai.providers.ollama.visionModel).toBe("llava")
    expect(out.ai.providers.ollama.temperature).toBe(0.2)
    expect(out.localShortcuts.bindings).toEqual({})
  })
})

describe("v3 -> v4 migration (OpenRouter online provider)", () => {
  it("seeds the openrouter provider with correct online defaults", () => {
    const out = migrations[3]({
      ai: { activeProviderId: "ollama", providers: { ollama: { id: "ollama", type: "ollama" } } },
    }) as any
    const or = out.ai.providers.openrouter
    expect(or.type).toBe("openai-compatible")
    expect(or.endpoint).toBe("https://openrouter.ai/api/v1")
    expect(or.allowRemote).toBe(true)
    expect(or.apiKeyRequired).toBe(true)
    expect(or.enabled).toBe(true)
    expect(or.lowModel).toBe("anthropic/claude-sonnet-5")
    expect(or.visionModel).toBe("anthropic/claude-sonnet-5")
  })

  it("keeps the offline default (does not touch activeProviderId)", () => {
    const out = migrations[3]({ ai: { activeProviderId: "ollama", providers: {} } }) as any
    expect(out.ai.activeProviderId).toBe("ollama")
  })

  it("does not clobber a user's existing openrouter edits and is idempotent", () => {
    const custom = { id: "openrouter", type: "openai-compatible", visionModel: "custom/model" }
    const out1 = migrations[3]({ ai: { providers: { openrouter: custom } } }) as any
    expect(out1.ai.providers.openrouter).toEqual(custom)
    const out2 = migrations[3](out1) as any
    expect(out2.ai.providers.openrouter).toEqual(out1.ai.providers.openrouter)
  })

  it("does not clobber a customised ollama provider", () => {
    const out = migrations[3]({
      ai: { providers: { ollama: { id: "ollama", type: "ollama", lowModel: "keep" } } },
    }) as any
    expect(out.ai.providers.ollama.lowModel).toBe("keep")
  })

  it("is safe when ai/providers are absent", () => {
    const out = migrations[3]({}) as any
    expect(out.ai.providers.openrouter.endpoint).toBe("https://openrouter.ai/api/v1")
  })
})

describe("full v1 -> v4 chain", () => {
  it("produces valid settings with the openrouter provider and offline default", () => {
    const v1blob = {
      version: 1,
      ollama: {
        defaultModel: "llama3.2",
        visionModel: "llava",
        endpoint: "http://localhost:11434",
      },
    }
    const migrated = runMigrations(v1blob, 1, 4)
    const s = coerceSettings({ ...migrated, version: 4 })
    expect(s.ai.activeProviderId).toBe("ollama")
    expect(s.ai.providers.openrouter.endpoint).toBe("https://openrouter.ai/api/v1")
    expect(s.ai.providers.openrouter.allowRemote).toBe(true)
    expect(s.ai.providers.ollama.lowModel).toBe("llama3.2")
    expect(s.ai.providers.ollama.visionModel).toBe("llava")
  })
})
