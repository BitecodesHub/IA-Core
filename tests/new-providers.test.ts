import { describe, it, expect, vi, afterEach } from "vitest"
import { OpenAICompatibleProvider } from "../electron/llm/providers"
import { DEFAULT_SETTINGS, PINNED_PROVIDER_ENDPOINTS, coerceSettings } from "../electron/config/schema"
import type { AiProviderSettings } from "../electron/config/schema"

const NEW_PROVIDERS = ["openai", "gemini", "groq", "nvidia"] as const

function opts() {
  return { temperature: 0.7, topP: 0.9, topK: 40, numCtx: 4096, numPredict: 1024, keepAlive: "30m" }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), body: null } as unknown as Response
}

function config(id: string): AiProviderSettings {
  return DEFAULT_SETTINGS.ai.providers[id]
}

afterEach(() => vi.restoreAllMocks())

describe("bundled provider definitions", () => {
  it.each(NEW_PROVIDERS)("%s ships as a disabled, key-requiring HTTPS provider", (id) => {
    const p = config(id)
    expect(p).toBeDefined()
    expect(p.type).toBe("openai-compatible")
    // Enabled-by-default with no key would fail the startup health check and
    // show a spurious error to every user.
    expect(p.enabled).toBe(false)
    expect(p.apiKeyRequired).toBe(true)
    // allowRemote is what lets the HTTPS endpoint survive the SSRF guard.
    expect(p.allowRemote).toBe(true)
    expect(p.endpoint.startsWith("https://")).toBe(true)
  })

  it.each(NEW_PROVIDERS)("%s leaves model slots on Auto so discovery fills them", (id) => {
    const p = config(id)
    expect(p.lowModel).toBe("")
    expect(p.highModel).toBe("")
    expect(p.visionModel).toBe("")
  })

  it.each(NEW_PROVIDERS)("%s has a pinned endpoint that survives tampering", (id) => {
    expect(PINNED_PROVIDER_ENDPOINTS[id]).toBe(config(id).endpoint)
    const tampered = coerceSettings({
      version: 4,
      ai: { providers: { [id]: { endpoint: "https://attacker.example/v1" } } },
    })
    expect(tampered.ai.providers[id].endpoint).toBe(PINNED_PROVIDER_ENDPOINTS[id])
  })

  it("appears in an existing settings file without needing a migration", () => {
    const legacy = {
      version: 4,
      ai: { activeProviderId: "ollama", providers: { ollama: { endpoint: "http://localhost:11434" } } },
    }
    const out = coerceSettings(legacy)
    for (const id of NEW_PROVIDERS) expect(out.ai.providers[id]).toBeDefined()
    // ...without disturbing what the user already chose.
    expect(out.ai.activeProviderId).toBe("ollama")
  })

  it("does not enable or activate any key-based provider by default", () => {
    // The default is the Bitecodes model (browser sign-in), never a raw key provider.
    expect(DEFAULT_SETTINGS.ai.activeProviderId).toBe("bitecodes")
    for (const id of NEW_PROVIDERS) expect(config(id).enabled).toBe(false)
  })
})

describe("requests built for the new providers", () => {
  it.each(NEW_PROVIDERS)("%s sends a bearer token to its own /chat/completions", async (id) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    const provider = new OpenAICompatibleProvider(config(id), () => "TEST-KEY")
    await provider.generate({ model: "m", prompt: "hi", options: opts(), stream: false })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PINNED_PROVIDER_ENDPOINTS[id]}/chat/completions`)
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-KEY")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })

  it.each(NEW_PROVIDERS)("%s refuses to send anything without a key", async (id) => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    const provider = new OpenAICompatibleProvider(config(id), () => null)
    await expect(
      provider.generate({ model: "m", prompt: "hi", options: opts(), stream: false })
    ).rejects.toThrow(/requires an API key/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(NEW_PROVIDERS)("%s sends screenshots as an OpenAI image_url part", async (id) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    const provider = new OpenAICompatibleProvider(config(id), () => "K")
    // Minimal JPEG magic bytes so the mime sniffer resolves image/jpeg.
    const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64")
    await provider.generate({
      model: "m",
      prompt: "read this",
      images: [jpegBase64],
      options: opts(),
      stream: false,
    })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    const parts = body.messages[0].content
    expect(Array.isArray(parts)).toBe(true)
    expect(parts[0]).toEqual({ type: "text", text: "read this" })
    expect(parts[1].type).toBe("image_url")
    expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it.each(NEW_PROVIDERS)("%s discovers models from its own /models", async (id) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] }))
    const provider = new OpenAICompatibleProvider(config(id), () => "K")
    const models = await provider.listModels()
    expect(fetchMock.mock.calls[0][0]).toBe(`${PINNED_PROVIDER_ENDPOINTS[id]}/models`)
    expect(models.map((m) => m.name)).toEqual(["model-a", "model-b"])
  })

  it("omits the OpenRouter-only models[] failover for direct providers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
    const provider = new OpenAICompatibleProvider(config("groq"), () => "K")
    await provider.generate({ model: "m", prompt: "hi", options: opts(), stream: false })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    // fallbackModels is empty by default, so no non-standard field is sent to a
    // provider that would reject or ignore it.
    expect(body.models).toBeUndefined()
  })
})

import { runMigrations } from "../electron/config/migrations"
import { shouldSeedProviderKey } from "../electron/config/seed"

describe("generic openai-compatible slot removal", () => {
  it("is no longer a default provider", () => {
    expect(DEFAULT_SETTINGS.ai.providers["openai-compatible"]).toBeUndefined()
  })

  it("keeps openai-compatible as the TYPE of every cloud provider", () => {
    for (const id of ["openrouter", "openai", "gemini", "groq", "nvidia"]) {
      expect(DEFAULT_SETTINGS.ai.providers[id].type).toBe("openai-compatible")
    }
  })

  it("migrates a v4 file that used the generic slot (v4 -> v5)", () => {
    const legacy = {
      version: 4,
      ai: {
        activeProviderId: "openai-compatible",
        fallbackProviderIds: ["openai-compatible", "nvidia"],
        providers: {
          ollama: { endpoint: "http://localhost:11434" },
          "openai-compatible": { id: "openai-compatible", type: "openai-compatible" },
          nvidia: { id: "nvidia", type: "openai-compatible" },
        },
      },
    }
    const migrated = runMigrations(JSON.parse(JSON.stringify(legacy)), 4, 5) as any
    expect(migrated.ai.providers["openai-compatible"]).toBeUndefined()
    // A dangling active/fallback reference must not survive.
    expect(migrated.ai.activeProviderId).toBe("ollama")
    expect(migrated.ai.fallbackProviderIds).toEqual(["nvidia"])
  })

  it("still lets a user add a custom OpenAI-compatible endpoint", () => {
    const out = coerceSettings({
      version: 5,
      ai: {
        providers: {
          mycustom: {
            id: "mycustom",
            type: "openai-compatible",
            endpoint: "https://api.example.com/v1",
            allowRemote: true,
          },
        },
      },
    })
    expect(out.ai.providers.mycustom.endpoint).toBe("https://api.example.com/v1")
  })
})

describe("NVIDIA free-tier env seeding", () => {
  // The startup seed in main.ts maps nvidia -> NVIDIA_API_KEY; this is the pure
  // decision it relies on.
  it("seeds when a key is present, storage works, and none is stored yet", () => {
    expect(shouldSeedProviderKey(false, "nvapi-abc", true)).toBe(true)
  })

  it("never overwrites an already-stored key", () => {
    expect(shouldSeedProviderKey(true, "nvapi-abc", true)).toBe(false)
  })

  it("does nothing without a key or without secure storage", () => {
    expect(shouldSeedProviderKey(false, undefined, true)).toBe(false)
    expect(shouldSeedProviderKey(false, "   ", true)).toBe(false)
    expect(shouldSeedProviderKey(false, "nvapi-abc", false)).toBe(false)
  })
})
