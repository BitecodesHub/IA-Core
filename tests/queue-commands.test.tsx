import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import QueueCommands from "../src/components/Queue/QueueCommands"

function renderBar(overrides: Partial<React.ComponentProps<typeof QueueCommands>> = {}) {
  const onChatToggle = vi.fn()
  const onSettingsToggle = vi.fn()
  render(
    <QueueCommands
      screenshots={[]}
      mode="offline"
      onChatToggle={onChatToggle}
      onSettingsToggle={onSettingsToggle}
      {...overrides}
    />
  )
  return { onChatToggle, onSettingsToggle }
}

describe("QueueCommands (main capsule)", () => {
  it("shows a Settings button that opens settings", async () => {
    const user = userEvent.setup()
    const { onSettingsToggle } = renderBar()
    const btn = screen.getByRole("button", { name: /settings/i })
    await user.click(btn)
    expect(onSettingsToggle).toHaveBeenCalledOnce()
  })

  it("shows a Chat button that toggles chat", async () => {
    const user = userEvent.setup()
    const { onChatToggle } = renderBar()
    await user.click(screen.getByRole("button", { name: /^chat$/i }))
    expect(onChatToggle).toHaveBeenCalledOnce()
  })

  it("does NOT show the '?' help button", () => {
    renderBar()
    expect(screen.queryByRole("button", { name: "?" })).not.toBeInTheDocument()
    expect(screen.queryByText("?")).not.toBeInTheDocument()
  })

  it("does NOT show the Show/Hide control or shortcut hints", () => {
    renderBar()
    expect(screen.queryByText(/show\/hide/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/keyboard shortcuts/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/toggle window/i)).not.toBeInTheDocument()
    // The ⌘ / B shortcut key chips are gone from the main screen.
    expect(screen.queryByText("⌘")).not.toBeInTheDocument()
    expect(screen.queryByText("B")).not.toBeInTheDocument()
  })

  it("still shows the mode indicator", () => {
    renderBar({ mode: "online" })
    expect(screen.getByText(/online/i)).toBeInTheDocument()
  })
})
