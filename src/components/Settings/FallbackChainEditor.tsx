import React from "react"
import { X } from "lucide-react"
import Combobox from "../ui/Combobox"
import { buildModelOptions, type ModelLike } from "../../lib/modelOptions"

interface FallbackChainEditorProps {
  models: ModelLike[]
  chain: string[]
  disabled?: boolean
  loading?: boolean
  onChange: (chain: string[]) => void
}

const MAX_CHAIN = 16 // matches schema strArray cap

/**
 * Edits a provider's fallback-model chain (provider.fallbackModels): an ordered
 * list tried after the primary model on rate-limit/downtime. Add via the
 * combobox (deduped, capped), remove via the ✕. Order reflects add order.
 */
const FallbackChainEditor: React.FC<FallbackChainEditorProps> = ({
  models,
  chain,
  disabled,
  loading,
  onChange,
}) => {
  const list = chain ?? [] // defensive: coercion guarantees an array in production
  const add = (value: string) => {
    if (!value) return // "Auto" is not a fallback entry
    if (list.includes(value)) return
    if (list.length >= MAX_CHAIN) return
    onChange([...list, value])
  }
  const remove = (value: string) => onChange(list.filter((m) => m !== value))

  // Offer only models not already in the chain.
  const available = models.filter((m) => !list.includes(m.name))

  return (
    <div className="space-y-1.5 border border-white/10 rounded-md p-2">
      <div className="text-xs text-white/70">Fallback models</div>
      <div className="text-[11px] text-white/70">
        Tried in order if the primary model is rate-limited or down.
      </div>
      {list.length > 0 && (
        <ul className="space-y-1" aria-label="Fallback model chain">
          {list.map((m, i) => (
            <li
              key={m}
              className="flex items-center justify-between gap-2 bg-white/5 rounded px-2 py-1"
            >
              <span className="text-xs text-white/80 truncate">
                <span className="text-white/40 mr-1">{i + 1}.</span>
                {m}
              </span>
              <button
                type="button"
                aria-label={`Remove ${m}`}
                onClick={() => remove(m)}
                className="text-white/60 hover:text-white shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Combobox
        ariaLabel="Add fallback model"
        value=""
        onChange={add}
        options={buildModelOptions(available, { value: "", autoLabel: "Add a fallback model…" })}
        disabled={disabled || chain.length >= MAX_CHAIN}
        loading={loading}
        className="w-full"
      />
    </div>
  )
}

export default FallbackChainEditor
