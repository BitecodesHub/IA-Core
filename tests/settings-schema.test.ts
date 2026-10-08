import { describe, it, expect } from "vitest"
import {
  coerceSettings,
  coerceEndpoint,
  coerceProviderEndpoint,
  DEFAULT_SETTINGS,
  isKnownAction,
  isKnownLocalAction,
} from "../electron/config/schema"

describe("coerceSettings", () => {
  it("returns full defaults for empty/garbage input", () => {
    expect(coerceSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings("nonsense")).toEqual(DEFAULT_SETTINGS)
  })

  it("clamps out-of-range numbers into valid bounds", () => {
    const s = coerceSettings({ ollama: { temperature: 99, topP: -1, numCtx: 1 } })
    expect(s.ollama.temperature).toBe(2)
    expect(s.ollama.topP).toBe(0)
    expect(s.ollama.numCtx).toBe(256)
  })

  it("clamps opacity to a visible minimum", () => {
    expect(coerceSettings({ window: { opacity: 0 } }).window.opacity).toBe(0.1)
    expect(coerceSettings({ window: { opacity: 5 } }).window.opacity).toBe(1)
  })

  it("clamps numPredict, timeoutMs, maxDurationSec, moveStep, and version", () => {
    expect(coerceSettings({ ollama: { numPredict: 0 } }).ollama.numPredict).toBe(16)
    expect(coerceSettings({ ollama: { numPredict: 999999 } }).ollama.numPredict).toBe(32768)
    expect(coerceSettings({ ollama: { timeoutMs: 0 } }).ollama.timeoutMs).toBe(1000)
    expect(coerceSettings({ audio: { maxDurationSec: 0 } }).audio.maxDurationSec).toBe(1)
    expect(coerceSettings({ audio: { maxDurationSec: 99999 } }).audio.maxDurationSec).toBe(3600)
    expect(coerceSettings({ shortcuts: { moveStep: 0 } }).shortcuts.moveStep).toBe(1)
    expect(coerceSettings({ version: -5 }).version).toBe(0)
  })

  it("rounds fractional ints and rejects non-finite numbers", () => {
    expect(coerceSettings({ ollama: { numPredict: 100.7 } }).ollama.numPredict).toBe(101)
    expect(coerceSettings({ ollama: { numPredict: NaN } }).ollama.numPredict).toBe(
      DEFAULT_SETTINGS.ollama.numPredict
    )
    expect(coerceSettings({ ollama: { temperature: Infinity } }).ollama.temperature).toBe(
      DEFAULT_SETTINGS.ollama.temperature
    )
  })

  it("passes a string keepAlive through and falls back for a non-string", () => {
    expect(coerceSettings({ ollama: { keepAlive: "1h" } }).ollama.keepAlive).toBe("1h")
    expect(coerceSettings({ ollama: { keepAlive: 5 } }).ollama.keepAlive).toBe(
      DEFAULT_SETTINGS.ollama.keepAlive
    )
  })

  it("falls back to default for invalid enum values", () => {
    expect(coerceSettings({ general: { theme: "rainbow" } }).general.theme).toBe(
      DEFAULT_SETTINGS.general.theme
    )
    expect(coerceSettings({ ai: { reasoningMode: "extreme" } }).ai.reasoningMode).toBe("auto")
  })

  it("keeps only known shortcut actions and valid binding values", () => {
    const s = coerceSettings({
      shortcuts: {
        bindings: {
          toggleWindow: "CommandOrControl+B",
          bogusAction: "Control+Z",
          takeScreenshot: null,
          process: 42,
        },
      },
    })
    expect(s.shortcuts.bindings.toggleWindow).toBe("CommandOrControl+B")
    expect(s.shortcuts.bindings.takeScreenshot).toBeNull()
    expect("bogusAction" in s.shortcuts.bindings).toBe(false)
    expect("process" in s.shortcuts.bindings).toBe(false) // 42 is not string|null
  })

  it("keeps only known local shortcut actions and valid binding values", () => {
    const s = coerceSettings({
      localShortcuts: {
        bindings: {
          toggleChat: "CommandOrControl+Alt+C",
          bogusAction: "Control+Z",
          stopGeneration: null,
          focusChat: 99,
        },
      },
    })
    expect(s.localShortcuts.bindings.toggleChat).toBe("CommandOrControl+Alt+C")
    expect(s.localShortcuts.bindings.stopGeneration).toBeNull()
    expect("bogusAction" in s.localShortcuts.bindings).toBe(false)
    expect("focusChat" in s.localShortcuts.bindings).toBe(false)
  })

  it("coerces AI provider profiles and active/fallback ids", () => {
    const s = coerceSettings({
      ai: {
        activeProviderId: "openai-compatible",
        fallbackProviderIds: ["ollama", "missing", "ollama"],
        requestRetries: 99,
        providers: {
          "openai-compatible": {
            enabled: true,
            type: "openai-compatible",
            allowRemote: true,
            endpoint: "https://api.example.com/v1",
            lowModel: "fast",
          },
        },
      },
    })
    expect(s.ai.activeProviderId).toBe("openai-compatible")
    expect(s.ai.fallbackProviderIds).toEqual(["ollama"])
    expect(s.ai.requestRetries).toBe(3)
    expect(s.ai.providers["openai-compatible"].endpoint).toBe("https://api.example.com/v1")
    expect(s.ai.providers["openai-compatible"].lowModel).toBe("fast")
  })

  it("preserves a valid window position and drops a malformed one", () => {
    expect(coerceSettings({ window: { position: { x: 10, y: 20 } } }).window.position).toEqual({
      x: 10,
      y: 20,
    })
    expect(coerceSettings({ window: { position: "bad" } }).window.position).toBeNull()
  })
})

describe("isKnownAction", () => {
  it("recognizes registered action ids", () => {
    expect(isKnownAction("toggleWindow")).toBe(true)
    expect(isKnownAction("toggleMode")).toBe(true)
    expect(isKnownAction("nope")).toBe(false)
    expect(isKnownLocalAction("toggleChat")).toBe(true)
    expect(isKnownLocalAction("nope")).toBe(false)
  })
})

describe("OpenRouter online provider (defaults, offline default, endpoint pin)", () => {
  it("materialises the openrouter provider from defaults", () => {
    const or = coerceSettings({}).ai.providers.openrouter
    expect(or).toEqual(DEFAULT_SETTINGS.ai.providers.openrouter)
    expect(or.type).toBe("openai-compatible")
    expect(or.endpoint).toBe("https://openrouter.ai/api/v1")
    expect(or.allowRemote).toBe(true)
    expect(or.apiKeyRequired).toBe(true)
    expect(or.enabled).toBe(true)
    expect(or.visionModel).toBe("anthropic/claude-sonnet-5")
  })

  it("seeds the openrouter fallback-model chain (opus latest, then gpt-oss-120b)", () => {
    expect(coerceSettings({}).ai.providers.openrouter.fallbackModels).toEqual([
      "anthropic/claude-opus-4.8",
      "openai/gpt-oss-120b",
    ])
  })

  it("coerces fallbackModels: drops non-strings/blanks and de-duplicates", () => {
    const s = coerceSettings({
      ai: {
        providers: {
          openrouter: { fallbackModels: ["a", "", "  ", 42, "a", "b", null] },
        },
      },
    })
    expect(s.ai.providers.openrouter.fallbackModels).toEqual(["a", "b"])
  })

  it("defaults to the Bitecodes provider (sign-in required)", () => {
    expect(coerceSettings({}).ai.activeProviderId).toBe("bitecodes")
    // An unset/invalid active id resolves to the default (Bitecodes).
    expect(coerceSettings({ ai: { activeProviderId: "does-not-exist" } }).ai.activeProviderId).toBe(
      "bitecodes"
    )
    expect(coerceSettings({ ai: { activeProviderId: "!!bad id!!" } }).ai.activeProviderId).toBe(
      "bitecodes"
    )
  })

  it("pins the openrouter endpoint against a hostile remote override", () => {
    // Even with allowRemote true (which normally permits any HTTPS host), the
    // managed openrouter endpoint is forced back to its canonical URL so the
    // renderer cannot redirect the API key + screenshots elsewhere.
    const s = coerceSettings({
      ai: {
        providers: {
          openrouter: {
            type: "openai-compatible",
            allowRemote: true,
            endpoint: "https://evil.example.com/v1",
          },
        },
      },
    })
    expect(s.ai.providers.openrouter.endpoint).toBe("https://openrouter.ai/api/v1")
  })

  it("still allows arbitrary HTTPS for the generic openai-compatible provider", () => {
    const s = coerceSettings({
      ai: {
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            allowRemote: true,
            endpoint: "https://api.example.com/v1",
          },
        },
      },
    })
    expect(s.ai.providers["openai-compatible"].endpoint).toBe("https://api.example.com/v1")
  })

  it("pins openrouter by MAP KEY even when the inner id is spoofed (bypass regression)", () => {
    // A hostile blob storing the config under the "openrouter" slot but with a
    // decoupled inner id must not slip a remote endpoint past the pin.
    const s = coerceSettings({
      ai: {
        providers: {
          openrouter: {
            id: "spoof",
            type: "openai-compatible",
            allowRemote: true,
            endpoint: "https://evil.example.com/v1",
          },
        },
      },
    })
    expect(s.ai.providers.openrouter.endpoint).toBe("https://openrouter.ai/api/v1")
    expect(s.ai.providers.openrouter.id).toBe("openrouter")
  })

  it("keeps the offline (ollama) provider local even under a remote override attempt", () => {
    const s = coerceSettings({
      ai: {
        providers: {
          ollama: { type: "ollama", allowRemote: true, endpoint: "https://evil.example.com" },
        },
      },
    })
    expect(s.ai.providers.ollama.endpoint).toBe("http://localhost:11434")
    expect(s.ai.providers.ollama.allowRemote).toBe(false)
  })
})

describe("coerceEndpoint (SSRF guard)", () => {
  const def = "http://localhost:11434"

  it("accepts loopback and private-LAN http(s) endpoints", () => {
    expect(coerceEndpoint("http://localhost:11434", def)).toBe("http://localhost:11434")
    expect(coerceEndpoint("http://127.0.0.1:11434", def)).toBe("http://127.0.0.1:11434")
    expect(coerceEndpoint("http://192.168.1.50:11434", def)).toBe("http://192.168.1.50:11434")
    expect(coerceEndpoint("https://10.0.0.5:443", def)).toBe("https://10.0.0.5:443")
  })

  it("rejects arbitrary external hosts (no exfiltration target)", () => {
    expect(coerceEndpoint("http://evil.com/api", def)).toBe(def)
    expect(coerceEndpoint("https://attacker.example", def)).toBe(def)
    expect(coerceEndpoint("http://8.8.8.8", def)).toBe(def)
  })

  it("rejects non-http(s) schemes and unparsable values", () => {
    expect(coerceEndpoint("file:///etc/passwd", def)).toBe(def)
    expect(coerceEndpoint("javascript:alert(1)", def)).toBe(def)
    expect(coerceEndpoint("not a url", def)).toBe(def)
    expect(coerceEndpoint(42, def)).toBe(def)
  })

  it("is applied by coerceSettings to ollama.endpoint", () => {
    expect(coerceSettings({ ollama: { endpoint: "http://evil.com" } }).ollama.endpoint).toBe(def)
  })
})

describe("coerceProviderEndpoint", () => {
  it("keeps OpenAI-compatible providers local unless remote is explicit", () => {
    const def = "http://localhost:1234/v1"
    expect(
      coerceProviderEndpoint("openai-compatible", "https://api.example.com/v1", def, false)
    ).toBe(def)
    expect(
      coerceProviderEndpoint("openai-compatible", "https://api.example.com/v1", def, true)
    ).toBe("https://api.example.com/v1")
    expect(
      coerceProviderEndpoint("openai-compatible", "http://192.168.1.2:1234/v1", def, false)
    ).toBe("http://192.168.1.2:1234/v1")
  })
})
