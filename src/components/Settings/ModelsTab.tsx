import React, { useEffect, useRef, useState } from "react"
import { useSettings } from "./useSettings"
import type { AiProviderSettings, ReasoningMode } from "../../types/settings"
import { modeForProviderId, type AiMode } from "../../../electron/llm/mode"
import ProviderSection from "./ProviderSection"

const REASONING: { id: ReasoningMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Pick Low or High per task automatically" },
  { id: "low", label: "Low", hint: "Always use the fast model" },
  { id: "high", label: "High", hint: "Always use the strong model" },
]

/** Accessible segmented radio group (role=radiogroup / radio) with roving tabindex
 *  and arrow-key navigation per WAI-ARIA. */
function RadioSegments<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (dir: 1 | -1) => {
    const idx = options.findIndex((o) => o.id === value)
    const next = options[(idx + dir + options.length) % options.length]
    if (!next) return
    onChange(next.id)
    const btns = ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    btns?.[(idx + dir + options.length) % options.length]?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      move(1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      move(-1)
    }
  }
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex rounded-md border border-white/20 overflow-hidden"
    >
      {options.map((o) => {
        const checked = o.id === value
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.id)}
            className={`px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${
              checked ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const ModelsTab: React.FC<{ search?: string }> = ({ search = "" }) => {
  const { settings, update } = useSettings()
  const activeId = settings?.ai.activeProviderId ?? "ollama"
  const [onlineSel, setOnlineSel] = useState(activeId !== "ollama" ? activeId : "openrouter")

  // Track the active online provider so the online section reflects reality.
  useEffect(() => {
    if (activeId !== "ollama" && activeId !== onlineSel) setOnlineSel(activeId)
  }, [activeId, onlineSel])

  if (!settings) return <div className="text-xs text-white/60">Loading…</div>

  const providers = settings.ai.providers
  const ollama = providers.ollama
  const onlineProvider = providers[onlineSel] ?? providers.openrouter
  const onlineProviders = Object.values(providers).filter((p) => p.type !== "ollama")
  const mode: AiMode = modeForProviderId(activeId)

  const updateProvider = (id: string, patch: Partial<AiProviderSettings>) => {
    const legacy =
      id === "ollama"
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
      ai: { providers: { [id]: patch } },
      ...(id === "ollama" ? { ollama: legacy } : {}),
    } as Parameters<typeof update>[0])
  }

  const activate = (id: string) =>
    update({ ai: { activeProviderId: id, providers: { [id]: { enabled: true } } } })

  const setMode = (m: AiMode) => activate(m === "offline" ? "ollama" : onlineSel)

  const pickOnline = (id: string) => {
    setOnlineSel(id)
    if (mode === "online") activate(id)
  }

  return (
    <div className="space-y-3 text-white">
      {/* Global controls */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/70">Reasoning mode</span>
        <RadioSegments
          label="Reasoning mode"
          value={settings.ai.reasoningMode}
          options={REASONING}
          onChange={(m) => update({ ai: { reasoningMode: m } })}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/70">Mode</span>
        <RadioSegments<AiMode>
          label="Offline or online mode"
          value={mode}
          options={[
            { id: "offline", label: "Offline (Ollama)", hint: "Local, private" },
            { id: "online", label: "Online", hint: "Remote provider (needs an API key)" },
          ]}
          onChange={setMode}
        />
      </div>

      {/* Offline section */}
      {ollama && (
        <ProviderSection
          provider={ollama}
          activeProviderId={activeId}
          isActive={activeId === "ollama"}
          search={search}
          onActivate={() => activate("ollama")}
          onUpdate={(p) => updateProvider("ollama", p)}
        />
      )}

      {/* Online section */}
      <div className="space-y-2">
        {onlineProviders.length > 1 && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-white/70">Online provider</span>
            <RadioSegments
              label="Online provider"
              value={onlineSel}
              options={onlineProviders.map((p) => ({ id: p.id, label: p.name }))}
              onChange={pickOnline}
            />
          </div>
        )}
        {onlineProvider && (
          <ProviderSection
            provider={onlineProvider}
            activeProviderId={activeId}
            isActive={activeId === onlineProvider.id}
            search={search}
            onActivate={() => activate(onlineProvider.id)}
            onUpdate={(p) => updateProvider(onlineProvider.id, p)}
          />
        )}
      </div>

      {/* Advanced: provider-level fallback order (distinct from per-provider fallback models) */}
      <details className="border border-white/10 rounded-md p-2">
        <summary className="text-xs text-white/70 cursor-pointer">Advanced</summary>
        <div className="mt-2 space-y-1.5">
          <div className="text-[11px] text-white/70">
            Fallback providers — tried in order if the active provider fails entirely.
          </div>
          {Object.values(providers)
            .filter((p) => p.id !== activeId)
            .map((p) => (
              <label key={p.id} className="flex items-center justify-between text-xs">
                <span className="text-white/60">{p.name}</span>
                <input
                  type="checkbox"
                  checked={settings.ai.fallbackProviderIds.includes(p.id)}
                  onChange={(e) => {
                    const current = settings.ai.fallbackProviderIds.filter((id) => id !== p.id)
                    update({
                      ai: {
                        fallbackProviderIds: e.target.checked ? [...current, p.id] : current,
                      },
                    })
                  }}
                  className="accent-white"
                />
              </label>
            ))}
        </div>
      </details>
    </div>
  )
}

export default ModelsTab
