import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import ProviderPicker, {
  buildProviderOptions,
  endpointHost,
} from "../src/components/Settings/ProviderPicker"
import { DEFAULT_SETTINGS } from "../electron/config/schema"
import type { AiProviderSettings } from "../src/types/settings"

const onlineProviders = Object.values(DEFAULT_SETTINGS.ai.providers).filter(
  (p) => p.type !== "ollama"
) as AiProviderSettings[]

describe("endpointHost", () => {
  it("reduces an endpoint to its host", () => {
    expect(endpointHost("https://api.groq.com/openai/v1")).toBe("api.groq.com")
    expect(endpointHost("http://localhost:1234/v1")).toBe("localhost:1234")
  })

  it("returns the raw string when it is not a URL", () => {
    expect(endpointHost("not a url")).toBe("not a url")
  })
})

describe("buildProviderOptions", () => {
  it("includes every online provider that ships by default", () => {
    const opts = buildProviderOptions(onlineProviders, "openrouter", {})
    const values = opts.map((o) => o.value)
    for (const id of ["openrouter", "openai", "gemini", "groq", "nvidia"]) {
      expect(values).toContain(id)
    }
  })

  it("puts the active provider first", () => {
    expect(buildProviderOptions(onlineProviders, "groq", {})[0].value).toBe("groq")
    expect(buildProviderOptions(onlineProviders, "nvidia", {})[0].value).toBe("nvidia")
  })

  it("ranks providers holding a key above those without one", () => {
    const opts = buildProviderOptions(onlineProviders, "openrouter", {
      gemini: { hasApiKey: true },
    })
    const ids = opts.map((o) => o.value)
    // openrouter is active so it leads; gemini has a key so it precedes the rest.
    expect(ids[0]).toBe("openrouter")
    expect(ids[1]).toBe("gemini")
  })

  it("badges the active provider and flags a missing key", () => {
    const opts = buildProviderOptions(onlineProviders, "groq", { groq: { hasApiKey: true } })
    const groq = opts.find((o) => o.value === "groq")!
    expect(groq.badges?.map((b) => b.text)).toContain("active")
    expect(groq.badges?.map((b) => b.text)).not.toContain("no key")

    const openai = opts.find((o) => o.value === "openai")!
    expect(openai.badges?.map((b) => b.text)).toContain("no key")
  })

  it("exposes the endpoint host so providers are searchable by host", () => {
    const opts = buildProviderOptions(onlineProviders, "openrouter", {})
    expect(opts.find((o) => o.value === "groq")?.detail).toBe("api.groq.com")
    expect(opts.find((o) => o.value === "nvidia")?.detail).toBe("integrate.api.nvidia.com")
  })

  it("marks options as searchable rows, not pinned rows", () => {
    // Combobox only filters `kind: "model"` rows; anything else is pinned and
    // would survive every query, making search useless.
    for (const o of buildProviderOptions(onlineProviders, "openrouter", {})) {
      expect(o.kind).toBe("model")
    }
  })
})

describe("ProviderPicker", () => {
  const renderPicker = (onChange = vi.fn(), active = "openrouter") => {
    render(
      <ProviderPicker
        providers={onlineProviders}
        value={active}
        activeProviderId={active}
        keyState={{}}
        onChange={onChange}
      />
    )
    return { onChange, input: screen.getByRole("combobox", { name: "Online provider" }) }
  }

  it("lists every provider when opened", async () => {
    const { input } = renderPicker()
    await userEvent.click(input)
    const list = screen.getByRole("listbox", { name: "Online provider" })
    for (const name of ["OpenRouter", "OpenAI", "Google Gemini", "Groq", "NVIDIA NIM"]) {
      expect(within(list).getByText(name)).toBeInTheDocument()
    }
  })

  it("filters by provider name", async () => {
    const { input } = renderPicker()
    await userEvent.click(input)
    await userEvent.type(input, "gem")
    const list = screen.getByRole("listbox", { name: "Online provider" })
    expect(within(list).getByText("Google Gemini")).toBeInTheDocument()
    expect(within(list).queryByText("Groq")).not.toBeInTheDocument()
  })

  it("filters by endpoint host", async () => {
    const { input } = renderPicker()
    await userEvent.click(input)
    await userEvent.type(input, "nvidia.com")
    const list = screen.getByRole("listbox", { name: "Online provider" })
    expect(within(list).getByText("NVIDIA NIM")).toBeInTheDocument()
    expect(within(list).queryByText("OpenAI")).not.toBeInTheDocument()
  })

  it("emits the provider id on selection", async () => {
    const { onChange, input } = renderPicker()
    await userEvent.click(input)
    await userEvent.click(screen.getByText("Groq"))
    expect(onChange).toHaveBeenCalledWith("groq")
  })

  it("supports keyboard selection", async () => {
    const { onChange, input } = renderPicker()
    await userEvent.click(input)
    await userEvent.type(input, "groq")
    await userEvent.keyboard("{Enter}")
    expect(onChange).toHaveBeenCalledWith("groq")
  })

  it("reports no match rather than silently showing everything", async () => {
    const { input } = renderPicker()
    await userEvent.click(input)
    await userEvent.type(input, "zzzzz")
    expect(screen.getByText("No matching provider")).toBeInTheDocument()
  })
})
