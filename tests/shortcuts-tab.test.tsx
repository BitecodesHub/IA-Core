import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import ShortcutsTab from "../src/components/Settings/ShortcutsTab"
import { DEFAULT_SETTINGS } from "../electron/config/schema"

vi.mock("../src/components/Settings/useSettings", () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS, update: vi.fn() }) }))
vi.mock("../src/components/Settings/ImportExportPanel", () => ({ default: () => null }))

describe("ShortcutsTab load recovery", () => {
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
