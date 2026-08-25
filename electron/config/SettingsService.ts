import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { AppSettings, DEFAULT_SETTINGS, SETTINGS_VERSION, coerceSettings } from "./schema"
import { runMigrations } from "./migrations"
import { deepMerge, diffPaths, type DeepPartial } from "./merge"

export type { DeepPartial }

type ChangeListener = (next: AppSettings, prev: AppSettings, changedPaths: string[]) => void
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
 * - Written atomically (temp file + fsync + rename) and debounced so rapid
 *   updates (e.g. dragging a slider) coalesce into one durable write.
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
      if (fromVersion !== SETTINGS_VERSION) {
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
    const prev = this.settings
    const merged = deepMerge(
      prev as unknown as Record<string, unknown>,
      patch as Record<string, unknown>
    )
    const next = coerceSettings(merged)

    const changedPaths = diffPaths(prev as unknown, next as unknown)
    if (changedPaths.length === 0) return next

    this.settings = next
    this.scheduleWrite()
    this.emit("change", next, prev, changedPaths)
    return next
  }

  /** Reset all settings, or a single top-level section, to defaults. */
  reset(section?: keyof AppSettings): AppSettings {
    if (section) {
      return this.set({ [section]: DEFAULT_SETTINGS[section] } as DeepPartial<AppSettings>)
    }
    const prev = this.settings
    this.settings = coerceSettings(DEFAULT_SETTINGS)
    this.scheduleWrite()
    this.emit("change", this.settings, prev, diffPaths(prev as unknown, this.settings as unknown))
    return this.settings
  }

  replaceAll(nextSettings: unknown): AppSettings {
    const prev = this.settings
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
    this.settings = coerceSettings({ ...migrated, version: SETTINGS_VERSION })
    this.scheduleWrite()
    this.emit("change", this.settings, prev, diffPaths(prev as unknown, this.settings as unknown))
    return this.settings
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

  /** Force any pending debounced write to disk immediately (call on quit). */
  flushSync(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.pendingWrite = false
    this.writeToDisk()
  }

  // -------------------------------------------------------------------------

  private scheduleWrite(): void {
    this.pendingWrite = true
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      if (this.pendingWrite) {
        this.pendingWrite = false
        this.writeToDisk()
      }
    }, 150)
  }

  private writeToDisk(): void {
    const dir = path.dirname(this.filePath)
    const tmp = `${this.filePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      const data = JSON.stringify(this.settings, null, 2)
      const fd = fs.openSync(tmp, "w")
      try {
        fs.writeSync(fd, data)
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      try {
        fs.renameSync(tmp, this.filePath)
      } catch (renameErr: any) {
        if (["EXDEV", "EPERM", "EBUSY"].includes(renameErr?.code)) {
          fs.copyFileSync(tmp, this.filePath)
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
    }
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
