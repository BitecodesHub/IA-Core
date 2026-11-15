import React from "react"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Queue from "../src/_pages/Queue"

const state = vi.hoisted(() => ({ refetch: vi.fn(), listeners: {} as Record<string, (...args: any[]) => any> }))
vi.mock("../src/hooks/useScreenshots", () => ({ useScreenshots: () => ({ screenshots: [], refetch: state.refetch }) }))
vi.mock("../src/components/Settings/useSettings", () => ({ useSettings: () => ({ settings: undefined }) }))
vi.mock("../src/hooks/useToast", () => ({ useToast: () => ({ toastOpen: false, setToastOpen: vi.fn(), toastMessage: {} }) }))
vi.mock("../src/components/ui/toast", () => ({ Toast: () => null, ToastTitle: () => null, ToastDescription: () => null }))
vi.mock("../src/components/Settings/SettingsPanel", () => ({ default: () => null }))
vi.mock("../src/components/Queue/QueueCommands", () => ({ default: ({ onChatToggle }: any) => <button onClick={onChatToggle}>Chat</button> }))

const streams: Array<{ onToken: (s: string) => void; onDone: (s: string) => void; onError: (s: string) => void; cancel: ReturnType<typeof vi.fn> }> = []
const requests: Array<{ id: string; resolve: (value: any) => void }> = []
let cancelScreenshot: ReturnType<typeof vi.fn>

beforeEach(() => {
  streams.length = 0
  requests.length = 0
  state.listeners = {}
  cancelScreenshot = vi.fn().mockResolvedValue(undefined)
  const api: Record<string, any> = {
    cancelScreenshotProcessing: cancelScreenshot,
    claimTextAction: vi.fn().mockResolvedValue(null),
    cancelTextAction: vi.fn(),
    processScreenshotWithChoice: vi.fn((_type, id) => new Promise(resolve => requests.push({ id, resolve }))),
    chatStream: vi.fn((_prompt, callbacks) => {
      const cancel = vi.fn()
      streams.push({ ...callbacks, cancel })
      return cancel
    }),
    copyToClipboard: vi.fn(), showMcqHint: vi.fn(),
  }
  for (const name of ["onTextActionAvailable", "onResetView", "onSolutionError", "onProcessingNoScreenshots", "onScreenshotError", "onScreenshotTaken", "onScreenshotAnalysisStream", "onProblemExtracted"]) {
    api[name] = (callback: (...args: any[]) => any) => {
      state.listeners[name] = callback
      return vi.fn(() => { delete state.listeners[name] })
    }
  }
  window.electronAPI = api as any
})

async function startChat() {
  const user = userEvent.setup()
  const view = render(<Queue setView={vi.fn()} />)
  await user.click(screen.getByRole("button", { name: "Chat" }))
  await user.type(screen.getByRole("textbox", { name: "Message" }), "hello")
  await user.click(screen.getByRole("button", { name: "Send" }))
  return { user, ...view }
}

function update(id: string, text: string, isStreaming = true) {
  state.listeners.onScreenshotAnalysisStream({ requestId: id, problem_statement: text, isStreaming })
}

describe("Queue request lifecycle", () => {
  it("analyzes a selected-text action in chat while preserving the input draft", async () => {
    const user = userEvent.setup()
    render(<Queue setView={vi.fn()} />)
    await user.click(screen.getByRole("button", { name: "Chat" }))
    await user.type(screen.getByRole("textbox", { name: "Message" }), "unfinished draft")
    vi.mocked(window.electronAPI.claimTextAction).mockResolvedValueOnce({ id: "selection-id", kind: "selection", text: "Synthetic selected paragraph" })
    await act(async () => state.listeners.onTextActionAvailable({ openChat: true }))
    expect(window.electronAPI.chatStream).toHaveBeenCalledWith("Analyze this selected text:\n\nSynthetic selected paragraph", expect.any(Object))
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("unfinished draft")
    await act(async () => streams[0].onDone("Selected text explanation"))
    expect(screen.getByText("Selected text explanation")).toBeInTheDocument()
  })

  it("keeps a pending action through React StrictMode effect replay", async () => {
    vi.mocked(window.electronAPI.claimTextAction).mockResolvedValueOnce({ id: "strict-id", kind: "selection", text: "StrictMode synthetic text" })
    await act(async () => { render(<React.StrictMode><Queue setView={vi.fn()} /></React.StrictMode>) })
    expect(window.electronAPI.claimTextAction).toHaveBeenCalledOnce()
    expect(window.electronAPI.chatStream).toHaveBeenCalledOnce()
    await act(async () => streams[0].onDone("Complete"))
  })

  it("claims selections that arrived before Queue mounted", async () => {
    vi.mocked(window.electronAPI.claimTextAction).mockResolvedValueOnce({ id: "pending-id", kind: "selection", text: "Pending synthetic text" })
    await act(async () => { render(<Queue setView={vi.fn()} />) })
    expect(window.electronAPI.chatStream).toHaveBeenCalledOnce()
    await act(async () => streams[0].onDone("Complete"))
  })

  it("reset prevents a late selection claim from starting a request", async () => {
    let resolve!: (value: any) => void
    vi.mocked(window.electronAPI.claimTextAction).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    render(<Queue setView={vi.fn()} />)
    await act(async () => {})
    await act(async () => {
      state.listeners.onResetView()
      resolve({ id: "late-id", kind: "selection", text: "Late selection" })
    })
    expect(window.electronAPI.chatStream).not.toHaveBeenCalled()
    expect(screen.queryByText(/Late selection/)).not.toBeInTheDocument()
  })

  it("unmount drops a delayed claim instead of starting AI in a closed view", async () => {
    let resolve!: (value: any) => void
    vi.mocked(window.electronAPI.claimTextAction).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const view = render(<Queue setView={vi.fn()} />)
    await act(async () => {})
    view.unmount()
    await act(async () => resolve({ id: "closed-id", kind: "selection", text: "Closed selection" }))
    expect(window.electronAPI.chatStream).not.toHaveBeenCalled()
    expect(window.electronAPI.cancelTextAction).toHaveBeenCalled()
  })

  it("shows capture failures inline without sending them to AI", async () => {
    vi.mocked(window.electronAPI.claimTextAction).mockResolvedValueOnce({ id: "error-id", kind: "error", error: "Select some text first." })
    await act(async () => { render(<Queue setView={vi.fn()} />) })
    expect(screen.getByText("Select some text first.")).toBeInTheDocument()
    expect(window.electronAPI.chatStream).not.toHaveBeenCalled()
  })

  it("keeps partial text on Stop and ignores all late chat callbacks", async () => {
    const { user } = await startChat()
    act(() => streams[0].onToken("partial response"))
    await user.click(screen.getByRole("button", { name: "Stop" }))
    act(() => {
      streams[0].onToken("late token")
      streams[0].onDone("late completion")
      streams[0].onError("late error")
    })
    expect(streams[0].cancel).toHaveBeenCalledOnce()
    expect(screen.getByText("partial response")).toBeInTheDocument()
    expect(screen.queryByText(/late/)).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled()
  })

  it("uses authoritative final chat text exactly once", async () => {
    await startChat()
    await act(async () => {
      streams[0].onToken("draft")
      streams[0].onDone("authoritative response")
      streams[0].onDone("duplicate response")
    })
    expect(screen.getByText("authoritative response")).toBeInTheDocument()
    expect(screen.queryByText("duplicate response")).not.toBeInTheDocument()
  })

  it("preserves partial chat output on provider failure", async () => {
    await startChat()
    await act(async () => {
      streams[0].onToken("useful partial")
      streams[0].onError("Connection failed")
    })
    expect(screen.getByText(/useful partial/)).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled()
  })

  it("reset cancels chat and prevents late content from repopulating the conversation", async () => {
    await startChat()
    await act(async () => {
      state.listeners.onResetView()
      streams[0].onToken("late content")
      streams[0].onDone("late final")
    })
    expect(streams[0].cancel).toHaveBeenCalledOnce()
    expect(screen.queryByText("hello")).not.toBeInTheDocument()
    expect(screen.queryByText(/late/)).not.toBeInTheDocument()
  })

  it("keeps a replacement screenshot active when the older invocation resolves", async () => {
    render(<Queue setView={vi.fn()} />)
    act(() => { void state.listeners.onScreenshotTaken({ path: "synthetic-a.png" }) })
    act(() => update(requests[0].id, "old partial"))
    act(() => { void state.listeners.onScreenshotTaken({ path: "synthetic-b.png" }) })
    expect(cancelScreenshot).toHaveBeenCalledWith(requests[0].id)
    await act(async () => {
      requests[0].resolve({ success: false, error: "obsolete failure" })
      update(requests[0].id, "obsolete final", false)
      update(requests[1].id, "current partial")
    })
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()
    expect(screen.queryByText(/obsolete/)).not.toBeInTheDocument()
    await act(async () => {
      update(requests[1].id, "current final", false)
      update(requests[1].id, "duplicate final", false)
      requests[1].resolve({ success: true })
    })
    expect(screen.getByText("current final")).toBeInTheDocument()
    expect(screen.queryByText("duplicate final")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled()
  })

  it("unmount cancels the owned screenshot and removes event listeners", async () => {
    const view = render(<Queue setView={vi.fn()} />)
    act(() => { void state.listeners.onScreenshotTaken({ path: "synthetic.png" }) })
    view.unmount()
    expect(cancelScreenshot).toHaveBeenCalledWith(requests[0].id)
    expect(Object.keys(state.listeners)).toHaveLength(0)
    await act(async () => requests[0].resolve({ success: true }))
  })
})
