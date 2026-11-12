import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { AppSettings } from "../../types/settings"
import type { SettingsPersistenceStatus } from "../../../electron/config/SettingsService"

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  error: string | null
  reload: () => void
  update: (patch: DeepPartial<AppSettings>) => Promise<boolean>
}

// The panel shares its existing hook with its tabs so load/save errors have one
// inline home. Tabs rendered on their own retain the same standalone behavior.
export const SettingsContext = createContext<SettingsState | null>(null)

/** Load settings, stay in sync with main-process changes, and update them. */
export function useSettings(): SettingsState {
  const shared = useContext(SettingsContext)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadId, setReloadId] = useState(0)
  const mounted = useRef(false)
  const revision = useRef(0)
  const updateId = useRef(0)

  useEffect(() => {
    if (shared) return
    let active = true
    mounted.current = true
    setLoading(true)
    setError(null)
    const startRevision = revision.current
    const off = window.electronAPI.onSettingsChanged((s) => {
      if (!active) return
      revision.current++
      setSettings(s)
      setLoading(false)
    })
    // Subscribe before requesting the snapshot; a late snapshot must not undo
    // an in-flight settings change broadcast.
    void (async () => {
      try {
        const s = await window.electronAPI.getSettings()
        if (active && revision.current === startRevision) setSettings(s)
      } catch {
        if (active && revision.current === startRevision) setError("Could not load settings. Try again.")
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
      mounted.current = false
      updateId.current++
      off()
    }
  }, [shared, reloadId])

  const reload = useCallback(() => setReloadId((id) => id + 1), [])
  const update = useCallback(async (patch: DeepPartial<AppSettings>) => {
    const id = ++updateId.current
    const startRevision = revision.current
    setError(null)
    try {
      const next = await window.electronAPI.setSettings(patch)
      if (mounted.current && id === updateId.current && revision.current === startRevision) {
        setSettings(next)
        revision.current++
      }
      return true
    } catch {
      if (mounted.current && id === updateId.current) {
        setError("Could not apply settings. Try the edit again.")
      }
      return false
    }
  }, [])

  return shared ?? { settings, loading, error, reload, update }
}

/** Persistence is deliberately separate from successful in-memory application. */
export function useSettingsPersistence() {
  const [persistence, setPersistence] = useState<SettingsPersistenceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const mounted = useRef(false)
  const revision = useRef(0)
  const retryInFlight = useRef(false)

  useEffect(() => {
    let active = true
    mounted.current = true
    const startRevision = revision.current
    const off = window.electronAPI.onSettingsPersistenceChanged((status) => {
      if (!active) return
      revision.current++
      setPersistence(status)
      setError(null)
    })
    void (async () => {
      try {
        const status = await window.electronAPI.getSettingsPersistenceStatus()
        if (active && revision.current === startRevision) setPersistence(status)
      } catch {
        if (active && revision.current === startRevision) setError("Could not check whether settings are saved.")
      }
    })()
    return () => {
      active = false
      mounted.current = false
      off()
    }
  }, [])

  const retry = useCallback(async () => {
    if (retryInFlight.current) return
    retryInFlight.current = true
    setRetrying(true)
    setError(null)
    const startRevision = revision.current
    try {
      const status = await window.electronAPI.retrySettingsPersistence()
      if (mounted.current && revision.current === startRevision) setPersistence(status)
    } catch {
      if (mounted.current) setError("Could not retry saving settings. Try again.")
    } finally {
      retryInFlight.current = false
      if (mounted.current) setRetrying(false)
    }
  }, [])

  return { persistence, error, retrying, retry }
}
