import React, { useCallback, useEffect, useState } from "react"
import { Activity, RefreshCw } from "lucide-react"
import { useSettings } from "./useSettings"
import type { ProviderHealth } from "../../../electron/llm/providers"

const DiagnosticsTab: React.FC = () => {
  const { settings } = useSettings()
  const [health, setHealth] = useState<ProviderHealth[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setHealth(await window.electronAPI.getAiProvidersHealth())
    } catch (err: any) {
      setError(err?.message ?? "Failed to load diagnostics.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!settings) return <div className="text-xs text-white/60">Loading…</div>

  return (
    <div className="space-y-3 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <Activity className="w-3.5 h-3.5" />
          Provider health
        </div>
        <button
          title="Refresh diagnostics"
          className="p-1.5 border border-white/30 rounded"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="text-xs text-red-400" role="alert">{error}</div>}

      <div className="space-y-1.5">
        {health.map((h) => {
          const provider = settings.ai.providers[h.providerId]
          return (
            <div key={h.providerId} className="border border-white/10 rounded p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{provider?.name ?? h.providerId}</span>
                <span className={h.ok ? "text-green-400" : "text-amber-300"}>
                  {h.ok ? "Healthy" : "Needs attention"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-white/70">
                {h.ok
                  ? `${h.modelCount ?? 0} models${h.latencyMs ? `, ${h.latencyMs}ms` : ""}`
                  : h.error}
              </div>
            </div>
          )
        })}
        {health.length === 0 && (
          <div className="text-xs text-white/50">No provider diagnostics yet.</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-white/70">
        <div>Settings version: {settings.version}</div>
        <div>Theme: {settings.general.theme}</div>
        <div>Active provider: {settings.ai.activeProviderId}</div>
        <div>Retries: {settings.ai.requestRetries}</div>
      </div>
    </div>
  )
}

export default DiagnosticsTab
