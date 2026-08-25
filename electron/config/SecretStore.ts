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
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(id)
}

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
    return Boolean(this.load().providers[providerId]) || Boolean(STATIC_PROVIDER_KEYS[providerId])
  }

  getProviderApiKey(providerId: string): string | null {
    if (!isProviderId(providerId)) return null
    const entry = this.load().providers[providerId]
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
    return STATIC_PROVIDER_KEYS[providerId] ?? null
  }

  setProviderApiKey(providerId: string, value: string): { ok: boolean; error?: string } {
    if (!isProviderId(providerId)) return { ok: false, error: "Invalid provider id." }
    const secrets = this.load()
    const trimmed = value.trim()
    if (!trimmed) {
      delete secrets.providers[providerId]
      this.write(secrets)
      return { ok: true }
    }
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
    this.write(secrets)
    return { ok: true }
  }

  deleteProviderApiKey(providerId: string): { ok: boolean; error?: string } {
    return this.setProviderApiKey(providerId, "")
  }

  private load(): SecretsFile {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as Partial<SecretsFile>
      const providers =
        parsed && typeof parsed.providers === "object" && parsed.providers !== null
          ? parsed.providers
          : {}
      this.cache = { version: 1, providers: providers as Record<string, StoredSecret> }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error("[SecretStore] Failed to read secrets, starting empty:", err)
      }
      this.cache = { version: 1, providers: {} }
    }
    return this.cache
  }

  private write(secrets: SecretsFile): void {
    const dir = path.dirname(this.filePath)
    const tmp = `${this.filePath}.${process.pid}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true })
      const fd = fs.openSync(tmp, "w", 0o600)
      try {
        fs.writeSync(fd, JSON.stringify(secrets, null, 2))
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
      try {
        fs.chmodSync(this.filePath, 0o600)
      } catch {
        /* best effort on platforms without POSIX modes */
      }
      this.cache = secrets
    } catch (err) {
      console.error("[SecretStore] Failed to write secrets:", err)
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      } catch {
        /* ignore cleanup failure */
      }
    }
  }
}
