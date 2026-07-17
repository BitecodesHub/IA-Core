import type { ShortcutActionId, Binding } from "../config/schema"
import type { ShortcutActionDef } from "./actions"
import type { AcceleratorValidation, DuplicateGroup } from "./validation"

export type RegistrationStatus = "active" | "disabled" | "os-conflict" | "duplicate"

export interface RegistrationResult {
  id: ShortcutActionId
  state: RegistrationStatus
  accelerator?: string
  /** When state is "duplicate", the other action it collides with. */
  conflictsWith?: string
}

export interface RegistrationReport {
  results: RegistrationResult[]
  timestamp: number
}

/** Everything the Settings UI needs to render the Shortcuts tab. */
export interface ShortcutsSnapshot {
  actions: ShortcutActionDef[]
  defaults: Record<ShortcutActionId, Binding>
  effective: Record<ShortcutActionId, Binding>
  status: Record<ShortcutActionId, RegistrationStatus>
  moveStep: number
}

export interface SetShortcutResult {
  ok: boolean
  validation?: AcceleratorValidation
  result?: RegistrationResult
  conflictsWith?: string
}

export const SHORTCUT_EXPORT_FORMAT = "ia-core.shortcuts"

export interface ShortcutExport {
  format: typeof SHORTCUT_EXPORT_FORMAT
  version: number
  exportedAt: string
  bindings: Record<string, Binding>
  moveStep: number
}

export interface ImportResult {
  ok: boolean
  applied: ShortcutActionId[]
  skippedUnknownActions: string[]
  invalidAccelerators: { id: string; accel: string; error: string }[]
  inAppConflicts: DuplicateGroup[]
  report?: RegistrationReport
  error?: string
}
