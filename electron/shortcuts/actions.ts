import type { ShortcutActionId, LocalShortcutActionId, Binding } from "../config/schema"

export type { ShortcutActionId, Binding }

export interface ShortcutActionDef {
  id: ShortcutActionId
  label: string
  description: string
  /** Platform-neutral default via "CommandOrControl". `null` would mean unbound by default. */
  defaultAccelerator: Binding
  category: "window" | "capture" | "processing" | "mode"
  /** Optional grouping key for the UI (e.g. the four move actions). */
  group?: string
}

export interface LocalShortcutActionDef {
  id: LocalShortcutActionId
  label: string
  description: string
  defaultAccelerator: Binding
  category: "chat" | "settings" | "control"
}

// Defaults use the near-"hyper" combo (Cmd/Ctrl + Alt + Shift + key). Three
// modifiers make these effectively collision-proof against OS and app shortcuts
// (which almost always use one or two modifiers). They remain fully rebindable.
/** The full, ordered registry of user-rebindable actions. */
export const SHORTCUT_ACTIONS: Record<ShortcutActionId, ShortcutActionDef> = {
  toggleWindow: {
    id: "toggleWindow",
    label: "Toggle Window",
    description: "Show or hide the overlay.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+B",
    category: "window",
  },
  showWindow: {
    id: "showWindow",
    label: "Center & Show",
    description: "Re-center and show the overlay.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+S",
    category: "window",
  },
  takeScreenshot: {
    id: "takeScreenshot",
    label: "Take Screenshot",
    description: "Capture the screen and queue it for analysis.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+H",
    category: "capture",
  },
  process: {
    id: "process",
    label: "Process",
    description: "Process the queued screenshots.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+Return",
    category: "processing",
  },
  reset: {
    id: "reset",
    label: "Reset / Start Over",
    description: "Cancel any in-flight request and clear the queues.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+R",
    category: "processing",
  },
  toggleMode: {
    id: "toggleMode",
    label: "Toggle Online/Offline",
    description: "Switch AI mode between offline (local Ollama) and online (OpenRouter).",
    defaultAccelerator: "CommandOrControl+Alt+Shift+M",
    category: "mode",
  },
  moveLeft: {
    id: "moveLeft",
    label: "Move Left",
    description: "Move the overlay left.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+Left",
    category: "window",
    group: "move",
  },
  moveRight: {
    id: "moveRight",
    label: "Move Right",
    description: "Move the overlay right.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+Right",
    category: "window",
    group: "move",
  },
  moveUp: {
    id: "moveUp",
    label: "Move Up",
    description: "Move the overlay up.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+Up",
    category: "window",
    group: "move",
  },
  moveDown: {
    id: "moveDown",
    label: "Move Down",
    description: "Move the overlay down.",
    defaultAccelerator: "CommandOrControl+Alt+Shift+Down",
    category: "window",
    group: "move",
  },
}

export const SHORTCUT_ACTION_LIST: ShortcutActionDef[] = Object.values(SHORTCUT_ACTIONS)

export const DEFAULT_BINDINGS: Record<ShortcutActionId, Binding> = Object.fromEntries(
  SHORTCUT_ACTION_LIST.map((a) => [a.id, a.defaultAccelerator])
) as Record<ShortcutActionId, Binding>

/**
 * Resolve the effective binding for every action from the sparse stored overrides.
 * `undefined` (absent) -> default; `null` -> explicitly disabled.
 */
export function resolveEffectiveBindings(
  overrides: Partial<Record<ShortcutActionId, Binding>>
): Record<ShortcutActionId, Binding> {
  const result = {} as Record<ShortcutActionId, Binding>
  for (const id of Object.keys(SHORTCUT_ACTIONS) as ShortcutActionId[]) {
    result[id] = id in overrides ? (overrides[id] as Binding) : DEFAULT_BINDINGS[id]
  }
  return result
}

export const LOCAL_SHORTCUT_ACTIONS: Record<LocalShortcutActionId, LocalShortcutActionDef> = {
  toggleChat: {
    id: "toggleChat",
    label: "Toggle Chat",
    description: "Open or close the chat panel while the overlay is focused.",
    defaultAccelerator: "CommandOrControl+Alt+C",
    category: "chat",
  },
  toggleSettings: {
    id: "toggleSettings",
    label: "Toggle Settings",
    description: "Open or close Settings while the overlay is focused.",
    defaultAccelerator: "CommandOrControl+,",
    category: "settings",
  },
  focusChat: {
    id: "focusChat",
    label: "Focus Chat Input",
    description: "Move keyboard focus to the chat input.",
    defaultAccelerator: "CommandOrControl+Alt+L",
    category: "chat",
  },
  closePanels: {
    id: "closePanels",
    label: "Close Panels",
    description: "Close Settings and Chat panels.",
    defaultAccelerator: "CommandOrControl+Alt+Escape",
    category: "control",
  },
  stopGeneration: {
    id: "stopGeneration",
    label: "Stop Generation",
    description: "Cancel the active chat or screenshot analysis request.",
    defaultAccelerator: "CommandOrControl+Alt+.",
    category: "control",
  },
}

export const LOCAL_SHORTCUT_ACTION_LIST: LocalShortcutActionDef[] =
  Object.values(LOCAL_SHORTCUT_ACTIONS)

export const DEFAULT_LOCAL_BINDINGS: Record<LocalShortcutActionId, Binding> = Object.fromEntries(
  LOCAL_SHORTCUT_ACTION_LIST.map((a) => [a.id, a.defaultAccelerator])
) as Record<LocalShortcutActionId, Binding>

export function resolveEffectiveLocalBindings(
  overrides: Partial<Record<LocalShortcutActionId, Binding>>
): Record<LocalShortcutActionId, Binding> {
  const result = {} as Record<LocalShortcutActionId, Binding>
  for (const id of Object.keys(LOCAL_SHORTCUT_ACTIONS) as LocalShortcutActionId[]) {
    result[id] = id in overrides ? (overrides[id] as Binding) : DEFAULT_LOCAL_BINDINGS[id]
  }
  return result
}
