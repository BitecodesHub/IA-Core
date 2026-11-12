import fs from "node:fs"
import path from "node:path"
import { app, safeStorage } from "electron"
import { STATIC_PROVIDER_KEYS } from "./staticKeys"

interface StoredSecret {
  encoding: "safeStorage"
  value: string
  updatedAt: string
}

interface SecretsFile {
  version: 1
  providers: Record<string, StoredSecret>
}

function isProviderId(id: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id)
}

function ownEntry<T>(map: Record<string, T>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined
}

type SaveResult = { ok: boolean; error?: string }

/**
 * OS-backed provider secret persistence.
 *
 * Secrets are intentionally kept outside AppSettings so the renderer never
 * receives encrypted or plaintext API keys through settings:getAll/export.
 */
export class SecretStore {
  private static instance: SecretStore | null = null
  private readonly filePath: string
  private cache: SecretsFile | null = null

  private constructor() {
    this.filePath = path.join(app.getPath("userData"), "secrets.json")
  }

  static getInstance(): SecretStore {
    if (!SecretStore.instance) SecretStore.instance = new SecretStore()
    return SecretStore.instance
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  hasProviderApiKey(providerId: string): boolean {
    if (!isProviderId(providerId)) return false
    return Boolean(ownEntry(this.load().providers, providerId)) || Boolean(ownEntry(STATIC_PROVIDER_KEYS, providerId))
  }

  getProviderApiKey(providerId: string): string | null {
    if (!isProviderId(providerId)) return null
    const entry = ownEntry(this.load().providers, providerId)
    if (entry) {
      try {
        return safeStorage.decryptString(Buffer.from(entry.value, "base64"))
      } catch (err) {
        // safeStorage ciphertext is bound to the app's code identity; after a
        // rebuild/re-sign it can no longer be decrypted. Fall through to the
        // static fallback instead of failing. Log only in development.
        if (process.env.NODE_ENV === "development") {
          console.error(`[SecretStore] Failed to decrypt key for ${providerId}:`, err)
        }
      }
    }
    // Static fallback (see staticKeys.ts): keeps online mode working with no
    // stored key and across rebuilds. A stored, decryptable key above wins.
    return ownEntry(STATIC_PROVIDER_KEYS, providerId) ?? null
  }

  setProviderApiKey(providerId: string, value: string): SaveResult {
    if (!isProviderId(providerId)) return { ok: false, error: "Invalid provider id." }
    const secrets: SecretsFile = { version: 1, providers: { ...this.load().providers } }
    const trimmed = value.trim()
    if (!trimmed) {
      delete secrets.providers[providerId]
      return this.write(secrets)
    }
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          ok: false,
          error: "Secure storage is unavailable on this operating system session.",
        }
      }
      const encrypted = safeStorage.encryptString(trimmed).toString("base64")
      secrets.providers[providerId] = {
        encoding: "safeStorage",
        value: encrypted,
        updatedAt: new Date().toISOString(),
      }
    } catch {
      return { ok: false, error: "Could not encrypt provider credentials." }
    }
    return this.write(secrets)
  }

  deleteProviderApiKey(providerId: string): { ok: boolean; error?: string } {
    return this.setProviderApiKey(providerId, "")
  }

  private load(): SecretsFile {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<SecretsFile>
      const raw = parsed && Object.prototype.hasOwnProperty.call(parsed, "providers")
        && typeof parsed.providers === "object" && parsed.providers !== null && !Array.isArray(parsed.providers)
        ? parsed.providers : {}
      const providers: Record<string, StoredSecret> = {}
      for (const [id, entry] of Object.entries(raw)) {
        if (!isProviderId(id) || !entry || entry.encoding !== "safeStorage"
          || typeof entry.value !== "string" || typeof entry.updatedAt !== "string") continue
        providers[id] = { encoding: "safeStorage", value: entry.value, updatedAt: entry.updatedAt }
      }
      this.cache = { version: 1, providers }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error("[SecretStore] Failed to read secrets, starting empty:", err)
      }
      this.cache = { version: 1, providers: {} }
    }
    return this.cache
  }

  private write(secrets: SecretsFile): SaveResult {
    const dir = path.dirname(this.filePath)
    const tmp = `${this.filePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      const fd = fs.openSync(tmp, "w", 0o600)
      try {
        const data = Buffer.from(JSON.stringify(secrets, null, 2))
        let offset = 0
        while (offset < data.length) {
          const written = fs.writeSync(fd, data, offset, data.length - offset)
          if (written <= 0) throw new Error("Credential write made no progress")
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
          // Compatibility fallback, not an atomic replacement. A failed copy
          // may leave the destination damaged; never publish it to the cache.
          fs.copyFileSync(tmp, this.filePath)
          const copied = fs.openSync(this.filePath, "r+")
          try {
            fs.fsyncSync(copied)
          } finally {
            fs.closeSync(copied)
          }
          try {
            fs.unlinkSync(tmp)
          } catch {}
        } else {
          throw renameErr
        }
      }
      try {
        fs.chmodSync(this.filePath, 0o600)
      } catch {
        /* best effort on platforms without POSIX modes */
      }
      this.cache = secrets
      return { ok: true }
    } catch (err) {
      console.error("[SecretStore] Failed to write secrets:", err)
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      } catch {
        /* ignore cleanup failure */
      }
      return { ok: false, error: "Could not save provider credentials to disk. Please retry." }
    }
  }
}
