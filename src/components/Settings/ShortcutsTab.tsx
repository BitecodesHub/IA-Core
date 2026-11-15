import React, { useEffect, useMemo, useState, useCallback } from "react"
import type { Binding, LocalShortcutActionId, ShortcutActionId } from "../../types/settings"
import KeyCaptureInput from "./KeyCaptureInput"
import { useSettings } from "./useSettings"
import { useImportExport } from "./useImportExport"
import ImportExportPanel from "./ImportExportPanel"
import {
  DEFAULT_LOCAL_BINDINGS,
  LOCAL_SHORTCUT_ACTION_LIST,
  resolveEffectiveLocalBindings,
} from "../../../electron/shortcuts/actions"

type Snapshot = Awaited<ReturnType<Window["electronAPI"]["getShortcuts"]>>
type Scope = "global" | "local"

const statusStyles: Record<string, string> = {
  active: "text-green-400",
  disabled: "text-white/40",
  "os-conflict": "text-amber-400",
  duplicate: "text-red-400",
  unsupported: "text-white/40",
}

const statusLabel: Record<string, string> = {
  active: "Active",
  disabled: "Disabled",
  "os-conflict": "Reserved by system / another app",
  duplicate: "Conflict",
  unsupported: "macOS only",
}

const categoryLabels: Record<string, string> = {
  all: "All",
  window: "Window",
  capture: "Capture",
  processing: "Processing",
  mode: "Mode",
  chat: "Chat",
  settings: "Settings",
  control: "Control",
}

const ShortcutsTab: React.FC<{ search?: string }> = ({ search = "" }) => {
  const { settings, update } = useSettings()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [category, setCategory] = useState("all")
  const [accessibility, setAccessibility] = useState<Awaited<ReturnType<Window["electronAPI"]["getTextAccessibility"]>> | null>(null)
  const [requestingAccess, setRequestingAccess] = useState(false)

  const load = useCallback(async () => {
    try {
      const [shortcuts, access] = await Promise.all([
        window.electronAPI.getShortcuts(),
        window.electronAPI.getTextAccessibility(),
      ])
      setSnapshot(shortcuts)
      setAccessibility(access)
      setLoadError(null)
    } catch (error: any) {
      setLoadError(error?.message ?? "Could not load shortcuts.")
    }
  }, [])

  const io = useImportExport(
    () => window.electronAPI.exportShortcuts(),
    async (data) => {
      const res = await window.electronAPI.importShortcuts(data)
      const ok = !!res && (!("error" in res) || !res.error)
      if (ok) await load()
      return { ok, error: res && "error" in res ? res.error : undefined }
    }
  )

  useEffect(() => {
    load()
    const off = window.electronAPI.onShortcutsStatusChanged(() => load())
    return off
  }, [load])

  const requestAccessibility = async () => {
    setRequestingAccess(true)
    try {
      setAccessibility(await window.electronAPI.requestTextAccessibility())
    } catch {
      setNotice("Could not request Accessibility access. Open Accessibility Settings and try again.")
    } finally {
      setRequestingAccess(false)
    }
  }

  const localEffective = useMemo(
    () => resolveEffectiveLocalBindings(settings?.localShortcuts.bindings ?? {}),
    [settings?.localShortcuts.bindings]
  )

  const localConflict = (target: LocalShortcutActionId, accel: string): string | null => {
    for (const [id, binding] of Object.entries(localEffective) as Array<
      [LocalShortcutActionId, Binding]
    >) {
      if (id !== target && binding && binding.toLowerCase() === accel.toLowerCase()) return id
    }
    return null
  }

  const handleGlobalCapture = async (id: ShortcutActionId, accel: string) => {
    const res = await window.electronAPI.setShortcut(id, accel)
    if (!res.ok) {
      setNotice(
        res.conflictsWith
          ? `"${accel}" already used by ${res.conflictsWith}.`
          : (res.validation?.message ?? "Could not set that shortcut.")
      )
    } else {
      setNotice(
        res.validation?.reserved ? "Saved, but this combination may be reserved by the OS." : null
      )
    }
    await load()
  }

  const handleLocalCapture = async (id: LocalShortcutActionId, accel: string) => {
    if (!settings) return
    const validation = await window.electronAPI.validateShortcut(accel)
    if (!validation.valid || !validation.normalized) {
      setNotice(validation.message ?? "Invalid shortcut.")
      return
    }
    const conflict = validation.conflictsWith
    if (conflict && conflict !== `local:${id}`) {
      setNotice(`"${validation.normalized}" already used by ${conflict}.`)
      return
    }
    const local = localConflict(id, validation.normalized)
    if (local) {
      setNotice(`"${validation.normalized}" already used by ${local}.`)
      return
    }
    await update({
      localShortcuts: {
        bindings: { ...settings.localShortcuts.bindings, [id]: validation.normalized },
      },
    })
    setNotice(validation.reserved ? "Saved, but this combination may be reserved by the OS." : null)
  }

  const setLocalBinding = async (id: LocalShortcutActionId, binding: Binding) => {
    if (!settings) return
    await update({
      localShortcuts: { bindings: { ...settings.localShortcuts.bindings, [id]: binding } },
    })
  }

  if (loadError) return <div className="inline-failure" role="alert">{loadError} <button type="button" onClick={load}>Retry</button></div>
  if (!snapshot || !settings) return <div className="text-xs text-white/60">Loading shortcuts…</div>

  const query = search.trim().toLowerCase()
  const rows = [
    ...snapshot.actions.map((action) => ({
      scope: "global" as Scope,
      id: action.id,
      label: action.label,
      description: action.description,
      category: action.category,
      binding: snapshot.effective[action.id],
      status: snapshot.status[action.id],
    })),
    ...LOCAL_SHORTCUT_ACTION_LIST.map((action) => ({
      scope: "local" as Scope,
      id: action.id,
      label: action.label,
      description: action.description,
      category: action.category,
      binding: localEffective[action.id],
      status: localEffective[action.id] ? "active" : "disabled",
    })),
  ].filter((row) => {
    const matchesCategory = category === "all" || row.category === category
    const haystack = `${row.scope} ${row.label} ${row.description} ${row.category}`.toLowerCase()
    return matchesCategory && (!query || haystack.includes(query))
  })

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-xs bg-black border border-white/30 rounded px-2 py-1 text-white"
        >
          {Object.keys(categoryLabels).map((id) => (
            <option key={id} value={id}>
              {categoryLabels[id]}
            </option>
          ))}
        </select>
        <button
          className="text-xs px-2 py-1 rounded border border-white/40 text-white"
          onClick={async () => {
            await window.electronAPI.resetAllShortcuts()
            await update({ localShortcuts: { bindings: DEFAULT_LOCAL_BINDINGS } as any })
            await load()
          }}
        >
          Reset all
        </button>
        <button
          className="text-xs px-2 py-1 rounded border border-white/40 text-white hover:bg-white/10"
          onClick={io.startExport}
        >
          Export…
        </button>
        <button
          className="text-xs px-2 py-1 rounded border border-white/40 text-white hover:bg-white/10"
          onClick={io.startImport}
        >
          Import…
        </button>
      </div>

      {accessibility?.supported && (
        <div className="rounded border border-white/20 p-2 space-y-2 text-xs">
          <div className="font-medium">Selected Text & Paste</div>
          <p className="text-white/70" role="status">
            {accessibility.error ?? (accessibility.trusted
              ? "Accessibility access is enabled. Select text in another app to analyze it, or paste your clipboard without pressing Enter."
              : "Accessibility access is required. Enable the entry requested by Notes in macOS settings, then refresh. If macOS lists mac-text-actions, enable that helper.")}
          </p>
          <p className="text-white/70">Selected text is sent to your configured AI provider. Some apps do not expose readable selections.</p>
          <div className="flex flex-wrap gap-2">
            {!accessibility.trusted && <button type="button" disabled={requestingAccess} className="rounded border border-white/30 px-2 py-1 hover:bg-white/10" onClick={requestAccessibility}>{requestingAccess ? "Requesting…" : "Enable Accessibility"}</button>}
            <button type="button" className="rounded border border-white/30 px-2 py-1 hover:bg-white/10" onClick={() => void window.electronAPI.openPrivacySettings("accessibility")}>Open Accessibility Settings</button>
            <button type="button" className="rounded border border-white/30 px-2 py-1 hover:bg-white/10" onClick={load}>Refresh Access</button>
          </div>
        </div>
      )}

      <ImportExportPanel io={io} entity="shortcuts" />

      {(notice || io.msg) && (
        <div className="text-xs text-amber-300">{io.msg ?? notice}</div>
      )}

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={`${row.scope}:${row.id}`}
            className="flex items-center justify-between gap-2 text-white"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium truncate">{row.label}</span>
                <span className="text-[9px] uppercase tracking-normal text-white/35">
                  {row.scope}
                </span>
              </div>
              <div className={`text-[10px] ${statusStyles[row.status] ?? "text-white/50"}`}>
                {statusLabel[row.status] ?? row.status}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <KeyCaptureInput
                disabled={row.status === "unsupported"}
                value={row.binding}
                onCapture={(a) =>
                  row.scope === "global"
                    ? handleGlobalCapture(row.id as ShortcutActionId, a)
                    : handleLocalCapture(row.id as LocalShortcutActionId, a)
                }
              />
              <button
                className="text-[10px] px-1.5 py-1 rounded border border-white/30 text-white/70"
                onClick={() =>
                  row.scope === "global"
                    ? window.electronAPI.setShortcut(row.id as ShortcutActionId, null).then(load)
                    : setLocalBinding(row.id as LocalShortcutActionId, null)
                }
                disabled={row.status === "unsupported"}
                title="Disable this shortcut"
              >
                Off
              </button>
              <button
                className="text-[10px] px-1.5 py-1 rounded border border-white/30 text-white/70"
                onClick={() =>
                  row.scope === "global"
                    ? window.electronAPI.resetShortcut(row.id as ShortcutActionId).then(load)
                    : setLocalBinding(
                        row.id as LocalShortcutActionId,
                        DEFAULT_LOCAL_BINDINGS[row.id as LocalShortcutActionId]
                      )
                }
                disabled={row.status === "unsupported"}
                title="Reset to default"
              >
                ↺
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-xs text-white/45">No shortcuts match your filter.</div>
        )}
      </div>

      <div className="text-[10px] text-white/40">
        Move step:&nbsp;
        <input
          type="number"
          min={1}
          max={1000}
          defaultValue={snapshot.moveStep}
          onBlur={(e) => window.electronAPI.setMoveStep(Number(e.target.value))}
          className="w-16 bg-black border border-white/30 rounded px-1 py-0.5 text-white"
        />
        &nbsp;px
      </div>
    </div>
  )
}

export default ShortcutsTab
