import React, { useState } from "react"
import { RefreshCw, ShieldCheck, Wifi } from "lucide-react"
import type { AiProviderSettings } from "../../types/settings"
import { useProviderModels } from "./useProviderModels"
import { matchesSetting } from "../../lib/modelOptions"
import ModelSlots from "./ModelSlots"
import FallbackChainEditor from "./FallbackChainEditor"
import TextField from "../ui/TextField"
import NumberField from "../ui/NumberField"

interface ProviderSectionProps {
  provider: AiProviderSettings
  activeProviderId: string
  isActive: boolean
  search?: string
  onActivate: () => void
  onUpdate: (patch: Partial<AiProviderSettings>) => void
}

const PARAMS: {
  label: string
  key: keyof AiProviderSettings
  min: number
  max: number
  step: number
  hint: string
}[] = [
  { label: "Temperature", key: "temperature", min: 0, max: 2, step: 0.1, hint: "Higher = more creative" },
  { label: "Top P", key: "topP", min: 0, max: 1, step: 0.05, hint: "Nucleus sampling cutoff" },
  { label: "Top K", key: "topK", min: 0, max: 1000, step: 1, hint: "Ollama top-K; ignored by some providers" },
  { label: "Context", key: "numCtx", min: 256, max: 1048576, step: 256, hint: "Context window size" },
  { label: "Max tokens", key: "numPredict", min: 16, max: 32768, step: 16, hint: "Cap on generated tokens" },
  { label: "Timeout (ms)", key: "timeoutMs", min: 1000, max: 3600000, step: 1000, hint: "Idle timeout per request" },
]

/** Full configuration UI for a single provider (offline Ollama or an online provider). */
const ProviderSection: React.FC<ProviderSectionProps> = ({
  provider,
  activeProviderId,
  isActive,
  search = "",
  onActivate,
  onUpdate,
}) => {
  const { models, status, error, health, secret, refresh } = useProviderModels(
    provider,
    activeProviderId
  )
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [keyMsg, setKeyMsg] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<{ kind: "ok" | "err" | "testing"; msg?: string } | null>(
    null
  )

  const pinnedEndpoint = provider.id === "openrouter"
  const loading = status === "loading"
  const params = PARAMS.filter((p) => matchesSetting(p.label, search))

  const saveKey = async () => {
    try {
      const res = await window.electronAPI.setAiProviderApiKey(provider.id, apiKeyDraft)
      setKeyMsg(res.ok ? "API key stored." : (res.error ?? "Failed to store key."))
      setApiKeyDraft("")
      await refresh()
    } catch (err: any) {
      setKeyMsg(err?.message ?? "Failed to store key.")
    }
  }

  const test = async () => {
    setTestMsg({ kind: "testing" })
    try {
      const res = await window.electronAPI.testLlmConnection(provider.id)
      setTestMsg(res.success ? { kind: "ok", msg: "Connected." } : { kind: "err", msg: res.error })
    } catch (err: any) {
      setTestMsg({ kind: "err", msg: err?.message ?? "Connection failed." })
    }
    await refresh()
  }

  const statusLine = (() => {
    if (testMsg?.kind === "testing") return { cls: "text-white/60", text: "Testing…" }
    if (testMsg?.kind === "ok") return { cls: "text-green-400", text: testMsg.msg }
    if (testMsg?.kind === "err") return { cls: "text-red-400", text: testMsg.msg }
    if (loading) return { cls: "text-white/60", text: "Discovering models…" }
    if (status === "error")
      return { cls: "text-red-400", text: error ?? "Could not reach this provider." }
    if (status === "empty")
      return {
        cls: "text-amber-300",
        text: "No models discovered. Check the endpoint/key, or type a model name.",
      }
    if (status === "ok") return { cls: "text-green-400", text: `${models.length} models` }
    if (status === "idle" && provider.enabled)
      return { cls: "text-white/50", text: "Click Discover to load models." }
    return { cls: "text-white/50", text: "" }
  })()

  return (
    <section
      className={`space-y-2 border rounded-md p-2.5 ${
        isActive ? "border-white/50" : "border-white/15"
      }`}
      aria-label={`${provider.name} settings`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{provider.name}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
              isActive ? "border-green-400 text-green-400" : "border-white/30 text-white/70"
            }`}
          >
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isActive && (
            <button
              type="button"
              onClick={onActivate}
              className="text-[10px] px-2 py-0.5 rounded border border-white/40 hover:bg-white/10"
            >
              Use this
            </button>
          )}
          <label className="flex items-center gap-1 text-[10px] text-white/60">
            Enabled
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
              className="accent-white"
            />
          </label>
        </div>
      </div>

      <TextField
        label="Endpoint"
        value={provider.endpoint}
        onCommit={(v) => onUpdate({ endpoint: v })}
        mono
        readOnly={pinnedEndpoint}
        hint={
          pinnedEndpoint
            ? "OpenRouter endpoint is fixed for security."
            : provider.type === "ollama"
              ? "Loopback/private hosts only."
              : "OpenAI-compatible base URL."
        }
      />

      {provider.type === "openai-compatible" && (
        <div className="space-y-2 border border-white/10 rounded-md p-2">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Require API key</span>
            <input
              type="checkbox"
              checked={provider.apiKeyRequired}
              onChange={(e) => onUpdate({ apiKeyRequired: e.target.checked })}
              className="accent-white"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Allow remote HTTPS</span>
            <input
              type="checkbox"
              checked={provider.allowRemote}
              onChange={(e) => onUpdate({ allowRemote: e.target.checked })}
              className="accent-white"
            />
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              aria-label={`${provider.name} API key`}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={secret?.hasApiKey ? "API key stored" : "API key"}
              className="flex-1 bg-black border border-white/30 rounded px-1.5 py-1 text-xs"
            />
            <button className="text-xs px-2 py-1 rounded border border-white/40" onClick={saveKey}>
              Save
            </button>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-white/70">
            <ShieldCheck className="w-3 h-3" />
            {secret?.secureStorageAvailable
              ? secret.hasApiKey
                ? "Stored in OS secure storage"
                : "OS secure storage available"
              : "Secure storage unavailable"}
          </div>
          {keyMsg && <div className="text-[10px] text-amber-300">{keyMsg}</div>}
        </div>
      )}

      <ModelSlots
        models={models}
        lowModel={provider.lowModel}
        highModel={provider.highModel}
        visionModel={provider.visionModel}
        loading={loading}
        onChange={onUpdate}
      />

      <FallbackChainEditor
        models={models}
        chain={provider.fallbackModels}
        loading={loading}
        onChange={(chain) => onUpdate({ fallbackModels: chain })}
      />

      {params.length > 0 && (
        <div className="space-y-1.5">
          {params.map((p) => (
            <NumberField
              key={String(p.key)}
              label={p.label}
              value={provider[p.key] as number}
              min={p.min}
              max={p.max}
              step={p.step}
              hint={p.hint}
              onCommit={(n) => onUpdate({ [p.key]: n } as Partial<AiProviderSettings>)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          className="text-xs px-2 py-1 rounded border border-white/40"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className={`inline w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          {status === "idle" ? "Discover" : "Refresh"}
        </button>
        <button className="text-xs px-2 py-1 rounded border border-white/40" onClick={test}>
          <Wifi className="inline w-3 h-3 mr-1" />
          Test
        </button>
        <span className={`text-xs ${statusLine.cls}`} role="status" aria-live="polite">
          {statusLine.text}
          {health?.latencyMs != null && status === "ok" ? ` · ${health.latencyMs}ms` : ""}
        </span>
      </div>
    </section>
  )
}

export default ProviderSection
