import { useEffect, useRef, useState } from "react"
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
  const skipCommitRef = useRef(false)

  useEffect(() => {
    if (!focused) setDraft(external)
  }, [external, focused])

  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onFocus: () => {
      skipCommitRef.current = false
      setFocused(true)
    },
    onBlur: () => {
      setFocused(false)
      if (!skipCommitRef.current && draft !== external) commit(draft)
      skipCommitRef.current = false
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return
      if (e.key !== "Enter" && e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        skipCommitRef.current = true
        setDraft(external)
      }
      e.currentTarget.blur()
    },
  }
}
