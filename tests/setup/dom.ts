import "@testing-library/jest-dom/vitest"
import { beforeEach, afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { DEFAULT_SETTINGS } from "../../electron/config/schema"

// jsdom does not implement layout methods used by real Chromium (Electron). Stub
// them so components that call them do not throw under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Fresh, fully-stubbed window.electronAPI before every component test. Every
// method the Settings tabs call is present with a sensible default; individual
// tests override specific methods via vi.mocked(...).mockResolvedValue(...).
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function makeElectronAPIMock() {
  return {
    getSettings: vi.fn(async () => clone(DEFAULT_SETTINGS)),
    setSettings: vi.fn(async (_patch: unknown) => clone(DEFAULT_SETTINGS)),
    resetSettings: vi.fn(async () => clone(DEFAULT_SETTINGS)),
    onSettingsChanged: vi.fn((_cb: (s: unknown) => void) => () => {}),
    exportSettingsToFile: vi.fn(async () => ({ ok: true })),
    importSettingsFromFile: vi.fn(async () => ({ ok: true, settings: clone(DEFAULT_SETTINGS) })),
    getAiProviderModels: vi.fn(async (providerId?: string) => ({
      providerId: providerId ?? "ollama",
      ok: true,
      models: [] as Array<{ providerId: string; name: string; vision: boolean; capabilities: string[] }>,
    })),
    getAiProviderHealth: vi.fn(async (providerId?: string) => ({
      providerId: providerId ?? "ollama",
      ok: true,
      checkedAt: "1970-01-01T00:00:00.000Z",
      modelCount: 0,
    })),
    getAiProvidersHealth: vi.fn(async () => []),
    getAiProviderSecretStatus: vi.fn(async (providerId?: string) => ({
      providerId: providerId ?? "ollama",
      hasApiKey: false,
      secureStorageAvailable: true,
    })),
    setAiProviderApiKey: vi.fn(async () => ({ ok: true })),
    testLlmConnection: vi.fn(async () => ({ success: true })),
    getOllamaModelsDetailed: vi.fn(async () => []),
    getAvailableOllamaModels: vi.fn(async () => []),
    getCurrentLlmConfig: vi.fn(async () => ({ provider: "ollama", model: "", isOllama: true })),
    switchToOllama: vi.fn(async () => ({ success: true })),
  }
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = makeElectronAPIMock()
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
