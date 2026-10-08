// Update checks against the Bitecodes update feed (/api/v1/desktop/version).
//
// Builds are unsigned and the source repo is private, so a silent auto-install
// is not possible (macOS refuses unsigned updates). Instead the app checks on
// launch and every 6 hours, offers the download for this platform, and — if
// the operator set a minimum version — blocks use until the user updates.

import { app, shell } from "electron"
import { SettingsService } from "./config/SettingsService"
import { BITECODES_DEFAULT_ENDPOINT, isAllowedBitecodesEndpoint } from "./llm/bitecodes"

export interface UpdateState {
  currentVersion: string
  latestVersion: string | null
  notes: string | null
  updateAvailable: boolean
  updateRequired: boolean
  /** Whether a download link exists for this platform (the URL stays in main). */
  canDownload: boolean
  checkedAt: number | null
}

type Listener = (state: UpdateState) => void

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export class UpdateChecker {
  private static instance: UpdateChecker | null = null
  static getInstance(): UpdateChecker {
    if (!UpdateChecker.instance) UpdateChecker.instance = new UpdateChecker()
    return UpdateChecker.instance
  }

  private state: UpdateState = {
    currentVersion: app.getVersion(),
    latestVersion: null,
    notes: null,
    updateAvailable: false,
    updateRequired: false,
    canDownload: false,
    checkedAt: null,
  }
  private downloadUrl: string | null = null
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  get(): UpdateState {
    return this.state
  }

  /** True when the operator requires a newer build before the app may be used. */
  isUpdateRequired(): boolean {
    return this.state.updateRequired
  }

  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
    this.timer.unref?.()
  }

  private endpoint(): string {
    const configured = SettingsService.getInstance().get("ai").providers.bitecodes?.endpoint
    return configured && isAllowedBitecodesEndpoint(configured) ? configured : BITECODES_DEFAULT_ENDPOINT
  }

  async check(): Promise<UpdateState> {
    try {
      const q = new URLSearchParams({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      })
      const res = await fetch(`${this.endpoint().replace(/\/+$/, "")}/api/v1/desktop/version?${q}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return this.state
      const d: any = await res.json()
      const url = typeof d?.downloadUrl === "string" ? d.downloadUrl : null
      this.downloadUrl = url && /^https:\/\//i.test(url) ? url : null
      this.set({
        currentVersion: app.getVersion(),
        latestVersion: typeof d?.latestVersion === "string" ? d.latestVersion : null,
        notes: typeof d?.notes === "string" ? d.notes.slice(0, 2000) : null,
        updateAvailable: Boolean(d?.updateAvailable),
        updateRequired: Boolean(d?.updateRequired),
        canDownload: Boolean(this.downloadUrl),
        checkedAt: Date.now(),
      })
    } catch {
      /* offline: keep the last known state; never block on a failed check */
    }
    return this.state
  }

  /** Opens this platform's download in the browser. */
  download(): boolean {
    if (!this.downloadUrl) return false
    void shell.openExternal(this.downloadUrl).catch(() => {})
    return true
  }

  private set(next: UpdateState) {
    this.state = next
    for (const l of this.listeners) {
      try {
        l(next)
      } catch {
        /* ignore */
      }
    }
  }
}
