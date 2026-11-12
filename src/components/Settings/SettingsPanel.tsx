import React, { useId, useRef, useState } from "react"
import { Download, RotateCcw, Search, Upload } from "lucide-react"
import GeneralTab from "./GeneralTab"
import ModelsTab from "./ModelsTab"
import ShortcutsTab from "./ShortcutsTab"
import WindowTab from "./WindowTab"
import PrivacyTab from "./PrivacyTab"
import DiagnosticsTab from "./DiagnosticsTab"
import { useImportExport } from "./useImportExport"
import ImportExportPanel from "./ImportExportPanel"
import { SettingsContext, useSettings, useSettingsPersistence } from "./useSettings"

type Tab = "general" | "ai" | "shortcuts" | "window" | "privacy" | "diagnostics"

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "window", label: "Window" },
  { id: "privacy", label: "Privacy" },
  { id: "diagnostics", label: "Diagnostics" },
]

const SettingsPanel: React.FC = () => {
  // The overlay's capsule button is labelled "Models", so open the AI/Models tab.
  const [tab, setTab] = useState<Tab>("ai")
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [armReset, setArmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const resetInFlight = useRef(false)
  const tabsRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const state = useSettings()
  const persistence = useSettingsPersistence()
  const io = useImportExport(
    () => window.electronAPI.exportSettings(),
    (data) => window.electronAPI.importSettings(data)
  )

  const resetAll = async () => {
    if (resetInFlight.current) return
    // Stealth: no native confirm dialog (it renders outside the content-protected
    // overlay). Use an inline two-click confirm instead.
    if (!armReset) {
      setArmReset(true)
      setNotice("Click restore again to confirm.")
      return
    }
    setArmReset(false)
    resetInFlight.current = true
    setResetting(true)
    setNotice(null)
    try {
      await window.electronAPI.resetSettings()
      setNotice("Defaults applied. Disk save status is shown below.")
    } catch {
      setNotice("Could not restore defaults. Try again.")
    } finally {
      resetInFlight.current = false
      setResetting(false)
    }
  }

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === tab)
    let next: number
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length
    else if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = TABS.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    setTab(TABS[next].id)
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <SettingsContext.Provider value={state}>
    <div className="bg-black border-2 border-white rounded-lg p-4 text-white">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/45" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="w-full bg-black border border-white/25 rounded pl-7 pr-2 py-1 text-xs"
          />
        </div>
        <button
          title="Import settings"
          aria-label="Import settings"
          onClick={io.startImport}
          className="p-1.5 border border-white/30 rounded hover:bg-white/10"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        <button
          title="Export settings"
          aria-label="Export settings"
          onClick={io.startExport}
          className="p-1.5 border border-white/30 rounded hover:bg-white/10"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          title="Restore defaults"
          aria-label="Restore defaults"
          onClick={resetAll}
          disabled={resetting}
          className="p-1.5 border border-white/30 rounded hover:bg-white/10"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      <ImportExportPanel io={io} entity="settings" />
      {notice && <div role="status" className="mb-2 text-[11px] text-amber-300">{notice}</div>}
      {io.msg && <div role="status" className="mb-2 text-[11px] text-amber-300">{io.msg}</div>}
      {state.error && (
        <div role="alert" className="mb-2 text-[11px] text-amber-300">
          {state.error}
          {!state.settings && <button className="ml-2 underline" onClick={state.reload}>Retry loading</button>}
        </div>
      )}
      <div role="status" className="mb-2 text-[11px] text-white/60">
        {persistence.error ?? (
          persistence.persistence?.state === "failed"
            ? persistence.persistence.error ?? "Settings are applied but not saved to disk."
            : persistence.persistence?.state === "pending"
              ? "Changes applied. Saving to disk…"
              : persistence.persistence?.state === "saved"
                ? "Settings saved to disk."
                : "Checking disk save status…"
        )}
        {(persistence.error || persistence.persistence?.state === "failed") && (
          <button className="ml-2 underline" onClick={persistence.retry} disabled={persistence.retrying}>
            {persistence.retrying ? "Retrying…" : "Retry saving"}
          </button>
        )}
      </div>
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={onTabKeyDown}
        className="flex gap-1 mb-3 border-b border-white/20 pb-2 overflow-x-auto"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${panelId}-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${panelId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1 rounded-t transition-colors ${
              tab === t.id
                ? "text-white border-b-2 border-white font-medium"
                : "text-white/50 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`${panelId}-panel`}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${tab}`}
        tabIndex={0}
        className="max-h-72 overflow-y-auto pr-1"
      >
        {state.loading && !state.settings && <div className="text-xs text-white/60">Loading…</div>}
        {state.settings && <>
          {tab === "general" && <GeneralTab search={search} />}
          {tab === "ai" && <ModelsTab search={search} />}
          {tab === "shortcuts" && <ShortcutsTab search={search} />}
          {tab === "window" && <WindowTab />}
          {tab === "privacy" && <PrivacyTab search={search} />}
          {tab === "diagnostics" && <DiagnosticsTab />}
        </>}
      </div>
    </div>
    </SettingsContext.Provider>
  )
}

export default SettingsPanel
