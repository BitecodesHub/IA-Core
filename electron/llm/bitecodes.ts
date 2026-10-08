// The "Bitecodes model": the desktop app's default provider.
//
// Every request goes to the user's Bitecodes account, which routes it through
// whatever upstream providers the operator configured (NVIDIA / OpenRouter /
// Bedrock, default + fallbacks) and logs it. The app never learns which model
// answered — the server deliberately does not say — so there is nothing to
// configure here beyond signing in.
//
// Sign-in is a device-authorization flow: the app gets a secret device code,
// opens the browser on a short user code, and polls. The user signs in to
// Bitecodes in the browser (password, Google, 2FA — whatever they use) and
// approves. No password ever touches this app; it only ever holds the
// resulting device token, which SecretStore keeps encrypted.

import type { AiProviderSettings } from "../config/schema"
import type { GenerateRequest, LlmProvider, ModelInfo, ProviderHealth } from "./providers"
import { takeLines } from "./parse"

/** The single model id the app uses for Bitecodes. It is not sent upstream. */
export const BITECODES_MODEL = "bitecodes"
export const BITECODES_DEFAULT_ENDPOINT = "https://www.bitecodes.com"

/** Shared shape with the other providers so the fallback classifier works. */
function apiError(status: number, message: string): Error {
  return new Error(`Provider API error ${status}: ${message}`)
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  try {
    const parsed = JSON.parse(text)
    return String(parsed?.message ?? parsed?.code ?? text).slice(0, 300)
  } catch {
    return text.slice(0, 300) || res.statusText
  }
}

function base(endpoint: string): string {
  return endpoint.replace(/\/+$/, "")
}

/**
 * Notes requires a Bitecodes account: every AI request (any provider, including
 * fallbacks) is refused until the user has signed in on this device.
 */
export const LOGIN_REQUIRED = "Sign in with Bitecodes to use Notes."

export const SIGN_IN_REQUIRED = "Sign in with Bitecodes (Settings → AI) to use the Bitecodes model."

export interface BitecodesProviderOptions {
  fetchImpl?: typeof fetch
  /** Called when the server rejects the token (revoked from the website). */
  onUnauthorized?: () => void
  /** App build for the operator's activity log, e.g. "Notes/1.7.0 (darwin; arm64)". */
  client?: string
}

export class BitecodesProvider implements LlmProvider {
  private readonly fetchImpl: typeof fetch
  private readonly onUnauthorized?: () => void
  private readonly client?: string

  constructor(
    readonly config: AiProviderSettings,
    private readonly getToken: () => string | null,
    opts: BitecodesProviderOptions = {}
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a))
    this.onUnauthorized = opts.onUnauthorized
    this.client = opts.client
  }

  async listModels(): Promise<ModelInfo[]> {
    // One opaque model; the server picks the real one (vision included).
    return [
      {
        providerId: this.config.id,
        name: BITECODES_MODEL,
        vision: true,
        capabilities: ["text", "json", "streaming", "vision"],
      },
    ]
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()
    const started = Date.now()
    const token = this.getToken()
    if (!token) return { providerId: this.config.id, ok: false, checkedAt, error: SIGN_IN_REQUIRED }
    try {
      const me = await fetchMe(this.config.endpoint, token, this.fetchImpl, this.client)
      if (me.ok === false) return { providerId: this.config.id, ok: false, checkedAt, error: me.error }
      if (!me.available) {
        return {
          providerId: this.config.id,
          ok: false,
          checkedAt,
          error: "Signed in, but the Bitecodes model is switched off on the server.",
        }
      }
      return { providerId: this.config.id, ok: true, checkedAt, latencyMs: Date.now() - started, modelCount: 1 }
    } catch (err: any) {
      return { providerId: this.config.id, ok: false, checkedAt, error: err?.message ?? String(err) }
    }
  }

  async generate(request: GenerateRequest): Promise<string> {
    const token = this.getToken()
    if (!token) throw apiError(401, SIGN_IN_REQUIRED)

    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const kick = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), this.config.timeoutMs)
    }
    const onAbort = () => ctl.abort()
    if (request.signal?.aborted) ctl.abort()
    request.signal?.addEventListener("abort", onAbort, { once: true })
    kick()

    try {
      const res = await this.fetchImpl(`${base(this.config.endpoint)}/api/v1/desktop/assistant`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(this.client ? { "X-Notes-Client": this.client } : {}),
        },
        body: JSON.stringify({
          prompt: request.prompt,
          images: request.images ?? [],
          maxTokens: request.options.numPredict,
          ...(request.kind ? { kind: request.kind } : {}),
        }),
        signal: ctl.signal,
      })
      kick()
      if (!res.ok) {
        const message = await readError(res)
        if (res.status === 401) this.onUnauthorized?.()
        throw apiError(res.status, res.status === 401 ? `${message} ${SIGN_IN_REQUIRED}` : message)
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response body reader available.")

      const decoder = new TextDecoder()
      let buffer = ""
      let full = ""
      let event = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          kick()
          request.onActivity?.()
          buffer += decoder.decode(value, { stream: true })
          const { lines, rest } = takeLines(buffer)
          buffer = rest
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.slice(6).trim()
              continue
            }
            if (!line.startsWith("data:")) continue
            let data: any
            try {
              data = JSON.parse(line.slice(5).trim())
            } catch {
              continue
            }
            if (event === "token" && typeof data?.delta === "string") {
              full += data.delta
              request.onToken?.(data.delta)
            } else if (event === "error") {
              // 502-shaped: transient from the app's point of view (the server
              // already walked every upstream it has).
              throw apiError(502, String(data?.message ?? "The Bitecodes model could not answer."))
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      if (!full.trim()) throw new Error("No response content received from the Bitecodes model.")
      return full
    } catch (err: any) {
      if (ctl.signal.aborted && !request.signal?.aborted) throw new Error("Request timed out (no data received).")
      if (request.signal?.aborted) throw new Error("Request cancelled.")
      throw err
    } finally {
      if (timer) clearTimeout(timer)
      request.signal?.removeEventListener("abort", onAbort)
    }
  }
}

// ---------------------------------------------------------------------------
// Account endpoints (used by the sign-in flow and the Settings card)
// ---------------------------------------------------------------------------

export type MeResult =
  | { ok: true; name: string | null; email: string | null; device: string | null; available: boolean }
  | { ok: false; unauthorized: boolean; error: string }

/** Identifies the app build to Bitecodes' activity log (never secret). */
export function clientHeader(client: string | undefined): Record<string, string> {
  return client ? { "X-Notes-Client": client } : {}
}

export async function fetchMe(
  endpoint: string,
  token: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  client?: string
): Promise<MeResult> {
  const res = await fetchImpl(`${base(endpoint)}/api/v1/desktop/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...clientHeader(client) },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) return { ok: false, unauthorized: true, error: "Signed out — sign in with Bitecodes again." }
  if (!res.ok) return { ok: false, unauthorized: false, error: `Bitecodes returned HTTP ${res.status}.` }
  const d: any = await res.json()
  return {
    ok: true,
    name: d?.user?.name ?? null,
    email: d?.user?.email ?? null,
    device: d?.device?.label ?? null,
    available: Boolean(d?.assistant?.available),
  }
}

export interface PairingStart {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresAt: number
  intervalMs: number
}

export async function startPairing(
  endpoint: string,
  label: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  client?: string
): Promise<PairingStart> {
  const res = await fetchImpl(`${base(endpoint)}/api/v1/desktop/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientHeader(client) },
    body: JSON.stringify({ label }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(res.status === 429 ? "Too many sign-in attempts. Try again in a few minutes." : `Could not reach Bitecodes (HTTP ${res.status}).`)
  }
  const d: any = await res.json()
  const verificationUrl = String(d?.verificationUrl ?? "")
  // The browser is opened on this URL: it must be the Bitecodes site we asked.
  if (new URL(verificationUrl).origin !== new URL(endpoint).origin) {
    throw new Error("Bitecodes returned an unexpected sign-in address.")
  }
  return {
    deviceCode: String(d.deviceCode),
    userCode: String(d.userCode),
    verificationUrl,
    expiresAt: Date.parse(d.expiresAt) || Date.now() + 10 * 60_000,
    intervalMs: Math.max(1000, (Number(d.interval) || 2) * 1000),
  }
}

export type PollOutcome =
  | { status: "pending" }
  | { status: "approved"; token: string }
  | { status: "denied" }
  | { status: "expired" }

export async function pollPairing(
  endpoint: string,
  deviceCode: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  client?: string
): Promise<PollOutcome> {
  const res = await fetchImpl(`${base(endpoint)}/api/v1/desktop/pair/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientHeader(client) },
    body: JSON.stringify({ deviceCode }),
    signal: AbortSignal.timeout(15_000),
  })
  const d: any = await res.json().catch(() => ({}))
  if (res.status === 200 && d?.status === "approved" && typeof d.token === "string") {
    return { status: "approved", token: d.token }
  }
  if (res.status === 202) return { status: "pending" }
  if (res.status === 403) return { status: "denied" }
  if (res.status === 410) return { status: "expired" }
  // Network hiccup / 5xx: keep waiting rather than abandoning the sign-in.
  return { status: "pending" }
}

export async function revokeToken(
  endpoint: string,
  token: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  client?: string
): Promise<void> {
  await fetchImpl(`${base(endpoint)}/api/v1/desktop/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...clientHeader(client) },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}

/**
 * Allowed Bitecodes endpoints. The device token is sent here with every
 * request, so a settings value must not be able to point it anywhere else:
 * https on bitecodes.com (any subdomain), or a loopback dev server.
 */
export function isAllowedBitecodesEndpoint(value: string): boolean {
  try {
    const u = new URL(value)
    if (u.username || u.password) return false
    const host = u.hostname.toLowerCase()
    if (u.protocol === "https:" && (host === "bitecodes.com" || host.endsWith(".bitecodes.com"))) return true
    return u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")
  } catch {
    return false
  }
}
