import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BitecodesAuth as Auth } from "../electron/bitecodesAuth"

const mocks = vi.hoisted(() => ({
  token: "synthetic-old" as string | null,
  deleteFails: false,
  fetchMe: vi.fn(),
  revokeToken: vi.fn(async () => {}),
  startPairing: vi.fn(),
}))
vi.mock("electron", () => ({ app: { getVersion: () => "test" }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock("../electron/config/SettingsService", () => ({ SettingsService: { getInstance: () => ({ get: () => ({ providers: {} }) }) } }))
vi.mock("../electron/config/SecretStore", () => ({ SecretStore: { getInstance: () => ({
  getProviderApiKey: () => mocks.token,
  deleteProviderApiKey: () => {
    if (mocks.deleteFails) return { ok: false, error: "Synthetic disk failure" }
    mocks.token = null
    return { ok: true }
  },
}) } }))
vi.mock("../electron/llm/bitecodes", async (original) => ({
  ...await original<typeof import("../electron/llm/bitecodes")>(),
  fetchMe: mocks.fetchMe,
  revokeToken: mocks.revokeToken,
  startPairing: mocks.startPairing,
}))
let auth: Auth
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.token = "synthetic-old"
  mocks.deleteFails = false
  const { BitecodesAuth } = await import("../electron/bitecodesAuth")
  auth = BitecodesAuth.getInstance()
})

describe("authentication request ownership", () => {
  it("ignores a successful status response after logout", async () => {
    let resolve!: (value: unknown) => void
    mocks.fetchMe.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = auth.status()
    await auth.logout()
    resolve({ ok: true, name: "Synthetic User", email: null, available: true })
    expect((await pending).phase).toBe("signed-out")
    expect(auth.getToken()).toBeNull()
  })

  it("ignores a stale login failure after logout", async () => {
    let reject!: (error: Error) => void
    mocks.startPairing.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    const pending = auth.login()
    await auth.logout()
    reject(new Error("obsolete pairing failure"))
    expect(await pending).toMatchObject({ phase: "signed-out" })
    expect((await auth.status()).error).not.toBe("obsolete pairing failure")
  })

  it("does not publish an old pairing code after logout", async () => {
    let resolve!: (value: unknown) => void
    mocks.startPairing.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = auth.login()
    await auth.logout()
    resolve({ userCode: "SYNTHETIC", verificationUrl: "http://127.0.0.1:47123", expiresAt: Date.now() + 1000, intervalMs: 100 })
    expect((await pending).phase).toBe("signed-out")
    expect(auth.getToken()).toBeNull()
  })

  it("ignores unauthorized results for a replaced token", async () => {
    let resolve!: (value: unknown) => void
    mocks.fetchMe.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = auth.status()
    mocks.token = "synthetic-new"
    resolve({ ok: false, unauthorized: true, error: "expired" })
    await pending
    expect(auth.getToken()).toBe("synthetic-new")
  })

  it("does not let a stale provider callback revoke a new session", async () => {
    const revoked = auth.revocationHandler()
    await auth.logout()
    mocks.token = "synthetic-new"
    revoked("synthetic-old")
    expect(auth.getToken()).toBe("synthetic-new")
  })

  it("blocks a retained token after failed logout and allows retry", async () => {
    mocks.deleteFails = true
    const state = await auth.logout()
    expect(state).toMatchObject({ phase: "signed-out", error: expect.stringContaining("not saved") })
    expect(mocks.token).toBe("synthetic-old")
    expect(auth.getToken()).toBeNull()
    await auth.status()
    expect(mocks.fetchMe).not.toHaveBeenCalled()
    mocks.deleteFails = false
    await auth.logout()
    expect(mocks.token).toBeNull()
  })

  it("broadcasts the same offline state returned to the caller", async () => {
    mocks.fetchMe.mockRejectedValueOnce(new Error("offline"))
    const listener = vi.fn()
    auth.onChange(listener)
    const result = await auth.status()
    expect(result).toMatchObject({ phase: "signed-in", available: false })
    expect(listener).toHaveBeenLastCalledWith(result)
  })
})
