import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ShortcutsTab from "../src/components/Settings/ShortcutsTab"
import { DEFAULT_SETTINGS } from "../electron/config/schema"

vi.mock("../src/components/Settings/useSettings", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS, update: vi.fn() }) }))
vi.mock("../src/components/Settings/ImportExportPanel", () => ({ default: () => null }))

describe("ShortcutsTab load recovery", () => {
  it("requests Accessibility only after an explicit click and refreshes its status", async () => {
    window.electronAPI.getShortcuts = vi.fn().mockResolvedValue({ actions: [], effective: {}, status: {}, moveStep: 50 })
    window.electronAPI.onShortcutsStatusChanged = vi.fn(() => vi.fn())
    window.electronAPI.requestTextAccessibility = vi.fn().mockResolvedValue({ supported: true, trusted: true })
    render(<ShortcutsTab />)
    const enable = await screen.findByRole("button", { name: "Enable Accessibility" })
    expect(window.electronAPI.requestTextAccessibility).not.toHaveBeenCalled()
    await userEvent.setup().click(enable)
    expect(window.electronAPI.requestTextAccessibility).toHaveBeenCalledOnce()
    expect(await screen.findByText(/Accessibility access is enabled/)).toBeInTheDocument()
  })

  it("disables unsupported text shortcuts outside macOS", async () => {
    window.electronAPI.getTextAccessibility = vi.fn().mockResolvedValue({ supported: false, trusted: false })
    window.electronAPI.getShortcuts = vi.fn().mockResolvedValue({
      actions: [{ id: "analyzeSelectedText", label: "Analyze Selected Text", category: "processing" }],
      effective: { analyzeSelectedText: null }, status: { analyzeSelectedText: "unsupported" }, moveStep: 50,
    })
    window.electronAPI.onShortcutsStatusChanged = vi.fn(() => vi.fn())
    render(<ShortcutsTab />)
    expect(await screen.findByText("macOS only")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Enable Accessibility" })).not.toBeInTheDocument()
  })

  it("shows a failed load inline and reloads on Retry", async () => {
    window.electronAPI.getShortcuts = vi.fn().mockRejectedValueOnce(new Error("Synthetic shortcut load failure")).mockResolvedValueOnce({ actions: [], effective: {}, status: {}, moveStep: 50 })
    window.electronAPI.onShortcutsStatusChanged = vi.fn(() => vi.fn())
    render(<ShortcutsTab />)
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic shortcut load failure")
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(window.electronAPI.getShortcuts).toHaveBeenCalledTimes(2)
  })
})
