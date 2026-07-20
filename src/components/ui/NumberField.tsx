import React, { useId } from "react"
import { useCommittedValue } from "./useCommittedValue"

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  hint: string
  onCommit: (n: number) => void
}

/**
 * Controlled numeric setting field. Reflects external changes when unfocused
 * (see useCommittedValue), commits a finite number on blur/Enter, and keeps the
 * label programmatically associated for accessibility.
 */
const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  min,
  max,
  step,
  hint,
  onCommit,
}) => {
  const id = useId()
  const hintId = `${id}-hint`
  const bind = useCommittedValue(String(value), (raw) => {
    // Ignore empty/non-numeric input (Number("") === 0 would silently bypass min);
    // clamp valid input into [min,max]. On an ignored commit the field reverts to
    // the external value via useCommittedValue.
    if (raw.trim() === "") return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    onCommit(Math.min(max, Math.max(min, n)))
  })
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <label htmlFor={id} className="text-white/70">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        aria-describedby={hintId}
        className="w-24 bg-black border border-white/30 rounded px-1.5 py-0.5 text-white"
        {...bind}
      />
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </div>
  )
}

export default NumberField
