import React from "react"
import Combobox from "../ui/Combobox"
import { buildModelOptions, autoHintForSlot, type ModelLike } from "../../lib/modelOptions"

interface ModelSlotsProps {
  models: ModelLike[]
  lowModel: string
  highModel: string
  visionModel: string
  disabled?: boolean
  loading?: boolean
  onChange: (patch: { lowModel?: string; highModel?: string; visionModel?: string }) => void
}

/** The three model-slot comboboxes (Vision / Low / High) for one provider. */
const ModelSlots: React.FC<ModelSlotsProps> = ({
  models,
  lowModel,
  highModel,
  visionModel,
  disabled,
  loading,
  onChange,
}) => {
  const row = (
    label: string,
    slot: "low" | "high" | "vision",
    value: string,
    visionOnly: boolean,
    onPick: (v: string) => void
  ) => (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-white/70">{label}</span>
      <Combobox
        ariaLabel={label}
        value={value}
        onChange={onPick}
        options={buildModelOptions(models, { value, visionOnly })}
        hint={autoHintForSlot(slot)}
        disabled={disabled}
        loading={loading}
      />
    </div>
  )

  return (
    <div className="space-y-2 border border-white/10 rounded-md p-2">
      {row("Vision model", "vision", visionModel, true, (v) => onChange({ visionModel: v }))}
      {row("Low (fast) model", "low", lowModel, false, (v) => onChange({ lowModel: v }))}
      {row("High (strong) model", "high", highModel, false, (v) => onChange({ highModel: v }))}
    </div>
  )
}

export default ModelSlots
