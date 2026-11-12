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
    processScreenshotWithChoice: vi.fn((_type, id) => new Promise(resolve => requests.push({ id, resolve }))),
    chatStream: vi.fn((_prompt, callbacks) => {
      const cancel = vi.fn()
      streams.push({ ...callbacks, cancel })
      return cancel
    }),
    copyToClipboard: vi.fn(), showMcqHint: vi.fn(),
  }
  for (const name of ["onResetView", "onSolutionError", "onProcessingNoScreenshots", "onScreenshotError", "onScreenshotTaken", "onScreenshotAnalysisStream", "onProblemExtracted"]) {
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
