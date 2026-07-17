import React from "react"
import { useSettings } from "./useSettings"

const WindowTab: React.FC = () => {
  const { settings, update } = useSettings()
  if (!settings) return <div className="text-xs text-white/60">Loading…</div>
  const w = settings.window

  const toggle = (label: string, key: keyof typeof w, hint?: string) => (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-white/70">
        {label}
        {hint && <span className="block text-[10px] text-white/40">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={Boolean(w[key])}
        onChange={(e) => update({ window: { [key]: e.target.checked } as any })}
        className="accent-white"
      />
    </label>
  )

  return (
    <div className="space-y-2.5 text-white">
      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/70">Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          defaultValue={w.opacity}
          onChange={(e) => update({ window: { opacity: Number(e.target.value) } })}
          className="w-40 accent-white"
        />
      </label>
      {toggle("Always on top", "alwaysOnTop")}
      {toggle(
        "Content protection",
        "contentProtection",
        "Excludes the window from screen shares & recordings"
      )}
      {toggle("Hide from taskbar", "skipTaskbar")}
      {toggle("Hide from Mission Control (macOS)", "hiddenInMissionControl")}
      {toggle("Show tray icon", "trayEnabled", "Off = no menu-bar/tray footprint")}
      <div className="text-[10px] text-white/40 pt-1">
        Stealth limits: the process is still visible in Activity Monitor / Task Manager, and some
        OS-level region screenshots cannot be excluded.
      </div>
    </div>
  )
}

export default WindowTab
