import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_SETTINGS, coerceSettings } from "../electron/config/schema"
import type { SettingsService as Service } from "../electron/config/SettingsService"

const electron = vi.hoisted(() => ({ getPath: vi.fn() }))
vi.mock("electron", () => ({ app: electron }))

let dir: string
let file: string
let service: Service
const diskSettings = () => JSON.parse(fs.readFileSync(file, "utf-8"))
const failure = (code = "EACCES") => Object.assign(new Error("synthetic disk failure"), { code })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  dir = fs.mkdtempSync("/tmp/ia-settings-test-")
  file = path.join(dir, "settings.json")
  electron.getPath.mockReturnValue(dir)
  fs.writeFileSync(file, JSON.stringify(coerceSettings(DEFAULT_SETTINGS)))
  vi.spyOn(console, "error").mockImplementation(() => {})
  const { SettingsService } = await import("../electron/config/SettingsService")
  service = SettingsService.getInstance()
  service.load()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("settings section replacement", () => {
  it.each(["shortcuts", "localShortcuts"] as const)("removes custom/disabled %s bindings and preserves other sections", (section) => {
    service.set({
      general: { theme: "light" },
      shortcuts: { bindings: { takeScreenshot: "Alt+X", process: null }, moveStep: 80 },
      localShortcuts: { bindings: { toggleChat: "Alt+C", closePanels: null } },
    })
    const prev = service.getAll()
    const changed = vi.fn()
    const off = service.onChange(changed)
    const next = service.reset(section)
    expect(next[section]).toEqual(DEFAULT_SETTINGS[section])
    for (const key of Object.keys(prev) as Array<keyof typeof prev>) {
      if (key !== section) expect(next[key]).toEqual(prev[key])
    }
    expect(changed).toHaveBeenCalledOnce()
    expect(changed.mock.calls[0][0]).toBe(next)
    expect(changed.mock.calls[0][1]).toBe(prev)
    expect(changed.mock.calls[0][2]).toContain(`${section}.bindings.${section === "shortcuts" ? "takeScreenshot" : "toggleChat"}`)
    expect(changed.mock.calls[0][2].every((p: string) => p.startsWith(`${section}.`))).toBe(true)
    off()
    vi.advanceTimersByTime(150)
    expect(diskSettings()[section]).toEqual(DEFAULT_SETTINGS[section])
    expect(prev[section].bindings).not.toEqual({})
  })

  it("drops custom providers when resetting AI without touching unrelated data or secret files", () => {
    const secretFile = path.join(dir, "secrets.json")
    fs.writeFileSync(secretFile, "synthetic-secret-store-do-not-touch")
    service.set({
      ai: { activeProviderId: "custom", fallbackProviderIds: ["custom"], providers: {
        custom: { ...DEFAULT_SETTINGS.ai.providers.openai, id: "custom", name: "Custom", enabled: true },
      } },
      general: { theme: "light" },
      ollama: { lowModel: "custom-local-model" },
    })
    expect(service.getAll().ai.providers.custom).toBeDefined()
    const before = service.getAll()
    const next = service.reset("ai")
    expect(next.ai).toEqual(coerceSettings(DEFAULT_SETTINGS).ai)
    expect(next.general).toEqual(before.general)
    expect(next.ollama).toEqual(before.ollama)
    service.flushSync()
    expect(fs.readFileSync(secretFile, "utf-8")).toBe("synthetic-secret-store-do-not-touch")
    expect(diskSettings().ai.providers.custom).toBeUndefined()
  })

  it("coerces full reset defaults and only notifies when values change", () => {
    const change = vi.fn()
    service.onChange(change)
    service.reset("shortcuts")
    expect(change).not.toHaveBeenCalled()
    service.set({ general: { theme: "light" } })
    service.reset()
    expect(service.getAll()).toEqual(coerceSettings(DEFAULT_SETTINGS))
    expect(change).toHaveBeenCalledTimes(2)
  })
})

describe("settings persistence status and recovery", () => {
  it("debounces edits into one write and bounded pending/saved notifications", () => {
    const status = vi.fn()
    const off = service.onPersistenceChanged(status)
    const write = vi.spyOn(fs, "renameSync")
    expect(service.getPersistenceStatus()).toEqual({ state: "saved" })
    service.set({ general: { theme: "light" } })
    service.set({ shortcuts: { moveStep: 65 } })
    expect(service.getPersistenceStatus()).toEqual({ state: "pending" })
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(149)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledOnce()
    expect(status.mock.calls.map(([s]) => s.state)).toEqual(["pending", "saved"])
    expect(diskSettings().shortcuts.moveStep).toBe(65)
    const snapshot = service.getPersistenceStatus()
    snapshot.state = "failed"
    expect(service.getPersistenceStatus().state).toBe("saved")
    off()
    service.set({ general: { theme: "dark" } })
    service.flushSync()
    expect(status).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(["write", "fsync", "rename", "copy", "copy-fsync"] as const)("retains dirty state after %s failure and retries/reloads successfully", (stage) => {
    const before = diskSettings()
    const statuses: string[] = []
    service.onPersistenceChanged((s) => statuses.push(s.state))
    if (stage === "write") vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw failure() })
    if (stage === "fsync") vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw failure() })
    if (stage === "rename") vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw failure() })
    if (stage === "copy" || stage === "copy-fsync") {
      vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw failure("EXDEV") })
      if (stage === "copy") vi.spyOn(fs, "copyFileSync").mockImplementationOnce(() => { throw failure() })
      else vi.spyOn(fs, "fsyncSync")
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => { throw failure() })
    }
    service.set({ general: { theme: "light" } })
    vi.advanceTimersByTime(150)
    expect(service.getAll().general.theme).toBe("light")
    expect(service.getPersistenceStatus()).toEqual({
      state: "failed", error: "Settings are applied but could not be saved to disk. Retry saving.",
    })
    // A copy can have modified the target before its fsync fails. It is not atomic.
    if (stage !== "copy-fsync") expect(diskSettings()).toEqual(before)
    expect(fs.readdirSync(dir)).toEqual(["settings.json"])
    vi.advanceTimersByTime(60_000)
    expect(statuses).toEqual(["pending", "failed"])
    expect(service.retryPersistence()).toEqual({ state: "saved" })
    expect(statuses).toEqual(["pending", "failed", "pending", "saved"])
    expect(service.load().general.theme).toBe("light")
    expect(diskSettings().general.theme).toBe("light")
    const rename = vi.spyOn(fs, "renameSync")
    rename.mockClear()
    service.retryPersistence()
    expect(rename).not.toHaveBeenCalled()
  })

  it("keeps a repeated failure dirty and saves the latest state on a later edit", () => {
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw failure() })
    service.set({ general: { theme: "light" } })
    vi.advanceTimersByTime(150)
    expect(service.retryPersistence().state).toBe("failed")
    expect(rename).toHaveBeenCalledTimes(2)
    rename.mockRestore()
    service.set({ shortcuts: { moveStep: 123 } })
    vi.advanceTimersByTime(150)
    expect(service.getPersistenceStatus().state).toBe("saved")
    expect(diskSettings().general.theme).toBe("light")
    expect(diskSettings().shortcuts.moveStep).toBe(123)
  })

  it.each(["EXDEV", "EPERM", "EBUSY"])("uses the copy fallback for %s and fsyncs the copied target", (code) => {
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw failure(code) })
    const copy = vi.spyOn(fs, "copyFileSync")
    const sync = vi.spyOn(fs, "fsyncSync")
    service.set({ general: { theme: "light" } })
    service.flushSync()
    expect(copy).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledTimes(2)
    expect(service.getPersistenceStatus().state).toBe("saved")
    expect(diskSettings().general.theme).toBe("light")
    expect(fs.readdirSync(dir)).toEqual(["settings.json"])
  })

  it("completes short writes instead of persisting truncated JSON", () => {
    const realWrite = fs.writeSync.bind(fs)
    const write = vi.spyOn(fs, "writeSync").mockImplementationOnce((fd, data: any, offset: any) =>
      realWrite(fd, data, offset, 7)
    )
    service.set({ general: { theme: "light" } })
    service.flushSync()
    expect(write).toHaveBeenCalledTimes(2)
    expect(diskSettings().general.theme).toBe("light")
  })

  it("exposes startup write failures through the initial snapshot and recovers", async () => {
    fs.unlinkSync(file)
    vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw failure() })
    vi.resetModules()
    const { SettingsService } = await import("../electron/config/SettingsService")
    service = SettingsService.getInstance()
    expect(service.getPersistenceStatus().state).toBe("failed")
    expect(service.getAll()).toEqual(coerceSettings(DEFAULT_SETTINGS))
    expect(service.retryPersistence().state).toBe("saved")
    expect(diskSettings()).toEqual(coerceSettings(DEFAULT_SETTINGS))
  })
})
