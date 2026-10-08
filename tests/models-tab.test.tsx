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
  api.getAiProviderSecretStatusAll = vi.fn(async () =>
    Object.keys(current.ai.providers).map((providerId) => ({
      providerId,
      hasApiKey: false,
      secureStorageAvailable: true,
    }))
  )
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

  it("defaults to the Bitecodes model (online) with Ollama inactive", async () => {
    render(<ModelsTab />)
    const bitecodes = await screen.findByRole("region", { name: /Bitecodes settings/i })
    expect(within(bitecodes).getByText("Active")).toBeInTheDocument()
    // No model, key or endpoint controls: the model is chosen server-side.
    expect(within(bitecodes).queryByLabelText(/API key/i)).not.toBeInTheDocument()
    expect(within(bitecodes).queryByLabelText(/Endpoint/i)).not.toBeInTheDocument()
    const ollama = screen.getByRole("region", { name: /Ollama settings/i })
    expect(within(ollama).getByText("Inactive")).toBeInTheDocument()
  })

  it("switching Offline/Online toggles between Ollama and the Bitecodes model", async () => {
    const user = userEvent.setup()
    render(<ModelsTab />)
    await screen.findByRole("region", { name: /Bitecodes settings/i })
    const modeGroup = screen.getByRole("radiogroup", { name: /Offline or online mode/i })
    await user.click(within(modeGroup).getByRole("radio", { name: /Offline/i }))
    await waitFor(() => expect(store.get().ai.activeProviderId).toBe("ollama"))
    await user.click(within(modeGroup).getByRole("radio", { name: /Online/i }))
    await waitFor(() => expect(store.get().ai.activeProviderId).toBe("bitecodes"))
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
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await user.click(picker)
    await user.type(picker, "openrouter")
    await user.keyboard("{Enter}")
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

describe("ModelsTab — multiple online providers", () => {
  beforeEach(() => {
    installSettingsStore()
  })

  it("offers every bundled online provider through the searchable picker", async () => {
    render(<ModelsTab />)
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    const list = screen.getByRole("listbox", { name: "Online provider" })
    for (const name of ["OpenRouter", "OpenAI", "Google Gemini", "Groq", "NVIDIA NIM"]) {
      expect(within(list).getByText(name)).toBeInTheDocument()
    }
  })

  it("switching provider while online activates it and persists activeProviderId", async () => {
    const store = installSettingsStore()
    render(<ModelsTab />)
    // Go online first, otherwise picking only changes the previewed section.
    await userEvent.click(await screen.findByRole("radio", { name: /Online/ }))
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    await userEvent.type(picker, "groq")
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(store.get().ai.activeProviderId).toBe("groq"))
  })

  it("renders the newly selected provider's own settings section", async () => {
    installSettingsStore()
    render(<ModelsTab />)
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    await userEvent.type(picker, "nvidia")
    await userEvent.keyboard("{Enter}")
    expect(await screen.findByLabelText("NVIDIA NIM settings")).toBeInTheDocument()
  })

  it("pins the endpoint for every managed cloud provider", async () => {
    installSettingsStore()
    render(<ModelsTab />)
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    await userEvent.type(picker, "groq")
    await userEvent.keyboard("{Enter}")
    const section = await screen.findByLabelText("Groq settings")
    const endpoint = within(section).getByLabelText("Endpoint") as HTMLInputElement
    expect(endpoint.readOnly).toBe(true)
    expect(endpoint.value).toBe("https://api.groq.com/openai/v1")
  })
})

describe("ModelsTab — Amazon Bedrock region picker", () => {
  it("lists every online provider, and a searched region is persisted as its endpoint", async () => {
    const store = installSettingsStore()
    render(<ModelsTab />)
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    const list = screen.getByRole("listbox", { name: "Online provider" })
    for (const name of ["Amazon Bedrock", "Google Vertex AI", "Sharon AI", "NVIDIA NIM", "OpenRouter"]) {
      expect(within(list).getByText(name)).toBeInTheDocument()
    }
    await userEvent.type(picker, "bedrock")
    await userEvent.keyboard("{Enter}")
    const section = await screen.findByLabelText("Amazon Bedrock settings")
    // Region picker replaces the free-text endpoint field for Bedrock.
    expect(within(section).queryByLabelText("Endpoint")).not.toBeInTheDocument()
    const region = within(section).getByRole("combobox", { name: "Bedrock region" })
    expect((region as HTMLInputElement).value).toBe("Asia Pacific (Sydney)")
    await userEvent.click(region)
    await userEvent.type(region, "tokyo")
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(store.get().ai.providers.bedrock.endpoint).toBe("https://bedrock-runtime.ap-northeast-1.amazonaws.com")
    )
  })

  it("finds a region by its code as well as its name", async () => {
    installSettingsStore()
    render(<ModelsTab />)
    const picker = await screen.findByRole("combobox", { name: "Online provider" })
    await userEvent.click(picker)
    await userEvent.type(picker, "bedrock")
    await userEvent.keyboard("{Enter}")
    const section = await screen.findByLabelText("Amazon Bedrock settings")
    const region = within(section).getByRole("combobox", { name: "Bedrock region" })
    await userEvent.click(region)
    await userEvent.type(region, "eu-west-2")
    expect(screen.getByRole("listbox", { name: "Bedrock region" })).toHaveTextContent("Europe (London)")
  })
})
