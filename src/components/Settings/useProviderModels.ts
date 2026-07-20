import { useCallback, useEffect, useRef, useState } from "react"
import { shouldAutoHealthCheck } from "../../../electron/llm/mode"
import type { ModelInfo, ProviderHealth } from "../../../electron/llm/providers"

export type DiscoveryStatus = "idle" | "loading" | "ok" | "empty" | "error"

interface SecretStatus {
  hasApiKey: boolean
  secureStorageAvailable: boolean
}

interface ProviderLike {
  id: string
  allowRemote: boolean
  enabled: boolean
}

/**
 * Discover a provider's models + health + secret status, exposing a precise
 * status (`loading` / `ok` / `empty` / `error`) so the UI can distinguish a real
 * failure from an empty catalog. A request token discards stale responses when
 * the user switches providers quickly. Auto-discovery is gated by
 * `shouldAutoHealthCheck`, so an inactive REMOTE provider is never auto-contacted
 * (preserving the offline/local-only guarantee); such a provider stays `idle`
 * until the user clicks refresh().
 */
export function useProviderModels(provider: ProviderLike | undefined, activeProviderId: string) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<DiscoveryStatus>("idle")
  const [error, setError] = useState<string | undefined>(undefined)
  const [health, setHealth] = useState<ProviderHealth | null>(null)
  const [secret, setSecret] = useState<SecretStatus | null>(null)
  const tokenRef = useRef(0)

  const providerId = provider?.id

  const load = useCallback(async () => {
    if (!providerId) return
    const token = ++tokenRef.current
    setStatus("loading")
    setError(undefined)
    try {
      const [discovery, h, s] = await Promise.all([
        window.electronAPI.getAiProviderModels(providerId),
        window.electronAPI.getAiProviderHealth(providerId),
        window.electronAPI.getAiProviderSecretStatus(providerId),
      ])
      if (token !== tokenRef.current) return // superseded by a newer request
      setHealth(h)
      setSecret(s)
      if (!discovery.ok) {
        setModels([])
        setError(discovery.error)
        setStatus("error")
      } else {
        setModels(discovery.models)
        setStatus(discovery.models.length ? "ok" : "empty")
      }
    } catch (err: any) {
      if (token !== tokenRef.current) return
      setError(err?.message ?? "Failed to load models.")
      setStatus("error")
    }
  }, [providerId])

  useEffect(() => {
    if (!provider || !provider.enabled) {
      // A newer effect run must invalidate any in-flight request.
      tokenRef.current++
      setStatus("idle")
      setModels([])
      return
    }
    if (shouldAutoHealthCheck({ id: provider.id, allowRemote: provider.allowRemote }, activeProviderId)) {
      void load()
    } else {
      tokenRef.current++
      setStatus("idle")
      setModels([])
    }
  }, [provider, provider?.id, provider?.enabled, provider?.allowRemote, activeProviderId, load])

  return { models, status, error, health, secret, refresh: load }
}
