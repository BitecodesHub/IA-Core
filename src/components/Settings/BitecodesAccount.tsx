import React, { useEffect, useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, LogIn, LogOut } from "lucide-react"
import type { BitecodesAuthState } from "../../../electron/bitecodesAuth"

/**
 * The Bitecodes provider's settings: just the account. There is deliberately no
 * model, key or endpoint to configure — the Bitecodes server decides which
 * model answers, and the user is never shown it.
 */
const BitecodesAccount: React.FC = () => {
  const [state, setState] = useState<BitecodesAuthState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.electronAPI
      .bitecodesStatus?.()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ phase: "signed-out" }))
    const off = window.electronAPI.onBitecodesChanged?.((s) => setState(s))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  const run = async (fn: () => Promise<BitecodesAuthState>) => {
    setBusy(true)
    try {
      setState(await fn())
    } catch {
      setState({ phase: "signed-out", error: "Something went wrong. Try again." })
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/60" role="status">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking your Bitecodes account…
      </div>
    )
  }

  if (state.phase === "signed-in") {
    return (
      <div className="space-y-2 border border-white/10 rounded-md p-2" aria-label="Bitecodes account">
        <div className="flex items-start gap-2 text-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" aria-hidden />
          <div className="min-w-0">
            <div className="text-white/90">
              Signed in{state.email ? ` as ${state.email}` : ""}
            </div>
            <div className={state.available ? "text-white/50" : "text-amber-300"}>
              {state.available
                ? "The Bitecodes model is ready."
                : "The Bitecodes model is currently unavailable — your other providers are used meanwhile."}
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => window.electronAPI.bitecodesLogout())}
          className="text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10 disabled:opacity-50"
        >
          <LogOut className="inline h-3 w-3 mr-1" aria-hidden /> Sign out
        </button>
      </div>
    )
  }

  if (state.phase === "waiting") {
    return (
      <div className="space-y-2 border border-white/10 rounded-md p-2" aria-label="Bitecodes sign-in">
        <p className="text-xs text-white/70">
          Finish signing in in your browser. Approve only if it shows this code:
        </p>
        <p
          className="text-center font-mono text-lg tracking-[0.25em] text-white py-1 rounded bg-white/5"
          aria-label="Confirmation code"
        >
          {state.userCode}
        </p>
        <div className="flex items-center gap-2 text-xs text-white/60" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Waiting for approval…
        </div>
        <p className="text-[10px] text-white/45 break-all">
          Browser didn&apos;t open? Go to {state.verificationUrl}
        </p>
        <button
          type="button"
          onClick={() => run(() => window.electronAPI.bitecodesCancel())}
          className="text-xs px-2 py-1 rounded border border-white/30 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 border border-white/10 rounded-md p-2" aria-label="Bitecodes sign-in">
      <p className="text-xs text-white/70">
        Sign in with your Bitecodes account to use the Bitecodes model. Your browser opens to
        confirm — no password is entered here.
      </p>
      {state.error && (
        <p className="text-[11px] text-amber-300" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => window.electronAPI.bitecodesLogin())}
        className="text-xs px-2 py-1 rounded bg-white text-black hover:bg-white/90 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="inline h-3 w-3 mr-1 animate-spin" aria-hidden />
        ) : (
          <LogIn className="inline h-3 w-3 mr-1" aria-hidden />
        )}
        Sign in with Bitecodes
        <ExternalLink className="inline h-3 w-3 ml-1 opacity-60" aria-hidden />
      </button>
    </div>
  )
}

export default BitecodesAccount
