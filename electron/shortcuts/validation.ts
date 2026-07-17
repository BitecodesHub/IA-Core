// Pure accelerator validation + conflict detection. No Electron imports so this
// is fully unit-testable. Mirrors the subset of Electron's accelerator grammar
// the app uses: one-or-more modifiers + exactly one key token.

import type { ShortcutActionId, Binding } from "../config/schema"

export type AcceleratorError =
  | "empty"
  | "no-modifier"
  | "no-key"
  | "multiple-keys"
  | "unknown-token"

export interface AcceleratorValidation {
  valid: boolean
  normalized?: string
  reserved?: boolean
  error?: AcceleratorError
  message?: string
}

export interface DuplicateGroup {
  accelerator: string
  actionIds: ShortcutActionId[]
}

const MODIFIERS = new Set([
  "command",
  "cmd",
  "control",
  "ctrl",
  "commandorcontrol",
  "cmdorctrl",
  "alt",
  "option",
  "altgr",
  "shift",
  "super",
  "meta",
])

// Canonical display/ordering weight for modifiers.
const MODIFIER_ORDER: Record<string, number> = {
  commandorcontrol: 0,
  command: 0,
  control: 0,
  alt: 1,
  option: 1,
  altgr: 1,
  shift: 2,
  super: 3,
  meta: 3,
}

const MODIFIER_CANONICAL: Record<string, string> = {
  cmd: "Command",
  command: "Command",
  ctrl: "Control",
  control: "Control",
  cmdorctrl: "CommandOrControl",
  commandorcontrol: "CommandOrControl",
  alt: "Alt",
  option: "Option",
  altgr: "AltGr",
  shift: "Shift",
  super: "Super",
  meta: "Meta",
}

const KEY_TOKENS = new Set<string>([
  // Letters & digits handled separately. Named keys Electron accepts:
  "plus",
  "space",
  "tab",
  "capslock",
  "numlock",
  "scrolllock",
  "backspace",
  "delete",
  "insert",
  "return",
  "enter",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "escape",
  "esc",
  "printscreen",
  "volumeup",
  "volumedown",
  "volumemute",
  "medianexttrack",
  "mediaprevioustrack",
  "mediastop",
  "mediaplaypause",
  // punctuation
  ")",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ":",
  ";",
  "+",
  "=",
  "<",
  ",",
  "_",
  "-",
  ">",
  ".",
  "?",
  "/",
  "~",
  "`",
  "{",
  "]",
  "[",
  "|",
  "\\",
  "}",
  '"',
  "'",
])

function isKeyToken(token: string): boolean {
  const t = token.toLowerCase()
  if (/^[a-z0-9]$/.test(t)) return true // single letter/digit
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) return true // F1..F24
  if (
    /^num[0-9]$/.test(t) ||
    t === "numdec" ||
    t === "numadd" ||
    t === "numsub" ||
    t === "nummult" ||
    t === "numdiv"
  )
    return true
  return KEY_TOKENS.has(t) || KEY_TOKENS.has(token)
}

function canonicalKey(token: string): string {
  const t = token.toLowerCase()
  if (/^[a-z]$/.test(t)) return t.toUpperCase()
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) return "F" + t.slice(1)
  const named: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Return",
    space: "Space",
    tab: "Tab",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    delete: "Delete",
    backspace: "Backspace",
    insert: "Insert",
    plus: "Plus",
  }
  return named[t] ?? token
}

// Combos that the OS commonly reserves; allowed but flagged as a soft warning.
const RESERVED = new Set([
  "CommandOrControl+Q",
  "CommandOrControl+W",
  "CommandOrControl+Tab",
  "Command+Space",
  "Control+Space",
  "CommandOrControl+Shift+Q",
])

/**
 * Validate and normalize an Electron accelerator string. `null` is treated as a
 * valid "disabled" binding by callers; pass only non-null strings here.
 */
export function validateAccelerator(accel: string): AcceleratorValidation {
  if (!accel || !accel.trim()) {
    return { valid: false, error: "empty", message: "Shortcut is empty." }
  }

  const parts = accel
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const mods: string[] = []
  const keys: string[] = []

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (MODIFIERS.has(lower)) {
      mods.push(lower)
    } else if (isKeyToken(part)) {
      keys.push(part)
    } else {
      return {
        valid: false,
        error: "unknown-token",
        message: `Unrecognized key: "${part}".`,
      }
    }
  }

  if (mods.length === 0) {
    return {
      valid: false,
      error: "no-modifier",
      message: "Add a modifier (Cmd/Ctrl, Alt, or Shift).",
    }
  }
  if (keys.length === 0) {
    return { valid: false, error: "no-key", message: "Add a key (e.g. a letter)." }
  }
  if (keys.length > 1) {
    return {
      valid: false,
      error: "multiple-keys",
      message: "Use exactly one non-modifier key.",
    }
  }

  const normalized = normalizeFromParts(mods, keys[0])
  return {
    valid: true,
    normalized,
    reserved: RESERVED.has(normalized),
    message: RESERVED.has(normalized)
      ? "This combination is often reserved by the system."
      : undefined,
  }
}

function normalizeFromParts(mods: string[], key: string): string {
  const uniqueMods = Array.from(new Set(mods))
  uniqueMods.sort((a, b) => (MODIFIER_ORDER[a] ?? 9) - (MODIFIER_ORDER[b] ?? 9))
  const canonMods = uniqueMods.map((m) => MODIFIER_CANONICAL[m] ?? m)
  return [...canonMods, canonicalKey(key)].join("+")
}

/** Canonical form for equality comparison; invalid input returns the input unchanged. */
export function normalizeAccelerator(accel: string): string {
  const v = validateAccelerator(accel)
  return v.valid && v.normalized ? v.normalized : accel
}

/**
 * Find actions that resolve to the same normalized accelerator. Disabled (null)
 * bindings never conflict.
 */
export function detectDuplicates(effective: Record<ShortcutActionId, Binding>): DuplicateGroup[] {
  const byAccel = new Map<string, ShortcutActionId[]>()
  for (const id of Object.keys(effective) as ShortcutActionId[]) {
    const accel = effective[id]
    if (!accel) continue
    const norm = normalizeAccelerator(accel)
    const list = byAccel.get(norm) ?? []
    list.push(id)
    byAccel.set(norm, list)
  }
  const groups: DuplicateGroup[] = []
  for (const [accelerator, actionIds] of byAccel) {
    if (actionIds.length > 1) groups.push({ accelerator, actionIds })
  }
  return groups
}

/**
 * Check whether assigning `accel` to `targetId` would collide with another
 * action's effective binding. Returns the conflicting action id, if any.
 */
export function findConflict(
  targetId: ShortcutActionId,
  accel: string,
  effective: Record<ShortcutActionId, Binding>
): ShortcutActionId | null {
  const norm = normalizeAccelerator(accel)
  for (const id of Object.keys(effective) as ShortcutActionId[]) {
    if (id === targetId) continue
    const other = effective[id]
    if (other && normalizeAccelerator(other) === norm) return id
  }
  return null
}
