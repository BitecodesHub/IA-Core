import { globalShortcut } from "electron"
import type { AppState } from "../main"
import type { ShortcutActionId, Binding } from "../config/schema"
import { SettingsService } from "../config/SettingsService"
import { toggleProviderId } from "../llm/mode"
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTION_LIST,
  DEFAULT_BINDINGS,
  resolveEffectiveBindings,
  resolveEffectiveLocalBindings,
} from "./actions"
import {
  validateAccelerator,
  findConflict,
  detectDuplicates,
  type AcceleratorValidation,
} from "./validation"
import {
  RegistrationResult,
  RegistrationReport,
  RegistrationStatus,
  ShortcutsSnapshot,
  SetShortcutResult,
  ShortcutExport,
  ImportResult,
  SHORTCUT_EXPORT_FORMAT,
} from "./types"

/**
 * Owns global-shortcut registration. Separates *what an action does* (handler
 * map) from *which key triggers it* (effective bindings), which is what makes
 * live re-registration without restart possible.
 */
export class ShortcutsHelper {
  private appState: AppState
  private settings = SettingsService.getInstance()
  private handlers: Record<ShortcutActionId, () => void>
  /** Full effective binding per action (defaults filled in). */
  private effective: Record<ShortcutActionId, Binding>
  /** Actions whose accelerator the OS/another app would not let us register. */
  private osConflicts = new Set<ShortcutActionId>()
  private willQuitHooked = false

  constructor(appState: AppState) {
    this.appState = appState
    this.handlers = this.buildHandlers()
    this.effective = resolveEffectiveBindings(this.settings.get("shortcuts").bindings)
  }

  /** Register every effective binding. Call once at startup. */
  applyAll(): RegistrationReport {
    globalShortcut.unregisterAll()
    this.osConflicts.clear()
    this.effective = resolveEffectiveBindings(this.settings.get("shortcuts").bindings)
    this.appState.setMoveStep(this.settings.get("shortcuts").moveStep)

    for (const id of Object.keys(this.effective) as ShortcutActionId[]) {
      const accel = this.effective[id]
      if (accel) this.register(id, accel)
    }
    const report = this.buildReport()
    this.broadcast(report)
    return report
  }

  /** Live-(re)register a single action without restart. */
  applyOne(id: ShortcutActionId, accel: Binding): RegistrationResult {
    const prev = this.effective[id]
    if (prev) globalShortcut.unregister(prev)
    this.osConflicts.delete(id)
    this.effective[id] = accel

    if (accel === null) {
      return { id, state: "disabled" }
    }
    const ok = this.register(id, accel)
    return { id, state: ok ? "active" : "os-conflict", accelerator: accel }
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll()
  }

  // --- IPC-facing API ------------------------------------------------------

  getSnapshot(): ShortcutsSnapshot {
    return {
      actions: SHORTCUT_ACTION_LIST,
      defaults: DEFAULT_BINDINGS,
      effective: { ...this.effective },
      status: this.statusMap(),
      moveStep: this.settings.get("shortcuts").moveStep,
    }
  }

  validate(
    accel: string,
    excludeId?: ShortcutActionId
  ): AcceleratorValidation & { conflictsWith?: string } {
    const v = validateAccelerator(accel)
    if (!v.valid || !v.normalized) return v
    const conflict = findConflict(
      excludeId ?? ("__none__" as ShortcutActionId),
      v.normalized,
      this.effective
    )
    if (conflict) return { ...v, conflictsWith: conflict }
    const localConflict = this.findLocalConflict(v.normalized)
    return localConflict ? { ...v, conflictsWith: localConflict } : v
  }

  setShortcut(id: ShortcutActionId, accel: Binding): SetShortcutResult {
    if (!SHORTCUT_ACTIONS[id]) return { ok: false }

    // Disabling is always allowed.
    if (accel === null) {
      const result = this.applyOne(id, null)
      this.persist()
      this.broadcast(this.buildReport())
      return { ok: true, result }
    }

    const validation = validateAccelerator(accel)
    if (!validation.valid || !validation.normalized) {
      return { ok: false, validation }
    }

    const conflict = findConflict(id, validation.normalized, this.effective)
    if (conflict) {
      return { ok: false, validation, conflictsWith: conflict }
    }
    const localConflict = this.findLocalConflict(validation.normalized)
    if (localConflict) {
      return { ok: false, validation, conflictsWith: localConflict }
    }

    const result = this.applyOne(id, validation.normalized)
    this.persist()
    this.broadcast(this.buildReport())
    return { ok: true, validation, result }
  }

  resetOne(id: ShortcutActionId): RegistrationResult {
    const result = this.applyOne(id, DEFAULT_BINDINGS[id])
    this.persist()
    this.broadcast(this.buildReport())
    return result
  }

  resetAll(): RegistrationReport {
    this.settings.set({ shortcuts: { bindings: { ...DEFAULT_BINDINGS } } })
    const report = this.applyAll()
    return report
  }

  setMoveStep(px: number): { ok: boolean; moveStep: number } {
    const next = this.settings.set({ shortcuts: { moveStep: px } })
    this.appState.setMoveStep(next.shortcuts.moveStep)
    return { ok: true, moveStep: next.shortcuts.moveStep }
  }

  exportShortcuts(): ShortcutExport {
    return {
      format: SHORTCUT_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      bindings: { ...this.effective },
      moveStep: this.settings.get("shortcuts").moveStep,
    }
  }

  importShortcuts(data: unknown): ImportResult {
    const base: ImportResult = {
      ok: false,
      applied: [],
      skippedUnknownActions: [],
      invalidAccelerators: [],
      inAppConflicts: [],
    }
    if (typeof data !== "object" || data === null) {
      return { ...base, error: "Invalid import file." }
    }
    const obj = data as Record<string, unknown>
    if (obj.format !== SHORTCUT_EXPORT_FORMAT) {
      return { ...base, error: "Unrecognized file format." }
    }
    const rawBindings =
      typeof obj.bindings === "object" && obj.bindings !== null
        ? (obj.bindings as Record<string, unknown>)
        : {}

    // Start from current effective; layer valid imported bindings on top.
    const candidate: Record<ShortcutActionId, Binding> = { ...this.effective }
    for (const key of Object.keys(rawBindings)) {
      if (!(key in SHORTCUT_ACTIONS)) {
        base.skippedUnknownActions.push(key)
        continue
      }
      const id = key as ShortcutActionId
      const val = rawBindings[key]
      if (val === null) {
        candidate[id] = null
        continue
      }
      if (typeof val !== "string") {
        base.invalidAccelerators.push({ id: key, accel: String(val), error: "not-a-string" })
        continue
      }
      const v = validateAccelerator(val)
      if (!v.valid || !v.normalized) {
        base.invalidAccelerators.push({ id: key, accel: val, error: v.error ?? "invalid" })
        continue
      }
      candidate[id] = v.normalized
    }

    // Reject the whole import if it introduces an in-app duplicate (safer than silent last-wins).
    const dups = detectDuplicates(candidate)
    if (dups.length > 0) {
      return { ...base, inAppConflicts: dups, error: "Import would create conflicting shortcuts." }
    }

    const applied = (Object.keys(candidate) as ShortcutActionId[]).filter(
      (id) => candidate[id] !== this.effective[id]
    )
    this.settings.set({ shortcuts: { bindings: candidate } })
    if (typeof obj.moveStep === "number") {
      this.settings.set({ shortcuts: { moveStep: obj.moveStep } })
    }
    const report = this.applyAll()
    return { ...base, ok: true, applied, report }
  }

  // --- internals -----------------------------------------------------------

  private register(id: ShortcutActionId, accel: string): boolean {
    this.ensureWillQuitHook()
    let ok = false
    try {
      ok = globalShortcut.register(accel, this.handlers[id]) && globalShortcut.isRegistered(accel)
    } catch (err) {
      console.error(`[Shortcuts] Failed to register ${accel} for ${id}:`, err)
      ok = false
    }
    if (ok) this.osConflicts.delete(id)
    else this.osConflicts.add(id)
    return ok
  }

  private persist(): void {
    this.settings.set({ shortcuts: { bindings: { ...this.effective } } })
  }

  private statusMap(): Record<ShortcutActionId, RegistrationStatus> {
    const map = {} as Record<ShortcutActionId, RegistrationStatus>
    for (const id of Object.keys(SHORTCUT_ACTIONS) as ShortcutActionId[]) {
      map[id] = this.statusFor(id)
    }
    return map
  }

  private statusFor(id: ShortcutActionId): RegistrationStatus {
    const accel = this.effective[id]
    if (accel === null || accel === undefined) return "disabled"
    if (this.osConflicts.has(id)) return "os-conflict"
    return "active"
  }

  private buildReport(): RegistrationReport {
    const results: RegistrationResult[] = (Object.keys(SHORTCUT_ACTIONS) as ShortcutActionId[]).map(
      (id) => ({
        id,
        state: this.statusFor(id),
        accelerator: this.effective[id] ?? undefined,
      })
    )
    return { results, timestamp: Date.now() }
  }

  private findLocalConflict(accel: string): string | null {
    const local = resolveEffectiveLocalBindings(this.settings.get("localShortcuts").bindings)
    for (const [id, binding] of Object.entries(local)) {
      if (
        binding &&
        validateAccelerator(binding).normalized === validateAccelerator(accel).normalized
      ) {
        return `local:${id}`
      }
    }
    return null
  }

  private broadcast(report: RegistrationReport): void {
    const win = this.appState.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send("shortcuts:status-changed", report)
    }
  }

  private ensureWillQuitHook(): void {
    if (this.willQuitHooked) return
    this.willQuitHooked = true
    // Registered once; unregisterAll on quit prevents orphaned global shortcuts.
    const { app } = require("electron")
    app.on("will-quit", () => globalShortcut.unregisterAll())
  }

  private buildHandlers(): Record<ShortcutActionId, () => void> {
    const s = this.appState
    return {
      toggleWindow: () => {
        s.toggleMainWindow()
        const win = s.getMainWindow()
        if (win && !s.isVisible() && process.platform === "darwin") {
          win.setAlwaysOnTop(true, "normal")
          setTimeout(() => {
            if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, "floating")
          }, 100)
        }
      },
      showWindow: () => s.centerAndShowWindow(),
      takeScreenshot: async () => {
        const win = s.getMainWindow()
        if (!win) return
        try {
          const screenshotPath = await s.takeScreenshot()
          const preview = await s.getImagePreview(screenshotPath)
          win.webContents.send("screenshot-taken", { path: screenshotPath, preview })
        } catch (err: any) {
          console.error("[Shortcuts] Screenshot failed:", err)
          win.webContents.send("screenshot-error", {
            message: err?.message ?? String(err),
            code: err?.code,
          })
        }
      },
      process: async () => {
        await s.processingHelper.processScreenshots()
      },
      reset: () => {
        s.processingHelper.cancelOngoingRequests()
        s.clearQueues()
        s.setView("queue")
        const win = s.getMainWindow()
        if (win && !win.isDestroyed()) win.webContents.send("reset-view")
      },
      toggleMode: () => {
        // Flip the active provider between offline (Ollama) and online (OpenRouter).
        // Also ensure the target is enabled — otherwise providerSequence would drop
        // it and every request would fail while the badge still reads the new mode.
        // SettingsService.set fires the change event, which invalidates the provider
        // cache and broadcasts settings:changed so the renderer badge updates.
        const ai = this.settings.get("ai")
        const next = toggleProviderId(ai.activeProviderId)
        this.settings.set({
          ai: { activeProviderId: next, providers: { [next]: { enabled: true } } },
        })
      },
      moveLeft: () => s.moveWindowLeft(),
      moveRight: () => s.moveWindowRight(),
      moveUp: () => s.moveWindowUp(),
      moveDown: () => s.moveWindowDown(),
    }
  }
}
