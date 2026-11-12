import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SecretStore as Store } from "../electron/config/SecretStore"

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  },
}))
vi.mock("electron", () => electron)
vi.mock("../electron/config/staticKeys", () => ({ STATIC_PROVIDER_KEYS: {} }))
let dir: string
let store: Store

beforeEach(async () => {
  vi.resetModules()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-secret-test-"))
  electron.app.getPath.mockReturnValue(dir)
  electron.safeStorage.isEncryptionAvailable.mockReturnValue(true)
  vi.spyOn(console, "error").mockImplementation(() => {})
  const { SecretStore } = await import("../electron/config/SecretStore")
  store = SecretStore.getInstance()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("SecretStore durability", () => {
  it("preserves the last saved cache and disk value when replacement fails", () => {
    expect(store.setProviderApiKey("test", "synthetic-old").ok).toBe(true)
    const before = fs.readFileSync(path.join(dir, "secrets.json"), "utf8")
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("synthetic failure") })
    expect(store.setProviderApiKey("test", "synthetic-new").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBe("synthetic-old")
    expect(fs.readFileSync(path.join(dir, "secrets.json"), "utf8")).toBe(before)
  })

  it("does not report failed deletion as success", () => {
    store.setProviderApiKey("test", "synthetic-old")
    vi.spyOn(fs, "openSync").mockImplementationOnce(() => { throw new Error("synthetic disk failure") })
    expect(store.deleteProviderApiKey("test").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBe("synthetic-old")
    expect(store.deleteProviderApiKey("test").ok).toBe(true)
    expect(store.getProviderApiKey("test")).toBeNull()
  })

  it("finishes partial writes before publishing a saved value", () => {
    const write = fs.writeSync.bind(fs)
    vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, data: Buffer, offset: number, length: number) =>
      write(fd, data, offset, Math.min(length, 7))) as typeof fs.writeSync)
    expect(store.setProviderApiKey("test", "synthetic-value").ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"), "utf8")).providers.test).toBeDefined()
  })

  it("fails rather than looping if a write makes no progress", () => {
    vi.spyOn(fs, "writeSync").mockReturnValueOnce(0)
    expect(store.setProviderApiKey("test", "synthetic-value").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBeNull()
  })

  it("does not publish credentials when encryption fails", () => {
    store.setProviderApiKey("test", "synthetic-old")
    electron.safeStorage.encryptString.mockImplementationOnce(() => { throw new Error("synthetic encryption failure") })
    expect(store.setProviderApiKey("test", "synthetic-new").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBe("synthetic-old")
  })

  it("preserves the saved value when syncing the temporary file fails", () => {
    store.setProviderApiKey("test", "synthetic-old")
    const before = fs.readFileSync(path.join(dir, "secrets.json"), "utf8")
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error("synthetic sync failure") })
    expect(store.setProviderApiKey("test", "synthetic-new").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBe("synthetic-old")
    expect(fs.readFileSync(path.join(dir, "secrets.json"), "utf8")).toBe(before)
  })

  it("reports fallback copy failure and preserves the cached value", () => {
    store.setProviderApiKey("test", "synthetic-old")
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw Object.assign(new Error("synthetic rename failure"), { code: "EPERM" }) })
    vi.spyOn(fs, "copyFileSync").mockImplementationOnce(() => { throw new Error("synthetic copy failure") })
    expect(store.setProviderApiKey("test", "synthetic-new").ok).toBe(false)
    expect(store.getProviderApiKey("test")).toBe("synthetic-old")
  })

  it("rejects reserved keys and unavailable encryption", () => {
    expect(store.setProviderApiKey("__proto__", "synthetic").ok).toBe(false)
    expect(store.getProviderApiKey("constructor")).toBeNull()
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(store.setProviderApiKey("test", "synthetic").ok).toBe(false)
    expect(fs.existsSync(path.join(dir, "secrets.json"))).toBe(false)
  })
})
