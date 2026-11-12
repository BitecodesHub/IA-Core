import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import SettingsPanel from "../src/components/Settings/SettingsPanel"
import { DEFAULT_SETTINGS } from "../electron/config/schema"

vi.mock("../src/components/Settings/ModelsTab", () => ({ default: () => null }))
vi.mock("../src/components/Settings/ShortcutsTab", () => ({ default: () => null }))
vi.mock("../src/components/Settings/WindowTab", () => ({ default: () => null }))
vi.mock("../src/components/Settings/PrivacyTab", () => ({ default: () => null }))
vi.mock("../src/components/Settings/DiagnosticsTab", () => ({ default: () => null }))

describe("SettingsPanel keyboard navigation", () => {
  it("moves selection and focus together with arrows, Home and End", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS)
    window.electronAPI.onSettingsChanged = vi.fn(() => vi.fn())
    window.electronAPI.getSettingsPersistenceStatus = vi.fn().mockResolvedValue({ state: "saved" })
    window.electronAPI.onSettingsPersistenceChanged = vi.fn(() => vi.fn())
    const user = userEvent.setup()
    render(<SettingsPanel />)
    await user.click(screen.getByRole("tab", { name: "Shortcuts" }))
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Window" })).toHaveFocus()
    expect(screen.getByRole("tab", { name: "Window" })).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{Home}")
    expect(screen.getByRole("tab", { name: "General" })).toHaveFocus()
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toHaveFocus()
    await user.keyboard("{Home}{End}")
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toHaveFocus()
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toHaveAttribute("aria-selected", "true")
  })
})
