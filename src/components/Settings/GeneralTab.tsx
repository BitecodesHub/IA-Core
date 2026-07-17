import React from "react"
import { useSettings } from "./useSettings"

const GeneralTab: React.FC<{ search?: string }> = () => {
  const { settings, update } = useSettings()
  if (!settings) return <div className="text-xs text-white/60">Loading…</div>
  const g = settings.general

  return (
    <div className="space-y-3 text-white">
      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-white/70">Theme</span>
        <select
          value={g.theme}
          onChange={(e) => update({ general: { theme: e.target.value as typeof g.theme } })}
          className="w-36 bg-black border border-white/30 rounded px-2 py-1"
        >
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>

      <label
        className="flex items-center justify-between gap-3 text-xs"
        title="Keep the overlay hidden at launch."
      >
        <span className="text-white/70">Start minimized</span>
        <input
          type="checkbox"
          checked={g.startMinimized}
          onChange={(e) => update({ general: { startMinimized: e.target.checked } })}
          className="accent-white"
        />
      </label>

      <label
        className="flex items-center justify-between gap-3 text-xs"
        title="Preloads the fast local model on launch. Disable on memory-constrained machines."
      >
        <span className="text-white/70">Warm low model on start</span>
        <input
          type="checkbox"
          checked={g.warmModelOnStart}
          onChange={(e) => update({ general: { warmModelOnStart: e.target.checked } })}
          className="accent-white"
        />
      </label>
    </div>
  )
}

export default GeneralTab
