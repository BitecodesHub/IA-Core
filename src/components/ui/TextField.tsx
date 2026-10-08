import React, { useId } from "react"
import { useCommittedValue } from "./useCommittedValue"

interface TextFieldProps {
  label: string
  value: string
  onCommit: (v: string) => void
  hint?: string
  mono?: boolean
  readOnly?: boolean
  placeholder?: string
}

/**
 * Controlled text setting field (endpoint, etc.). Reflects external changes when
 * unfocused, commits on blur/Enter, reverts on Escape. `readOnly` is used for
 * endpoints pinned in PINNED_PROVIDER_ENDPOINTS, whose edits would be no-ops.
 */
const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  onCommit,
  hint,
  mono,
  readOnly,
  placeholder,
}) => {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const bind = useCommittedValue(value, onCommit)
  // The hint span must sit OUTSIDE the <label>. Nested inside, its text is
  // concatenated into the label's text content, so the field's accessible name
  // became "Endpoint Groq endpoint is fixed for security." instead of
  // "Endpoint" described by that sentence — which breaks screen-reader
  // announcements and name-based queries alike. NumberField already has the
  // correct shape; this now matches it.
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label htmlFor={id} className="text-white/70">
        {label}
      </label>
      <input
        id={id}
        type="text"
        readOnly={readOnly}
        placeholder={placeholder}
        aria-describedby={hintId}
        title={hint}
        className={`bg-black border border-white/30 rounded px-1.5 py-1 text-white ${
          mono ? "font-mono" : ""
        } ${readOnly ? "opacity-60" : ""}`}
        {...(readOnly ? { value, readOnly: true, onChange: () => {} } : bind)}
      />
      {hint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </div>
  )
}

export default TextField
