import { useEffect } from "react"
import { keyboardEventToAccelerator, acceleratorsEqual } from "../lib/accelerator"
import type { Binding, LocalShortcutActionId } from "../types/settings"
import { resolveEffectiveLocalBindings } from "../../electron/shortcuts/actions"

type HandlerMap = Partial<Record<LocalShortcutActionId, () => void>>

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || target.isContentEditable
}

export function useLocalShortcuts(
  bindings: Partial<Record<LocalShortcutActionId, Binding>> | undefined,
  handlers: HandlerMap
) {
  useEffect(() => {
    const effective = resolveEffectiveLocalBindings(bindings ?? {})
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = keyboardEventToAccelerator(event)
      if (!accel) return
      for (const [id, binding] of Object.entries(effective) as Array<
        [LocalShortcutActionId, Binding]
      >) {
        const handler = handlers[id]
        if (!handler || !acceleratorsEqual(binding, accel)) continue
        if (isTypingTarget(event.target) && id !== "stopGeneration" && id !== "closePanels") return
        event.preventDefault()
        event.stopPropagation()
        handler()
        return
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [bindings, handlers])
}
