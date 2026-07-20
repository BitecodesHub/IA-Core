import { useCallback, useEffect, useState } from "react"
import type { AppSettings } from "../../types/settings"

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Load settings, stay in sync with main-process changes, and update them. */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    let active = true
    window.electronAPI.getSettings().then((s) => active && setSettings(s))
    const off = window.electronAPI.onSettingsChanged((s) => setSettings(s))
    return () => {
      active = false
      off()
    }
  }, [])

  const update = useCallback(async (patch: DeepPartial<AppSettings>) => {
    try {
      const next = await window.electronAPI.setSettings(patch)
      setSettings(next)
    } catch (err) {
      // Keep the prior state rather than crashing the panel on an IPC failure.
      // (Stealth: no user-facing dialog; log only in development.)
      if (import.meta.env?.DEV) console.error("[useSettings] update failed:", err)
    }
  }, [])

  return { settings, update }
}
