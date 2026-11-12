import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import QueueCommands from "../src/components/Queue/QueueCommands"

function renderBar(overrides: Partial<React.ComponentProps<typeof QueueCommands>> = {}) {
  const onChatToggle = vi.fn()
  const onSettingsToggle = vi.fn()
  const view = render(
    <QueueCommands
      screenshots={[]}
      mode="offline"
      onChatToggle={onChatToggle}
      onSettingsToggle={onSettingsToggle}
      {...overrides}
    />
  )
  return { ...view, onChatToggle, onSettingsToggle }
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

// --- Voice flow -------------------------------------------------------------

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  static isTypeSupported = vi.fn(() => true)
  state: "inactive" | "recording" = "inactive"
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm"
  }
  start() {
    this.state = "recording"
  }
  stop() {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("QueueCommands voice flow", () => {
  const track = { stop: vi.fn() }
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
  let api: Record<string, ReturnType<typeof vi.fn>>
  const origMediaRecorder = (globalThis as any).MediaRecorder
  const origMediaDevices = (navigator as any).mediaDevices

  beforeEach(() => {
    track.stop.mockClear()
    getUserMedia.mockClear()
    getUserMedia.mockImplementation(async () => ({ getTracks: () => [track] }))
    api = {
      analyzeAudioFromBase64: vi.fn(async () => ({
        text: "Hello from the test mic.",
        analysis: "Greet the caller back.",
        timestamp: Date.now(),
      })),
      copyToClipboard: vi.fn(async () => ({ ok: true })),
      openPrivacySettings: vi.fn(async () => ({ ok: true })),
      quitApp: vi.fn(async () => {}),
    }
    Object.assign((window as any).electronAPI, api)
    ;(globalThis as any).MediaRecorder = MockMediaRecorder
    ;(navigator as any).mediaDevices = { getUserMedia }
  })

  afterEach(() => {
    ;(globalThis as any).MediaRecorder = origMediaRecorder
    if (origMediaDevices === undefined) delete (navigator as any).mediaDevices
    else (navigator as any).mediaDevices = origMediaDevices
  })

  const startRecording = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /record voice/i }))
    return screen.findByRole("button", { name: /stop recording and transcribe/i })
  }

  it("records, transcribes, and keeps the transcript on screen (no auto-clear)", async () => {
    const user = userEvent.setup()
    renderBar()
    await startRecording(user)
    expect(screen.getByText("0:00")).toBeInTheDocument()
    await act(() => sleep(850)) // clear the minimum recording length
    await user.click(screen.getByRole("button", { name: /stop recording and transcribe/i }))

    expect(await screen.findByText("Hello from the test mic.")).toBeInTheDocument()
    expect(screen.getByText("Summary")).toBeInTheDocument()
    expect(screen.getByText("Greet the caller back.")).toBeInTheDocument()
    expect(api.analyzeAudioFromBase64).toHaveBeenCalledOnce()
    expect(api.analyzeAudioFromBase64.mock.calls[0][1]).toContain("audio/webm")
    expect(track.stop).toHaveBeenCalled()

    // The old UI wiped results after 3 s — the transcript must survive.
    await act(() => sleep(3300))
    expect(screen.getByText("Hello from the test mic.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /copy transcript/i }))
    expect(api.copyToClipboard).toHaveBeenCalledWith("Hello from the test mic.")
    expect(await screen.findByText("Copied")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /dismiss transcript/i }))
    expect(screen.queryByText("Hello from the test mic.")).not.toBeInTheDocument()
  }, 15000)

  it("discards a recording via cancel without transcribing", async () => {
    const user = userEvent.setup()
    renderBar()
    await startRecording(user)
    await user.click(screen.getByRole("button", { name: /discard recording/i }))
    expect(await screen.findByRole("button", { name: /record voice/i })).toBeInTheDocument()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
  })

  it("discards a recording via Escape", async () => {
    const user = userEvent.setup()
    renderBar()
    await startRecording(user)
    const windowShortcut = vi.fn()
    window.addEventListener("keydown", windowShortcut)
    await user.keyboard("{Escape}")
    window.removeEventListener("keydown", windowShortcut)
    expect(windowShortcut).not.toHaveBeenCalled()
    expect(await screen.findByRole("button", { name: /record voice/i })).toBeInTheDocument()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
  })

  it("releases a microphone that arrives after unmount", async () => {
    let resolve!: (stream: { getTracks: () => typeof track[] }) => void
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done }))
    const user = userEvent.setup()
    const view = renderBar()
    await user.click(screen.getByRole("button", { name: /record voice/i }))
    view.unmount()
    await act(async () => { resolve({ getTracks: () => [track] }) })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
  })

  it("releases a microphone that arrives after Escape cancels acquisition", async () => {
    let resolve!: (stream: { getTracks: () => typeof track[] }) => void
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done }))
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole("button", { name: /record voice/i }))
    await user.keyboard("{Escape}")
    await act(async () => { resolve({ getTracks: () => [track] }) })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: /record voice/i })).toBeInTheDocument()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
  })

  it("releases the microphone if recorder startup throws", async () => {
    const start = vi.spyOn(MockMediaRecorder.prototype, "start").mockImplementationOnce(() => {
      throw new Error("Recorder unavailable")
    })
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole("button", { name: /record voice/i }))
    expect(await screen.findByText(/could not start recording/i)).toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
    start.mockRestore()
  })

  it("rejects a too-short recording with a friendly message and no request", async () => {
    const user = userEvent.setup()
    renderBar()
    await startRecording(user)
    await user.click(screen.getByRole("button", { name: /stop recording and transcribe/i }))
    expect(await screen.findByText(/too short/i)).toBeInTheDocument()
    expect(api.analyzeAudioFromBase64).not.toHaveBeenCalled()
  })

  it("shows a sign-in error card with a retry action when transcription fails", async () => {
    api.analyzeAudioFromBase64.mockRejectedValue(
      new Error("Error invoking remote method 'analyze-audio': Error: Sign in with Bitecodes to use Notes.")
    )
    const user = userEvent.setup()
    renderBar()
    await startRecording(user)
    await act(() => sleep(850))
    await user.click(screen.getByRole("button", { name: /stop recording and transcribe/i }))

    expect(await screen.findByText(/sign in with bitecodes to transcribe voice/i)).toBeInTheDocument()
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /copy transcript/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /record again/i })).toBeInTheDocument()
  }, 15000)

  it("offers microphone settings when mic access is blocked", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole("button", { name: /record voice/i }))
    expect(await screen.findByText(/microphone access is blocked/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /open microphone settings/i }))
    expect(api.openPrivacySettings).toHaveBeenCalledWith("microphone")
  })
})
