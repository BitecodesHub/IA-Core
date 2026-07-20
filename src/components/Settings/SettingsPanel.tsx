import React, { useState } from "react"
import { Download, RotateCcw, Search, Upload } from "lucide-react"
import GeneralTab from "./GeneralTab"
import ModelsTab from "./ModelsTab"
import ShortcutsTab from "./ShortcutsTab"
import WindowTab from "./WindowTab"
import PrivacyTab from "./PrivacyTab"
import DiagnosticsTab from "./DiagnosticsTab"
import { useImportExport } from "./useImportExport"
import ImportExportPanel from "./ImportExportPanel"

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
  const io = useImportExport(
    () => window.electronAPI.exportSettings(),
    (data) => window.electronAPI.importSettings(data)
  )

  const resetAll = async () => {
    // Stealth: no native confirm dialog (it renders outside the content-protected
    // overlay). Use an inline two-click confirm instead.
    if (!armReset) {
      setArmReset(true)
      setNotice("Click restore again to confirm.")
      return
    }
    setArmReset(false)
    await window.electronAPI.resetSettings()
    setNotice("Defaults restored.")
  }

  return (
    <div className="bg-black border-2 border-white rounded-lg p-4 text-white">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/45" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings"
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
          className="p-1.5 border border-white/30 rounded hover:bg-white/10"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      <ImportExportPanel io={io} entity="settings" />
      {(notice || io.msg) && (
        <div className="mb-2 text-[11px] text-amber-300">{io.msg ?? notice}</div>
      )}
      <div className="flex gap-1 mb-3 border-b border-white/20 pb-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
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
      <div className="max-h-72 overflow-y-auto pr-1">
        {tab === "general" && <GeneralTab search={search} />}
        {tab === "ai" && <ModelsTab search={search} />}
        {tab === "shortcuts" && <ShortcutsTab search={search} />}
        {tab === "window" && <WindowTab />}
        {tab === "privacy" && <PrivacyTab search={search} />}
        {tab === "diagnostics" && <DiagnosticsTab />}
      </div>
    </div>
  )
}

export default SettingsPanel
