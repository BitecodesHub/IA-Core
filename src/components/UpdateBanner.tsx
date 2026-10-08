import React, { useEffect, useState } from "react"
import { Download, X } from "lucide-react"
import type { UpdateState } from "../../electron/updateCheck"
import BitecodesLogo from "./BitecodesLogo"

/** The latest update-feed state from the main process. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    window.electronAPI
      .updateStatus?.()
      .then((s) => alive && setState(s))
      .catch(() => {})
    const off = window.electronAPI.onUpdateChanged?.((s) => setState(s))
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return state
}

/** Small dismissible banner when a newer version is available. */
export const UpdateBanner: React.FC<{ state: UpdateState | null }> = ({ state }) => {
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!state?.updateAvailable || state.updateRequired || dismissed === state.latestVersion) return null
  return (
    <div
      className="signin-gate mb-2 flex w-fit items-center gap-3 rounded-lg border border-indigo-400/30 bg-neutral-950/90 px-3 py-2 text-xs text-white"
      data-overlay-interactive
      role="status"
    >
      <span>
        Notes {state.latestVersion} is available{" "}
        <span className="text-white/50">(you have {state.currentVersion})</span>
      </span>
      {state.canDownload && (
        <button type="button" className="gate-primary rounded-md px-2 py-1 text-[11px] font-medium" onClick={() => window.electronAPI.updateDownload()}>
          <Download className="mr-1 inline h-3 w-3" aria-hidden /> Download
        </button>
      )}
      <button type="button" className="gate-link" aria-label="Dismiss" onClick={() => setDismissed(state.latestVersion)}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** Full-screen card when the operator requires a newer build. */
export const UpdateRequiredGate: React.FC<{ state: UpdateState }> = ({ state }) => (
  <div
    className="signin-gate gate-drag w-[400px] rounded-2xl border border-white/10 bg-neutral-950/95 p-6 text-center text-white shadow-2xl shadow-black/60"
    data-overlay-interactive
    role="dialog"
    aria-modal="true"
    aria-labelledby="update-required-title"
  >
    <BitecodesLogo className="mx-auto mb-4 h-12 w-12 text-white" />
    <h1 id="update-required-title" className="text-lg font-semibold">
      Update required
    </h1>
    <p className="mt-1 text-xs leading-relaxed text-white/60">
      This version ({state.currentVersion}) is no longer supported. Install Notes {state.latestVersion ?? "the latest version"} to continue.
    </p>
    {state.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-white/5 p-3 text-left text-[11px] text-white/70">{state.notes}</p>}
    {state.canDownload ? (
      <button type="button" className="gate-primary mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium" onClick={() => window.electronAPI.updateDownload()}>
        <Download className="h-4 w-4" aria-hidden /> Download update
      </button>
    ) : (
      <p className="mt-5 text-xs text-white/60">Get the latest version from Bitecodes.</p>
    )}
    <div className="mt-4 flex justify-between">
      <button type="button" className="gate-link text-[11px]" onClick={() => window.electronAPI.updateCheck()}>
        Check again
      </button>
      <button type="button" className="gate-link text-[11px]" onClick={() => window.electronAPI.quitApp()}>
        Quit
      </button>
    </div>
  </div>
)
