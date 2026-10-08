// Single canonical declaration of the preload bridge surface exposed on
// `window.electronAPI`. Keep this in sync with electron/preload.ts.
import type { AppSettings, ShortcutActionId, Binding } from "./settings"
import type { BitecodesAuthState } from "../../electron/bitecodesAuth"
import type {
  ShortcutsSnapshot,
  SetShortcutResult,
  RegistrationResult,
  RegistrationReport,
  ShortcutExport,
  ImportResult,
} from "../../electron/shortcuts/types"
import type { AcceleratorValidation } from "../../electron/shortcuts/validation"
import type { ModelDiscoveryResult, ProviderHealth } from "../../electron/llm/providers"
import type { PermissionReport } from "../../electron/permissions"

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface ElectronAPI {
  // Window + screenshots
  updateContentDimensions: (dimensions: { width: number; height: number; center?: boolean }) => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  copyToClipboard: (text: string) => Promise<{ ok: boolean; error?: string }>
  /** Blink positional dots for a detected MCQ answer (letters A–E). Fire-and-forget. */
  showMcqHint: (letters: string[]) => void
  takeScreenshot: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  quitApp: () => Promise<void>
  setMouseIgnore: (ignore: boolean) => void

  // Event subscriptions (return an unsubscribe fn)
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onScreenshotAnalysisStream: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void

  // Audio / image
  analyzeAudioFromBase64: (
    data: string,
    mimeType: string
  ) => Promise<{ text: string; timestamp: number }>
  analyzeAudioFile: (path: string) => Promise<{ text: string; timestamp: number }>
  getImageBase64: (path: string) => Promise<string>
  processScreenshotWithChoice: (
    analysisType: "analyze" | "answer"
  ) => Promise<{ success: boolean; error?: string }>
  cancelScreenshotProcessing: () => Promise<{ success: boolean; error?: string }>
  onScreenshotError: (
    callback: (data: { message: string; code?: string; actionable?: boolean }) => void
  ) => () => void
  getScreenPermission: () => Promise<string>
  getPermissions: () => Promise<PermissionReport>
  refreshPermissions: () => Promise<PermissionReport>
  onPermissionsChanged: (callback: (report: PermissionReport) => void) => () => void
  openPrivacySettings: (kind: "screen" | "microphone") => Promise<{ ok: boolean }>
  openScreenRecordingSettings: () => Promise<{ ok: boolean }>

  // LLM model management
  getCurrentLlmConfig: () => Promise<{
    provider: string
    model: string
    isOllama: boolean
  }>
  getAvailableOllamaModels: () => Promise<string[]>
  getOllamaModelsDetailed: () => Promise<Array<{ name: string; vision: boolean }>>
  getAiProviderModels: (providerId?: string) => Promise<ModelDiscoveryResult>
  getAiProviderHealth: (providerId?: string) => Promise<ProviderHealth>
  getAiProvidersHealth: () => Promise<ProviderHealth[]>
  setAiProviderApiKey: (
    providerId: string,
    apiKey: string
  ) => Promise<{ ok: boolean; error?: string }>
  getAiProviderSecretStatus: (providerId: string) => Promise<{
    providerId: string
    hasApiKey: boolean
    secureStorageAvailable: boolean
  }>
  bitecodesStatus: () => Promise<BitecodesAuthState>
  bitecodesLogin: () => Promise<BitecodesAuthState>
  bitecodesCancel: () => Promise<BitecodesAuthState>
  bitecodesReopen: () => Promise<void>
  bitecodesLogout: () => Promise<BitecodesAuthState>
  onBitecodesChanged: (callback: (state: BitecodesAuthState) => void) => () => void
  getAiProviderSecretStatusAll: () => Promise<
    Array<{ providerId: string; hasApiKey: boolean; secureStorageAvailable: boolean }>
  >
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (
    providerId?: string
  ) => Promise<{ success: boolean; error?: string; warning?: string }>

  // Settings
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: DeepPartial<AppSettings>) => Promise<AppSettings>
  resetSettings: (section?: keyof AppSettings) => Promise<AppSettings>
  exportSettings: () => Promise<unknown>
  importSettings: (
    data: unknown
  ) => Promise<{ ok: boolean; settings?: AppSettings; error?: string }>
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

  // Shortcuts
  getShortcuts: () => Promise<ShortcutsSnapshot>
  validateShortcut: (
    accel: string,
    excludeId?: ShortcutActionId
  ) => Promise<AcceleratorValidation & { conflictsWith?: string }>
  setShortcut: (id: ShortcutActionId, accel: Binding) => Promise<SetShortcutResult>
  resetShortcut: (id: ShortcutActionId) => Promise<RegistrationResult>
  resetAllShortcuts: () => Promise<RegistrationReport>
  setMoveStep: (px: number) => Promise<{ ok: boolean; moveStep: number }>
  exportShortcuts: () => Promise<ShortcutExport>
  importShortcuts: (data: unknown) => Promise<ImportResult>
  onShortcutsStatusChanged: (callback: (report: RegistrationReport) => void) => () => void

  /** Streamed local chat. Returns a cancel function. */
  chatStream: (
    message: string,
    handlers: {
      onToken?: (token: string) => void
      onDone?: (full: string) => void
      onError?: (error: string) => void
    }
  ) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
