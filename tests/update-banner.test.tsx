import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { UpdateBanner, UpdateRequiredGate } from "../src/components/UpdateBanner"

const base = {
  currentVersion: "1.7.0",
  latestVersion: "1.8.0",
  notes: "Faster answers",
  updateAvailable: true,
  updateRequired: false,
  canDownload: true,
  checkedAt: Date.now(),
}

describe("UpdateBanner", () => {
  it("offers the download when a newer version exists", async () => {
    const api = window.electronAPI as any
    api.updateDownload = vi.fn(async () => true)
    render(<UpdateBanner state={base} />)
    expect(screen.getByText(/Notes 1.8.0 is available/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole("button", { name: /Download/ }))
    expect(api.updateDownload).toHaveBeenCalled()
  })

  it("hides when up to date, and can be dismissed", async () => {
    const { rerender } = render(<UpdateBanner state={{ ...base, updateAvailable: false }} />)
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument()
    rerender(<UpdateBanner state={base} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument()
  })

  it("forced update blocks with a download and the release notes", () => {
    render(<UpdateRequiredGate state={{ ...base, updateRequired: true }} />)
    expect(screen.getByRole("dialog", { name: "Update required" })).toBeInTheDocument()
    expect(screen.getByText("Faster answers")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Download update/ })).toBeInTheDocument()
  })
})
