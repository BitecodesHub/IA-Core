import { useEffect, useState } from "react"
import type React from "react"

/**
 * Controlled-input helper that fixes the `defaultValue`+`onBlur` drift bug: the
 * field adopts an external change (settings import, reset, another window, a
 * provider switch) whenever it is NOT focused, but never clobbers what the user
 * is actively typing. It commits on blur/Enter and reverts on Escape.
 */
export function useCommittedValue(external: string, commit: (raw: string) => void) {
  const [draft, setDraft] = useState(external)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(external)
  }, [external, focused])

  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      if (draft !== external) commit(draft)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        ;(e.target as HTMLInputElement).blur()
      } else if (e.key === "Escape") {
        setDraft(external)
        ;(e.target as HTMLInputElement).blur()
      }
    },
  }
}
