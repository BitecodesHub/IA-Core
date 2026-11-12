// "Sign in with Bitecodes" — main-process side of the device sign-in flow.
//
// One sign-in at a time. Starting a new one cancels any in flight. The device
// token is stored with SecretStore (OS-encrypted) under the provider id
// "bitecodes", exactly like any provider API key, so the rest of the app needs
// no special case to use it.

import { app, shell } from "electron"
import { SettingsService } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
import { coerceProviderEndpoint } from "./config/schema"
import {
  BITECODES_DEFAULT_ENDPOINT,
  fetchMe,
  pollPairing,
  revokeToken,
  startPairing,
} from "./llm/bitecodes"

export const BITECODES_PROVIDER_ID = "bitecodes"

export type BitecodesAuthState =
  | { phase: "signed-out"; error?: string }
  | { phase: "waiting"; userCode: string; verificationUrl: string; expiresAt: number }
  | {
      phase: "signed-in"
      name: string | null
      email: string | null
      available: boolean
    }

type Listener = (state: BitecodesAuthState) => void

/** The app build, reported to Bitecodes' activity log. */
export function notesClient(): string {
  return `Notes/${app.getVersion()} (${process.platform}; ${process.arch})`
}

function deviceLabel(): string {
  const os =
    process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux"
  return `Notes on ${os}`
}

export class BitecodesAuth {
  private static instance: BitecodesAuth | null = null
  static getInstance(): BitecodesAuth {
    if (!BitecodesAuth.instance) BitecodesAuth.instance = new BitecodesAuth()
    return BitecodesAuth.instance
  }

  private listeners = new Set<Listener>()
  private state: BitecodesAuthState = { phase: "signed-out" }
  /** Invalidates status, login and revocation callbacks across session changes. */
  private generation = 0
  /** A failed disk deletion must not silently authenticate again in this process. */
  private blockedToken: string | null = null

  private get endpoint(): string {
    const providers = SettingsService.getInstance().get("ai").providers
    const endpoint = Object.prototype.hasOwnProperty.call(providers, BITECODES_PROVIDER_ID)
      ? providers[BITECODES_PROVIDER_ID]?.endpoint : undefined
    return coerceProviderEndpoint("bitecodes", endpoint, BITECODES_DEFAULT_ENDPOINT, true)
  }

  private get secrets() {
    return SecretStore.getInstance()
  }

  /** Use for auth gates and requests so failed logout cannot reuse the retained secret. */
  getToken(): string | null {
    const token = this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)
    return token === this.blockedToken ? null : token
  }

  private ownsSession(gen: number, token: string | null): boolean {
    return gen === this.generation && token === this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)
  }

  /** Capture before starting an HTTP request; the callback receives its actual token. */
  revocationHandler(): (token: string) => void {
    const gen = this.generation
    return (token) => this.handleRevoked(token, gen)
  }

  private forgetToken(token: string | null, error?: string): void {
    this.blockedToken = token
    const removed = this.secrets.deleteProviderApiKey(BITECODES_PROVIDER_ID)
    if (!removed.ok) {
      this.set({
        phase: "signed-out",
        error: `${removed.error ?? "Could not remove the stored sign-in."} Sign-out was not saved; retry signing out.`,
      })
      return
    }
    this.set(error ? { phase: "signed-out", error } : { phase: "signed-out" })
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: BitecodesAuthState) {
    this.state = next
    for (const l of this.listeners) {
      try {
        l(next)
      } catch {
        /* a broken listener must not stop the others */
      }
    }
  }

  /** Current state, refreshed from the server when a token is stored. */
  async status(): Promise<BitecodesAuthState> {
    if (this.state.phase === "waiting") return this.state
    const gen = this.generation
    const token = this.getToken()
    if (!token) {
      if (this.state.phase !== "signed-out") this.set({ phase: "signed-out" })
      return this.state
    }
    const current = () => this.ownsSession(gen, token) && this.state.phase !== "waiting"
    const offline = () => this.set(this.state.phase === "signed-in"
      ? { ...this.state, available: false }
      : { phase: "signed-in", name: null, email: null, available: false })
    try {
      const me = await fetchMe(this.endpoint, token, undefined, notesClient())
      if (!current()) return this.state
      if (me.ok === false) {
        if (me.unauthorized) {
          this.generation++
          this.forgetToken(token, me.error)
        } else {
          // Offline results and broadcasts must describe the same state.
          offline()
        }
        return this.state
      }
      this.set({ phase: "signed-in", name: me.name, email: me.email, available: me.available })
    } catch {
      if (current()) offline()
    }
    return this.state
  }

  /** Starts a sign-in: opens the browser and resolves once the code is shown. */
  async login(): Promise<BitecodesAuthState> {
    const gen = ++this.generation
    const token = this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)
    const endpoint = this.endpoint
    let pairing
    try {
      pairing = await startPairing(endpoint, deviceLabel(), undefined, notesClient())
    } catch (err: any) {
      if (this.ownsSession(gen, token)) this.set({ phase: "signed-out", error: err?.message ?? "Could not reach Bitecodes." })
      return this.state
    }
    if (!this.ownsSession(gen, token)) return this.state

    this.set({
      phase: "waiting",
      userCode: pairing.userCode,
      verificationUrl: pairing.verificationUrl,
      expiresAt: pairing.expiresAt,
    })
    void shell.openExternal(pairing.verificationUrl).catch(() => {})
    void this.pollUntilDone(gen, endpoint, pairing.deviceCode, pairing.intervalMs, pairing.expiresAt)
    return this.state
  }

  private async pollUntilDone(
    gen: number,
    endpoint: string,
    deviceCode: string,
    intervalMs: number,
    expiresAt: number
  ) {
    while (gen === this.generation && Date.now() < expiresAt) {
      await new Promise((r) => setTimeout(r, intervalMs))
      if (gen !== this.generation) return
      let outcome
      try {
        outcome = await pollPairing(endpoint, deviceCode, undefined, notesClient())
      } catch {
        continue // offline for a moment — keep waiting
      }
      if (gen !== this.generation) return
      if (outcome.status === "pending") continue
      if (outcome.status === "approved") {
        const stored = this.secrets.setProviderApiKey(BITECODES_PROVIDER_ID, outcome.token)
        if (!stored.ok) {
          this.set({ phase: "signed-out", error: stored.error ?? "Could not store the sign-in securely." })
          return
        }
        this.blockedToken = null
        this.set({ phase: "signed-in", name: null, email: null, available: false })
        await this.status()
        return
      }
      this.set({
        phase: "signed-out",
        error:
          outcome.status === "denied"
            ? "Sign-in was denied in the browser."
            : "The sign-in request expired. Try again.",
      })
      return
    }
    if (gen === this.generation && this.state.phase === "waiting") {
      this.set({ phase: "signed-out", error: "The sign-in request expired. Try again." })
    }
  }

  /**
   * The server rejected the stored token mid-request (revoked from the
   * website). Forget it now so the app locks immediately, rather than at the
   * next status check.
   */
  handleRevoked(token: string, gen: number): void {
    if (!this.ownsSession(gen, token)) return
    this.generation++
    this.forgetToken(token, "Signed out — sign in with Bitecodes again.")
  }

  /** Re-opens the browser on the pending sign-in (only ever the URL Bitecodes gave us). */
  reopenBrowser(): void {
    if (this.state.phase === "waiting") void shell.openExternal(this.state.verificationUrl).catch(() => {})
  }

  /** Opens the Bitecodes privacy policy (fixed path on the configured, allowlisted endpoint). */
  openPrivacyPolicy(): void {
    void shell.openExternal(`${this.endpoint.replace(/\/+$/, "")}/privacy`).catch(() => {})
  }

  cancel(): BitecodesAuthState {
    this.generation++
    if (this.state.phase === "waiting") this.set({ phase: "signed-out" })
    return this.state
  }

  async logout(): Promise<BitecodesAuthState> {
    this.generation++
    const token = this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)
    this.forgetToken(token)
    // Revoke server-side too, best effort, after the local sign-out is done.
    if (token) void revokeToken(this.endpoint, token, undefined, notesClient())
    return this.state
  }
}
