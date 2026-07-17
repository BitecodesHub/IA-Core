import React, { useState, useCallback } from "react"
import { keyboardEventToAccelerator } from "../../lib/accelerator"

interface KeyCaptureInputProps {
  /** Current accelerator (e.g. "CommandOrControl+B"), or null when disabled. */
  value: string | null
  /** Fires with the captured accelerator string when the user records one. */
  onCapture: (accelerator: string) => void
}

/** Press-to-record accelerator input. */
const KeyCaptureInput: React.FC<KeyCaptureInputProps> = ({ value, onCapture }) => {
  const [recording, setRecording] = useState(false)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!recording) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false)
        return
      }
      const accel = keyboardEventToAccelerator(e)
      if (accel) {
        onCapture(accel)
        setRecording(false)
      }
    },
    [recording, onCapture]
  )

  return (
    <button
      type="button"
      onClick={() => setRecording((r) => !r)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      className={`min-w-[150px] px-2 py-1 text-xs rounded border font-mono transition-colors ${
        recording
          ? "border-yellow-400 text-yellow-300 bg-yellow-400/10"
          : "border-white/40 text-white hover:border-white"
      }`}
      title="Click, then press a key combination"
    >
      {recording ? "Press keys…" : value ? value : "Disabled"}
    </button>
  )
}

export default KeyCaptureInput
