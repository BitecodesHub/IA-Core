import { describe, expect, it, vi } from "vitest"
import { TextActionCoordinator } from "../electron/TextActionCoordinator"

function setup() {
  let session: string | null = "synthetic-session"
  let blocked = false
  const selection = vi.fn(async (_signal: AbortSignal) => ({ ok: true as const, text: "Synthetic selection" }))
  const paste = vi.fn(async (_signal: AbortSignal) => ({ ok: true as const }))
  const notify = vi.fn()
  const coordinator = new TextActionCoordinator({ selection, paste, notify, session: () => session, blocked: () => blocked })
  return { coordinator, selection, paste, notify, signOut: () => { session = null }, block: () => { blocked = true } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe("TextActionCoordinator", () => {
  it("retains a selection until the renderer claims it exactly once", async () => {
    const { coordinator, notify } = setup()
    await coordinator.analyze()
    expect(notify).toHaveBeenCalledWith(true)
    expect(coordinator.claim()).toEqual({ id: expect.any(String), kind: "selection", text: "Synthetic selection" })
    expect(coordinator.claim()).toBeNull()
  })

  it("does not read external content behind authentication or update gates", async () => {
    for (const gate of ["signOut", "block"] as const) {
      const test = setup()
      test[gate]()
      await test.coordinator.analyze()
      expect(test.selection).not.toHaveBeenCalled()
      expect(test.coordinator.claim()).toBeNull()
    }
  })

  it("cancels an obsolete capture and never publishes its result", async () => {
    const { coordinator, selection } = setup()
    const old = deferred<{ ok: true; text: string }>()
    selection.mockImplementationOnce(() => old.promise)
    const first = coordinator.analyze()
    await coordinator.analyze()
    expect(selection.mock.calls[0][0].aborted).toBe(true)
    old.resolve({ ok: true, text: "obsolete" })
    await first
    expect(coordinator.claim()).toMatchObject({ text: "Synthetic selection" })
  })

  it("reset invalidates pending and in-flight selection results", async () => {
    const { coordinator, selection, notify } = setup()
    const pending = deferred<{ ok: true; text: string }>()
    selection.mockImplementationOnce(() => pending.promise)
    const capture = coordinator.analyze()
    coordinator.cancel()
    pending.resolve({ ok: true, text: "obsolete" })
    await capture
    expect(notify).not.toHaveBeenCalled()
    expect(coordinator.claim()).toBeNull()
  })

  it("drops a result after logout or a required update", async () => {
    for (const gate of ["signOut", "block"] as const) {
      const test = setup()
      const pending = deferred<{ ok: true; text: string }>()
      test.selection.mockImplementationOnce(() => pending.promise)
      const capture = test.coordinator.analyze()
      test[gate]()
      pending.resolve({ ok: true, text: "must not publish" })
      await capture
      expect(test.notify).not.toHaveBeenCalled()
    }
  })

  it("turns native failures into inline feedback", async () => {
    const { coordinator, selection } = setup()
    selection.mockResolvedValueOnce({ ok: false, error: "No selection", code: "EMPTY_SELECTION" } as any)
    await coordinator.analyze()
    expect(coordinator.claim()).toMatchObject({ kind: "error", error: "No selection" })
  })

  it("successful paste does not focus Notes or publish an AI request", async () => {
    const { coordinator, selection, notify, paste } = setup()
    await coordinator.paste()
    expect(paste).toHaveBeenCalledOnce()
    expect(selection).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(coordinator.claim()).toBeNull()
  })

  it("ignores repeated paste triggers while one paste is pending", async () => {
    const { coordinator, paste } = setup()
    const pending = deferred<{ ok: true }>()
    paste.mockImplementationOnce(() => pending.promise)
    const first = coordinator.paste()
    await coordinator.paste()
    expect(paste).toHaveBeenCalledOnce()
    coordinator.cancel()
    expect(paste.mock.calls[0][0].aborted).toBe(true)
    pending.resolve({ ok: true })
    await first
  })

  it("records paste failures without stealing foreground focus", async () => {
    const { coordinator, paste, notify } = setup()
    paste.mockResolvedValueOnce({ ok: false, error: "Permission required", code: "ACCESSIBILITY" } as any)
    await coordinator.paste()
    expect(notify).toHaveBeenCalledWith(false)
    expect(coordinator.claim()).toMatchObject({ kind: "error", error: "Permission required" })
  })
})
