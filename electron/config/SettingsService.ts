import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { AppSettings, DEFAULT_SETTINGS, SETTINGS_VERSION, coerceSettings } from "./schema"
import { runMigrations } from "./migrations"
import { deepMerge, diffPaths, type DeepPartial } from "./merge"

export type { DeepPartial }

type ChangeListener = (next: AppSettings, prev: AppSettings, changedPaths: string[]) => void
export type SettingsPersistenceStatus = {
  state: "pending" | "saved" | "failed"
  error?: string
}
type PersistenceListener = (status: SettingsPersistenceStatus) => void

export const SETTINGS_EXPORT_FORMAT = "ia-core.settings"

export interface SettingsExport {
  format: typeof SETTINGS_EXPORT_FORMAT
  version: number
  exportedAt: string
  settings: AppSettings
}

export interface ImportSettingsResult {
  ok: boolean
  settings?: AppSettings
  error?: string
}

/**
 * Persistent, validated application settings.
 *
 * - Stored as JSON at `userData/settings.json`.
 * - Debounced temp-file + fsync + rename writes coalesce rapid updates. On
 *   platforms that reject rename, a non-atomic copy + fsync fallback is used.
 * - Persistence status is separate from in-memory changes; failed writes stay
 *   dirty until an explicit retry, later edit, or shutdown flush succeeds.
 * - Always loads to a valid object: a corrupt file is backed up and defaults are
 *   used instead of crashing.
 * - Emits `change` with the set of changed dotted paths so other subsystems
 *   (window, shortcuts, provider) can react live, no restart required.
 */
export class SettingsService extends EventEmitter {
  private static instance: SettingsService | null = null

  private settings: AppSettings = DEFAULT_SETTINGS
  private readonly filePath: string
  private writeTimer: NodeJS.Timeout | null = null
  private pendingWrite = false
  private persistence: SettingsPersistenceStatus = { state: "saved" }
  private loaded = false

  private constructor() {
    super()
    this.filePath = path.join(app.getPath("userData"), "settings.json")
  }

  static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService()
    }
    return SettingsService.instance
  }

  /** Synchronously load from disk (call once during startup). */
  load(): AppSettings {
    try {
      const rawText = fs.readFileSync(this.filePath, "utf-8")
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>
      } catch {
        this.backupCorruptFile(rawText)
        parsed = {}
      }

      const fromVersion = typeof parsed.version === "number" ? parsed.version : SETTINGS_VERSION
      const migrated =
        fromVersion < SETTINGS_VERSION
          ? runMigrations(parsed, fromVersion, SETTINGS_VERSION)
          : parsed

      this.settings = coerceSettings({ ...migrated, version: SETTINGS_VERSION })

      // Persist back if migration or coercion changed anything, or the file did
      // not exist with the current version.
      if (fromVersion !== SETTINGS_VERSION || diffPaths(migrated, this.settings).length > 0) {
        this.flushSync()
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error("[SettingsService] Failed to read settings, using defaults:", err)
      }
      this.settings = coerceSettings(DEFAULT_SETTINGS)
      this.flushSync()
    }
    this.loaded = true
    return this.settings
  }

  getAll(): Readonly<AppSettings> {
    if (!this.loaded) this.load()
    return this.settings
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.getAll()[key]
  }

  /**
   * Merge a partial patch, coerce the whole object, persist (debounced), and emit
   * a change event. Returns the new, fully-valid settings.
   */
  set(patch: DeepPartial<AppSettings>): AppSettings {
    const merged = deepMerge(
      this.getAll() as unknown as Record<string, unknown>,
      patch as Record<string, unknown>
    )
    return this.apply(coerceSettings(merged))
  }

  /** Reset all settings, or a single top-level section, to defaults. */
  reset(section?: keyof AppSettings): AppSettings {
    const prev = this.getAll()
    const next = section
      ? { ...prev, [section]: DEFAULT_SETTINGS[section] }
      : DEFAULT_SETTINGS
    return this.apply(coerceSettings(next))
  }

  replaceAll(nextSettings: unknown): AppSettings {
    this.getAll()
    // Run migrations for older-version imports, mirroring load(), so an exported
    // settings file from a previous version upgrades correctly instead of relying
    // on coercion alone.
    const raw =
      nextSettings && typeof nextSettings === "object"
        ? (nextSettings as Record<string, unknown>)
        : {}
    const fromVersion = typeof raw.version === "number" ? raw.version : SETTINGS_VERSION
    const migrated =
      fromVersion < SETTINGS_VERSION ? runMigrations(raw, fromVersion, SETTINGS_VERSION) : raw
    return this.apply(coerceSettings({ ...migrated, version: SETTINGS_VERSION }))
  }

  exportSettings(): SettingsExport {
    return {
      format: SETTINGS_EXPORT_FORMAT,
      version: SETTINGS_VERSION,
      exportedAt: new Date().toISOString(),
      settings: this.getAll() as AppSettings,
    }
  }

  importSettings(data: unknown): ImportSettingsResult {
    if (!data || typeof data !== "object") return { ok: false, error: "Invalid settings file." }
    const obj = data as Record<string, unknown>
    if (obj.format !== SETTINGS_EXPORT_FORMAT) {
      return { ok: false, error: "Unrecognized settings file format." }
    }
    if (!obj.settings || typeof obj.settings !== "object") {
      return { ok: false, error: "Settings file does not contain settings." }
    }
    return { ok: true, settings: this.replaceAll(obj.settings) }
  }

  onChange(listener: ChangeListener): () => void {
    this.on("change", listener)
    return () => this.off("change", listener)
  }

  getPersistenceStatus(): SettingsPersistenceStatus {
    this.getAll()
    return { ...this.persistence }
  }

  onPersistenceChanged(listener: PersistenceListener): () => void {
    this.on("persistence-changed", listener)
    return () => this.off("persistence-changed", listener)
  }

  /** Explicit, single-attempt retry. No unbounded background retry loop. */
  retryPersistence(): SettingsPersistenceStatus {
    this.getAll()
    if (this.pendingWrite) this.flushSync()
    return this.getPersistenceStatus()
  }

  /** Force a write to disk immediately (also used during startup and on quit). */
  flushSync(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.pendingWrite = true
    this.setPersistence({ state: "pending" })
    this.writeToDisk()
  }

  // -------------------------------------------------------------------------

  private apply(next: AppSettings): AppSettings {
    const prev = this.settings
    const changedPaths = diffPaths(prev, next)
    if (changedPaths.length === 0) return this.settings
    this.settings = next
    this.scheduleWrite()
    this.emit("change", next, prev, changedPaths)
    return next
  }

  private setPersistence(status: SettingsPersistenceStatus): void {
    if (this.persistence.state === status.state && this.persistence.error === status.error) return
    this.persistence = status
    this.emit("persistence-changed", { ...status })
  }

  private scheduleWrite(): void {
    this.pendingWrite = true
    this.setPersistence({ state: "pending" })
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      if (this.pendingWrite) this.writeToDisk()
    }, 150)
  }

  private writeToDisk(): void {
    const dir = path.dirname(this.filePath)
    const tmp = `${this.filePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      const data = Buffer.from(JSON.stringify(this.settings, null, 2), "utf-8")
      const fd = fs.openSync(tmp, "w")
      try {
        let offset = 0
        while (offset < data.length) {
          const written = fs.writeSync(fd, data, offset, data.length - offset)
          if (written <= 0) throw new Error("Settings write made no progress")
          offset += written
        }
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      try {
        fs.renameSync(tmp, this.filePath)
      } catch (renameErr: any) {
        if (["EXDEV", "EPERM", "EBUSY"].includes(renameErr?.code)) {
          fs.copyFileSync(tmp, this.filePath)
          const targetFd = fs.openSync(this.filePath, "r+")
          try {
            fs.fsyncSync(targetFd)
          } finally {
            fs.closeSync(targetFd)
          }
          try {
            fs.unlinkSync(tmp)
          } catch {}
        } else {
          throw renameErr
        }
      }
    } catch (err) {
      console.error("[SettingsService] Failed to write settings:", err)
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      } catch {
        /* ignore cleanup failure */
      }
      this.pendingWrite = true
      this.setPersistence({
        state: "failed",
        error: "Settings are applied but could not be saved to disk. Retry saving.",
      })
      return
    }
    this.pendingWrite = false
    this.setPersistence({ state: "saved" })
  }

  private backupCorruptFile(contents: string): void {
    try {
      const backup = `${this.filePath}.corrupt-${Date.now()}.json`
      fs.writeFileSync(backup, contents)
      console.warn(`[SettingsService] Corrupt settings backed up to ${backup}`)
    } catch (err) {
      console.error("[SettingsService] Failed to back up corrupt settings:", err)
    }
  }
}
