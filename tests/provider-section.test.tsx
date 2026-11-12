import React from "react"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ProviderSection from "../src/components/Settings/ProviderSection"
import { DEFAULT_SETTINGS } from "../electron/config/schema"

const state = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../src/components/Settings/useProviderModels", () => ({ useProviderModels: () => ({ models: [], status: "idle", secret: { secureStorageAvailable: true }, refresh: state.refresh }) }))
vi.mock("../src/components/Settings/ModelSlots", () => ({ default: () => null }))
vi.mock("../src/components/Settings/FallbackChainEditor", () => ({ default: () => null }))

function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function section(id = "openai") {
  return <ProviderSection provider={DEFAULT_SETTINGS.ai.providers[id]} activeProviderId={id} isActive onActivate={vi.fn()} onUpdate={vi.fn()} />
}
beforeEach(() => { state.refresh.mockClear() })

describe("ProviderSection asynchronous ownership", () => {
  it("preserves newer key edits when an earlier save succeeds", async () => {
    const pending = deferred()
    window.electronAPI.setAiProviderApiKey = vi.fn().mockReturnValue(pending.promise)
    const user = userEvent.setup()
    render(section())
    const input = screen.getByLabelText("OpenAI API key")
    await user.type(input, "synthetic-old")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await user.clear(input)
    await user.type(input, "synthetic-new")
    await act(async () => pending.resolve({ ok: true }))
    expect(input).toHaveValue("synthetic-new")
    expect(state.refresh).toHaveBeenCalledOnce()
  })

  it("retains the draft after a failed save and allows retry", async () => {
    window.electronAPI.setAiProviderApiKey = vi.fn().mockResolvedValueOnce({ ok: false, error: "Disk full" }).mockResolvedValueOnce({ ok: true })
    const user = userEvent.setup()
    render(section())
    const input = screen.getByLabelText("OpenAI API key")
    await user.type(input, "synthetic-key")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByText("Disk full")).toBeInTheDocument()
    expect(input).toHaveValue("synthetic-key")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(input).toHaveValue("")
  })

  it("ignores an old key-save result after switching providers", async () => {
    const pending = deferred()
    window.electronAPI.setAiProviderApiKey = vi.fn().mockReturnValue(pending.promise)
    const user = userEvent.setup()
    const view = render(section())
    await user.type(screen.getByLabelText("OpenAI API key"), "synthetic-key")
    await user.click(screen.getByRole("button", { name: "Save" }))
    view.rerender(section("groq"))
    await act(async () => pending.resolve({ ok: false, error: "obsolete key failure" }))
    expect(screen.queryByText("obsolete key failure")).not.toBeInTheDocument()
    expect(state.refresh).not.toHaveBeenCalled()
  })

  it("ignores connection errors after switching providers", async () => {
    const pending = deferred()
    window.electronAPI.testLlmConnection = vi.fn().mockReturnValue(pending.promise)
    const user = userEvent.setup()
    const view = render(section())
    await user.click(screen.getByRole("button", { name: "Test" }))
    view.rerender(section("groq"))
    await act(async () => pending.reject(new Error("obsolete connection failure")))
    expect(screen.queryByText("obsolete connection failure")).not.toBeInTheDocument()
    expect(screen.queryByText("Testing…")).not.toBeInTheDocument()
    expect(state.refresh).not.toHaveBeenCalled()
  })
})
