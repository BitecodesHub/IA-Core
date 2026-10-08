import React, { useEffect, useState } from "react"
import { AlertCircle, Check, Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react"
import type { BitecodesAuthState } from "../../electron/bitecodesAuth"
import BitecodesLogo from "./BitecodesLogo"

/**
 * Notes requires a Bitecodes sign-in. Until the device holds one, this gate is
 * all the app shows (centred on screen). The main process enforces the same
 * rule on every AI request (LLMHelper.requireSignIn), so the gate is the
 * explanation, not the lock.
 */
export function useBitecodesSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    const apply = (s: BitecodesAuthState) => alive && setSignedIn(s.phase === "signed-in")
    window.electronAPI
      .bitecodesStatus?.()
      .then(apply)
      .catch(() => alive && setSignedIn(false))
    const off = window.electronAPI.onBitecodesChanged?.(apply)
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return signedIn
}

function useAuthState(): [BitecodesAuthState | null, (s: BitecodesAuthState) => void] {
  const [state, setState] = useState<BitecodesAuthState | null>(null)
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
  return [state, setState]
}

function useCountdown(expiresAt: number | undefined): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [expiresAt])
  if (!expiresAt) return ""
  const s = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const Mark: React.FC = () => (
  <div className="mb-4 flex flex-col items-center gap-2">
    <BitecodesLogo className="h-12 w-12 text-white" />
    <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45">Bitecodes</span>
  </div>
)

const Steps: React.FC<{ active: 1 | 2 }> = ({ active }) => (
  <ol className="mt-5 grid grid-cols-3 gap-2 text-[10px] text-white/50" aria-label="Sign-in steps">
    {["Open browser", "Enter code", "Start using Notes"].map((label, i) => {
      const n = i + 1
      const done = n < active
      const current = n === active
      return (
        <li key={label} className="flex flex-col items-center gap-1 text-center">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
              done
                ? "border-emerald-400 bg-emerald-400/15 text-emerald-300"
                : current
                  ? "border-indigo-400 bg-indigo-400/15 text-indigo-200"
                  : "border-white/15"
            }`}
          >
            {done ? <Check className="h-3 w-3" /> : n}
          </span>
          <span className={current ? "text-white/80" : undefined}>{label}</span>
        </li>
      )
    })}
  </ol>
)

const primaryBtn =
  "gate-primary w-full rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-60 flex items-center justify-center gap-2"
const linkBtn = "gate-link text-[11px] text-white/50 hover:text-white/85 transition"

const SignInGate: React.FC<{ checking: boolean }> = ({ checking }) => {
  const [state, setState] = useAuthState()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const countdown = useCountdown(state?.phase === "waiting" ? state.expiresAt : undefined)

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

  const copy = async (code: string) => {
    try {
      await window.electronAPI.copyToClipboard(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — the code is still on screen */
    }
  }

  const loading = checking || !state

  return (
    <div
      className="signin-gate gate-drag w-[400px] rounded-2xl border border-white/10 bg-neutral-950/95 p-6 text-white shadow-2xl shadow-black/60 backdrop-blur-xl"
      data-overlay-interactive
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-gate-title"
    >
      <Mark />
      <h1 id="signin-gate-title" className="text-center text-lg font-semibold tracking-tight">
        {state?.phase === "waiting" ? "Enter this code in your browser" : "Sign in to Notes"}
      </h1>

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/60" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your account…
        </div>
      ) : state.phase === "waiting" ? (
        <>
          <p className="mt-1 text-center text-xs text-white/60">
            Type it on the Bitecodes page that just opened, then approve.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <p
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-mono text-2xl font-semibold tracking-[0.3em] text-white"
              aria-label="Confirmation code"
            >
              {state.userCode}
            </p>
            <button
              type="button"
              onClick={() => copy(state.userCode)}
              className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label={copied ? "Code copied" : "Copy code"}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/60" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Waiting for approval{countdown ? ` · expires in ${countdown}` : "…"}
          </div>
          <Steps active={2} />
          <div className="mt-5 flex items-center justify-between">
            <button type="button" className={linkBtn} onClick={() => window.electronAPI.bitecodesReopen()}>
              <ExternalLink className="mr-1 inline h-3 w-3" aria-hidden />
              Open browser again
            </button>
            <button
              type="button"
              className={linkBtn}
              onClick={() => run(() => window.electronAPI.bitecodesCancel())}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-center text-xs leading-relaxed text-white/60">
            Use your Bitecodes account to continue. Your browser opens to confirm. No password is
            typed into this app.
          </p>
          {state.phase === "signed-out" && state.error && (
            <p
              className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-200"
              role="alert"
            >
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {state.error}
            </p>
          )}
          <button
            type="button"
            className={`${primaryBtn} mt-5`}
            disabled={busy}
            onClick={() => run(() => window.electronAPI.bitecodesLogin())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
            Sign in with Bitecodes
          </button>
          <Steps active={1} />
          <p className="mt-4 text-center text-[10px] leading-relaxed text-white/40">
            Prompts and answers are stored by Bitecodes for 180 days. Screenshots are not stored.{" "}
            <button
              type="button"
              className="gate-link underline underline-offset-2"
              onClick={() => window.electronAPI.bitecodesOpenPrivacy?.()}
            >
              Privacy policy
            </button>
          </p>
        </>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-3">
        <span className="text-[10px] text-white/35">Secured by Bitecodes</span>
        <button type="button" onClick={() => window.electronAPI.quitApp()} className={linkBtn}>
          Quit
        </button>
      </div>
    </div>
  )
}

export default SignInGate
