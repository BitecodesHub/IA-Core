import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import SignInGate, { useBitecodesSignedIn } from "../src/components/SignInGate"

type Listener = (s: unknown) => void
let listeners: Listener[] = []

function Harness() {
  const signedIn = useBitecodesSignedIn()
  return signedIn === true ? <div>app content</div> : <SignInGate checking={signedIn === null} />
}

function mockAuth(initial: unknown) {
  const api = window.electronAPI as any
  listeners = []
  // Like the real main process: status() reports the latest state.
  let latest = initial
  api.bitecodesStatus = vi.fn(async () => latest)
  api.onBitecodesChanged = vi.fn((cb: Listener) => {
    if (!listeners.length) listeners.push((s) => (latest = s))
    listeners.push(cb)
    return () => (listeners = listeners.filter((l) => l !== cb))
  })
  api.bitecodesLogin = vi.fn(async () => ({
    phase: "waiting",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://www.bitecodes.com/app/desktop?code=ABCD-EFGH",
    expiresAt: Date.now() + 60_000,
  }))
  api.quitApp = vi.fn(async () => {})
  return api
}

describe("SignInGate", () => {
  beforeEach(() => mockAuth({ phase: "signed-out" }))

  it("blocks the app while signed out", async () => {
    render(<Harness />)
    expect(await screen.findByRole("button", { name: /Sign in with Bitecodes/i })).toBeInTheDocument()
    expect(screen.queryByText("app content")).not.toBeInTheDocument()
  })

  it("shows the confirmation code after starting sign-in, then unlocks on approval", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByRole("button", { name: /Sign in with Bitecodes/i }))
    expect(await screen.findByLabelText("Confirmation code")).toHaveTextContent("ABCD-EFGH")
    act(() => listeners.forEach((l) => l({ phase: "signed-in", name: null, email: null, available: true })))
    expect(await screen.findByText("app content")).toBeInTheDocument()
  })

  it("re-locks when the sign-in is revoked", async () => {
    mockAuth({ phase: "signed-in", name: null, email: null, available: true })
    render(<Harness />)
    await screen.findByText("app content")
    act(() => listeners.forEach((l) => l({ phase: "signed-out", error: "Signed out — sign in with Bitecodes again." })))
    await waitFor(() => expect(screen.queryByText("app content")).not.toBeInTheDocument())
    expect(screen.getByRole("alert")).toHaveTextContent(/sign in with Bitecodes again/i)
  })

  it("stays locked if the status check fails", async () => {
    const api = mockAuth(null)
    api.bitecodesStatus = vi.fn(async () => {
      throw new Error("ipc down")
    })
    render(<Harness />)
    // Fails closed: the gate (with its sign-in button) stays up.
    expect(await screen.findByRole("button", { name: /Sign in with Bitecodes/i })).toBeInTheDocument()
    expect(screen.queryByText("app content")).not.toBeInTheDocument()
  })

  it("offers Quit", async () => {
    const api = (window.electronAPI as any)
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByRole("button", { name: "Quit" }))
    expect(api.quitApp).toHaveBeenCalled()
  })
})
