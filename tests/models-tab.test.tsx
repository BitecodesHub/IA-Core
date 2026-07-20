import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import ModelsTab from "../src/components/Settings/ModelsTab"
import { DEFAULT_SETTINGS } from "../electron/config/schema"

// A settings store stub whose setSettings deep-ish merges the patch so the UI
// reflects changes via the onSettingsChanged broadcast, mirroring the real IPC.
function installSettingsStore() {
  const current = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  const listeners: Array<(s: unknown) => void> = []
  const api = window.electronAPI as any
  api.getSettings = vi.fn(async () => JSON.parse(JSON.stringify(current)))
  api.onSettingsChanged = vi.fn((cb: (s: unknown) => void) => {
    listeners.push(cb)
    return () => {}
  })
  api.setSettings = vi.fn(async (patch: any) => {
    // Merge ai fields + per-provider fields without dropping sibling providers.
    if (patch.ai) {
      const { providers: pProviders, ...aiRest } = patch.ai
      current.ai = { ...current.ai, ...aiRest }
      if (pProviders) {
        current.ai.providers = { ...current.ai.providers }
        for (const [id, p] of Object.entries(pProviders)) {
          current.ai.providers[id] = { ...current.ai.providers[id], ...(p as object) }
        }
      }
    }
    const snapshot = JSON.parse(JSON.stringify(current))
    listeners.forEach((l) => l(snapshot))
    return snapshot
  })
  return {
    get: () => current,
    setModels: (providerId: string, models: any[], ok = true, error?: string) => {
      api.getAiProviderModels = vi.fn(async (id?: string) => ({
        providerId: id ?? providerId,
        ok,
        models: id === providerId || !id ? models : [],
        error,
      }))
    },
  }
}

describe("ModelsTab", () => {
  let store: ReturnType<typeof installSettingsStore>
  beforeEach(() => {
    store = installSettingsStore()
  })

  it("renders Offline and Online sections with the correct active badge", async () => {
    render(<ModelsTab />)
    // Default active provider is ollama → offline.
    const ollama = await screen.findByRole("region", { name: /Ollama settings/i })
    expect(within(ollama).getByText("Active")).toBeInTheDocument()
    // Online section (OpenRouter) present and inactive.
    const online = screen.getByRole("region", { name: /OpenRouter settings/i })
    expect(within(online).getByText("Inactive")).toBeInTheDocument()
  })

  it("switching to Online activates the online provider (persists activeProviderId)", async () => {
    const user = userEvent.setup()
    render(<ModelsTab />)
    await screen.findByRole("region", { name: /Ollama settings/i })
    // Mode radiogroup → Online.
    const modeGroup = screen.getByRole("radiogroup", { name: /Offline or online mode/i })
    await user.click(within(modeGroup).getByRole("radio", { name: /Online/i }))
    await waitFor(() => expect(store.get().ai.activeProviderId).toBe("openrouter"))
    expect((window.electronAPI.setSettings as any)).toHaveBeenCalled()
  })

  it("shows an error state when discovery fails", async () => {
    store.setModels("ollama", [], false, "connection refused")
    render(<ModelsTab />)
    const ollama = await screen.findByRole("region", { name: /Ollama settings/i })
    await waitFor(() =>
      expect(within(ollama).getByText(/connection refused/i)).toBeInTheDocument()
    )
  })

  it("selecting a Low model persists it to settings", async () => {
    store.setModels("ollama", [
      { providerId: "ollama", name: "llama3.2", vision: false, capabilities: ["text"] },
      { providerId: "ollama", name: "qwen2.5-vl", vision: true, capabilities: ["text", "vision"] },
    ])
    const user = userEvent.setup()
    render(<ModelsTab />)
    const ollama = await screen.findByRole("region", { name: /Ollama settings/i })
    // Open the Low model combobox and pick llama3.2.
    await user.click(within(ollama).getByRole("combobox", { name: /Low \(fast\) model/i }))
    await user.click(await screen.findByRole("option", { name: /llama3\.2/ }))
    await waitFor(() =>
      expect(store.get().ai.providers.ollama.lowModel).toBe("llama3.2")
    )
  })

  it("adds a fallback model to the chain", async () => {
    store.setModels("ollama", [
      { providerId: "ollama", name: "llama3.2", vision: false, capabilities: ["text"] },
      { providerId: "ollama", name: "mistral", vision: false, capabilities: ["text"] },
    ])
    const user = userEvent.setup()
    render(<ModelsTab />)
    const ollama = await screen.findByRole("region", { name: /Ollama settings/i })
    await user.click(within(ollama).getByRole("combobox", { name: /Add fallback model/i }))
    await user.click(await screen.findByRole("option", { name: /mistral/ }))
    await waitFor(() =>
      expect(store.get().ai.providers.ollama.fallbackModels).toContain("mistral")
    )
  })

  it("saves an API key for the online provider", async () => {
    const user = userEvent.setup()
    render(<ModelsTab />)
    const online = await screen.findByRole("region", { name: /OpenRouter settings/i })
    await user.type(within(online).getByLabelText(/OpenRouter API key/i), "sk-or-v1-TESTKEY")
    await user.click(within(online).getByRole("button", { name: /^Save$/i }))
    await waitFor(() =>
      expect(window.electronAPI.setAiProviderApiKey as any).toHaveBeenCalledWith(
        "openrouter",
        "sk-or-v1-TESTKEY"
      )
    )
  })
})
