import React, { useEffect, useState, useCallback } from "react"
import { RefreshCw, ShieldCheck, Wifi } from "lucide-react"
import { useSettings } from "./useSettings"
import type { AiProviderSettings, ReasoningMode } from "../../types/settings"
import type { ModelInfo, ProviderHealth } from "../../../electron/llm/providers"

const modes: { id: ReasoningMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Pick Low or High per task automatically" },
  { id: "low", label: "Low", hint: "Always use the fast model" },
  { id: "high", label: "High", hint: "Always use the strong model" },
]

const ModelsTab: React.FC<{ search?: string }> = () => {
  const { settings, update } = useSettings()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [health, setHealth] = useState<ProviderHealth | null>(null)
  const [status, setStatus] = useState<{ kind: "idle" | "testing" | "ok" | "err"; msg?: string }>({
    kind: "idle",
  })
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [secretStatus, setSecretStatus] = useState<{
    hasApiKey: boolean
    secureStorageAvailable: boolean
  } | null>(null)

  const activeId = settings?.ai.activeProviderId ?? "ollama"
  const provider = settings?.ai.providers[activeId]

  const refreshModels = useCallback(async () => {
    if (!provider) return
    setLoadingModels(true)
    try {
      const [detailed, h, secret] = await Promise.all([
        window.electronAPI.getAiProviderModels(provider.id),
        window.electronAPI.getAiProviderHealth(provider.id),
        window.electronAPI.getAiProviderSecretStatus(provider.id),
      ])
      setModels(detailed)
      setHealth(h)
      setSecretStatus(secret)
    } finally {
      setLoadingModels(false)
    }
  }, [provider?.id])

  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  if (!settings || !provider) return <div className="text-xs text-white/60">Loading…</div>

  const updateProvider = (patch: Partial<AiProviderSettings>) => {
    const legacy =
      provider.id === "ollama"
        ? {
            endpoint: patch.endpoint,
            lowModel: patch.lowModel,
            highModel: patch.highModel,
            visionModel: patch.visionModel,
            temperature: patch.temperature,
            topP: patch.topP,
            topK: patch.topK,
            numCtx: patch.numCtx,
            numPredict: patch.numPredict,
            timeoutMs: patch.timeoutMs,
            keepAlive: patch.keepAlive,
          }
        : undefined
    update({
      ai: { providers: { [provider.id]: patch } },
      ...(provider.id === "ollama" ? { ollama: legacy } : {}),
    } as any)
  }

  const modelSelect = (
    value: string,
    onChange: (v: string) => void,
    opts?: { placeholder?: string; visionOnly?: boolean }
  ) => {
    const list = opts?.visionOnly ? models.filter((m) => m.vision) : models
    const missing = !!value && !models.some((m) => m.name === value)
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-48 bg-black border rounded px-1.5 py-0.5 text-white ${
          missing ? "border-amber-400" : "border-white/30"
        }`}
        title={
          missing
            ? `${value} was not discovered. It may still work if the provider supports it.`
            : undefined
        }
      >
        <option value="">{opts?.placeholder ?? "(auto)"}</option>
        {missing && <option value={value}>{value} (configured)</option>}
        {list.map((m) => (
          <option key={`${m.providerId}:${m.name}`} value={m.name}>
            {m.name}
            {m.vision ? "  vision" : ""}
          </option>
        ))}
      </select>
    )
  }

  const num = (
    label: string,
    key: keyof AiProviderSettings,
    min: number,
    max: number,
    step: number,
    hint: string
  ) => (
    <label className="flex items-center justify-between gap-2 text-xs" title={hint}>
      <span className="text-white/70">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={provider[key] as number}
        onBlur={(e) =>
          updateProvider({ [key]: Number(e.target.value) } as Partial<AiProviderSettings>)
        }
        className="w-24 bg-black border border-white/30 rounded px-1.5 py-0.5 text-white"
      />
    </label>
  )

  const test = async () => {
    setStatus({ kind: "testing" })
    const res = await window.electronAPI.testLlmConnection(provider.id)
    setStatus(res.success ? { kind: "ok" } : { kind: "err", msg: res.error })
    await refreshModels()
  }

  const saveKey = async () => {
    const res = await window.electronAPI.setAiProviderApiKey(provider.id, apiKeyDraft)
    setStatus(res.ok ? { kind: "ok", msg: "API key saved" } : { kind: "err", msg: res.error })
    setApiKeyDraft("")
    await refreshModels()
  }

  return (
    <div className="space-y-3 text-white">
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <select
          value={provider.id}
          onChange={(e) => update({ ai: { activeProviderId: e.target.value } })}
          className="bg-black border border-white/30 rounded px-2 py-1 text-xs"
        >
          {Object.values(settings.ai.providers).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-white/60">
          Enabled
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) => updateProvider({ enabled: e.target.checked })}
            className="accent-white"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-white/70">Endpoint</span>
        <input
          type="text"
          defaultValue={provider.endpoint}
          onBlur={(e) => updateProvider({ endpoint: e.target.value })}
          className="bg-black border border-white/30 rounded px-1.5 py-1 text-white font-mono"
          title={
            provider.type === "ollama"
              ? "Ollama endpoints are restricted to loopback/private hosts."
              : "OpenAI-compatible base URL, for example http://localhost:1234/v1."
          }
        />
      </label>

      {provider.type === "openai-compatible" && (
        <div className="space-y-2 border border-white/10 rounded-md p-2">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Require API key</span>
            <input
              type="checkbox"
              checked={provider.apiKeyRequired}
              onChange={(e) => updateProvider({ apiKeyRequired: e.target.checked })}
              className="accent-white"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Allow remote HTTPS</span>
            <input
              type="checkbox"
              checked={provider.allowRemote}
              onChange={(e) => updateProvider({ allowRemote: e.target.checked })}
              className="accent-white"
            />
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={secretStatus?.hasApiKey ? "API key stored" : "API key"}
              className="flex-1 bg-black border border-white/30 rounded px-1.5 py-1 text-xs"
            />
            <button className="text-xs px-2 py-1 rounded border border-white/40" onClick={saveKey}>
              Save
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-white/45">
            <ShieldCheck className="w-3 h-3" />
            {secretStatus?.secureStorageAvailable
              ? secretStatus.hasApiKey
                ? "Stored in OS secure storage"
                : "OS secure storage available"
              : "Secure storage unavailable"}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/70">Reasoning mode</span>
        <div className="flex rounded border border-white/30 overflow-hidden">
          {modes.map((m) => (
            <button
              key={m.id}
              title={m.hint}
              onClick={() => update({ ai: { reasoningMode: m.id } })}
              className={`px-2.5 py-0.5 transition-colors ${
                settings.ai.reasoningMode === m.id
                  ? "bg-white text-black"
                  : "text-white/80 hover:bg-white/10"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border border-white/10 rounded-md p-2">
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-white/70">Low reasoning model</span>
          {modelSelect(provider.lowModel, (v) => updateProvider({ lowModel: v }), {
            placeholder: "(auto-detect)",
          })}
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-white/70">High reasoning model</span>
          {modelSelect(provider.highModel, (v) => updateProvider({ highModel: v }), {
            placeholder: "(use Low)",
          })}
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-white/70">Vision model</span>
          {modelSelect(provider.visionModel, (v) => updateProvider({ visionModel: v }), {
            placeholder: "(auto-detect)",
            visionOnly: true,
          })}
        </label>
      </div>

      <div className="space-y-1.5">
        {num(
          "Temperature",
          "temperature",
          0,
          2,
          0.1,
          "Higher = more creative, lower = more deterministic"
        )}
        {num("Top P", "topP", 0, 1, 0.05, "Nucleus sampling cutoff")}
        {num("Top K", "topK", 0, 1000, 1, "Ollama top-K sampling; ignored by some providers")}
        {num("Context", "numCtx", 256, 1048576, 256, "Context window; larger uses more memory")}
        {num("Max tokens", "numPredict", 16, 32768, 16, "Cap on generated tokens per response")}
        {num("Timeout (ms)", "timeoutMs", 1000, 3600000, 1000, "Abort slow or stuck requests")}
      </div>

      <div className="space-y-1.5 border border-white/10 rounded-md p-2">
        <div className="text-xs text-white/70">Fallback providers</div>
        {Object.values(settings.ai.providers)
          .filter((p) => p.id !== provider.id)
          .map((p) => (
            <label key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-white/60">{p.name}</span>
              <input
                type="checkbox"
                checked={settings.ai.fallbackProviderIds.includes(p.id)}
                onChange={(e) => {
                  const current = settings.ai.fallbackProviderIds.filter((id) => id !== p.id)
                  update({
                    ai: { fallbackProviderIds: e.target.checked ? [...current, p.id] : current },
                  })
                }}
                className="accent-white"
              />
            </label>
          ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          className="text-xs px-2 py-1 rounded border border-white/40"
          onClick={refreshModels}
          disabled={loadingModels}
        >
          <RefreshCw className={`inline w-3 h-3 mr-1 ${loadingModels ? "animate-spin" : ""}`} />
          Models
        </button>
        <button className="text-xs px-2 py-1 rounded border border-white/40" onClick={test}>
          <Wifi className="inline w-3 h-3 mr-1" />
          Test
        </button>
        <span
          className={`text-xs ${
            status.kind === "ok" || health?.ok
              ? "text-green-400"
              : status.kind === "err" || health?.ok === false
                ? "text-red-400"
                : "text-white/60"
          }`}
        >
          {status.kind === "testing"
            ? "Testing…"
            : status.msg
              ? status.msg
              : health?.ok
                ? `${models.length} models`
                : (health?.error ?? "")}
        </span>
      </div>

      {!loadingModels && provider.enabled && models.length === 0 && (
        <div className="text-[10px] text-amber-300">
          No models discovered. Check the endpoint, start the provider, or enter a model manually.
        </div>
      )}
    </div>
  )
}

export default ModelsTab
