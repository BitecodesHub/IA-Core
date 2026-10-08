// "Sign in with Bitecodes" — main-process side of the device sign-in flow.
//
// One sign-in at a time. Starting a new one cancels any in flight. The device
// token is stored with SecretStore (OS-encrypted) under the provider id
// "bitecodes", exactly like any provider API key, so the rest of the app needs
// no special case to use it.

import { app, shell } from "electron"
import { SettingsService } from "./config/SettingsService"
import { SecretStore } from "./config/SecretStore"
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
  /** Incremented on every start/cancel so a stale poll loop stops itself. */
  private generation = 0

  private get endpoint(): string {
    return (
      SettingsService.getInstance().get("ai").providers[BITECODES_PROVIDER_ID]?.endpoint ||
      BITECODES_DEFAULT_ENDPOINT
    )
  }

  private get secrets() {
    return SecretStore.getInstance()
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
    const token = this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)
    if (!token) {
      if (this.state.phase !== "signed-out") this.set({ phase: "signed-out" })
      return this.state
    }
    try {
      const me = await fetchMe(this.endpoint, token, undefined, notesClient())
      if (me.ok === false) {
        if (me.unauthorized) {
          // Revoked from the website (or expired): forget it locally too.
          this.secrets.deleteProviderApiKey(BITECODES_PROVIDER_ID)
          this.set({ phase: "signed-out", error: me.error })
          return this.state
        }
        // Server unreachable: still signed in as far as we know.
        return this.state.phase === "signed-in"
          ? this.state
          : { phase: "signed-in", name: null, email: null, available: false }
      }
      this.set({ phase: "signed-in", name: me.name, email: me.email, available: me.available })
    } catch {
      if (this.state.phase !== "signed-in") {
        this.set({ phase: "signed-in", name: null, email: null, available: false })
      }
    }
    return this.state
  }

  /** Starts a sign-in: opens the browser and resolves once the code is shown. */
  async login(): Promise<BitecodesAuthState> {
    const gen = ++this.generation
    const endpoint = this.endpoint
    let pairing
    try {
      pairing = await startPairing(endpoint, deviceLabel(), undefined, notesClient())
    } catch (err: any) {
      this.set({ phase: "signed-out", error: err?.message ?? "Could not reach Bitecodes." })
      return this.state
    }
    if (gen !== this.generation) return this.state

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
  handleRevoked(): void {
    if (!this.secrets.getProviderApiKey(BITECODES_PROVIDER_ID)) return
    this.generation++
    this.secrets.deleteProviderApiKey(BITECODES_PROVIDER_ID)
    this.set({ phase: "signed-out", error: "Signed out — sign in with Bitecodes again." })
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
    this.secrets.deleteProviderApiKey(BITECODES_PROVIDER_ID)
    this.set({ phase: "signed-out" })
    // Revoke server-side too, best effort, after the local sign-out is done.
    if (token) void revokeToken(this.endpoint, token, undefined, notesClient())
    return this.state
  }
}
