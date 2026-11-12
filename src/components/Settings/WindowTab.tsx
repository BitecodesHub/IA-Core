import React from "react"
import { useSettings } from "./useSettings"
import { SHORTCUT_ACTION_LIST } from "../../../electron/shortcuts/actions"

const WindowTab: React.FC = () => {
  const { settings, update } = useSettings()
  if (!settings) return <div className="text-xs text-white/60">Loading…</div>
  const w = settings.window

  const applyVisibleAppSettings = () =>
    update({
      window: {
        opacity: 1,
        alwaysOnTop: false,
        contentProtection: false,
        skipTaskbar: false,
        hiddenInMissionControl: false,
        trayEnabled: false,
      },
      general: { startMinimized: false },
      shortcuts: {
        bindings: Object.fromEntries(SHORTCUT_ACTION_LIST.map(({ id }) => [id, null])),
      },
    })

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
          value={w.opacity}
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
      {toggle("Hide from Dock / taskbar", "skipTaskbar")}
      {toggle("Hide from Mission Control (macOS)", "hiddenInMissionControl")}
      {toggle("Show tray icon", "trayEnabled", "Off = no menu-bar/tray footprint")}
      <div className="text-[10px] text-white/40 pt-1">
        Stealth limits: the process is still visible in Activity Monitor / Task Manager, and some
        OS-level region screenshots cannot be excluded.
      </div>
      <div className="space-y-2 border-t border-white/15 pt-2.5">
        <button
          type="button"
          onClick={() => void applyVisibleAppSettings()}
          className="rounded-md border border-white/30 px-2.5 py-1.5 text-xs text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          Use visible app settings
        </button>
        <p className="text-[11px] leading-relaxed text-white/65">
          Shows Notes in the Dock / taskbar. Turns off screen-share exclusion, always-on-top,
          floating answer hints, hidden startup, and global shortcuts. In-window controls stay available.
        </p>
        <p className="text-[11px] leading-relaxed text-white/65">
          Safe Exam Browser must explicitly permit Notes in the exam administrator’s configuration.
          This preset does not bypass exam restrictions or grant screen-capture or network access.
        </p>
      </div>
    </div>
  )
}

export default WindowTab
