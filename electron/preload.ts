import { contextBridge, ipcRenderer } from "electron"
import type { AppSettings, ShortcutActionId, Binding } from "./config/schema"
import type { ModelDiscoveryResult, ProviderHealth } from "./llm/providers"
import type {
  ShortcutsSnapshot,
  SetShortcutResult,
  RegistrationResult,
  RegistrationReport,
  ShortcutExport,
  ImportResult,
} from "./shortcuts/types"
import type { AcceleratorValidation } from "./shortcuts/validation"

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface ChatStreamHandlers {
  onToken?: (token: string) => void
  onDone?: (full: string) => void
  onError?: (error: string) => void
}

// Monotonic per-request id for streaming chat channels.
let chatSeq = 0

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  copyToClipboard: (text: string) => Promise<{ ok: boolean; error?: string }>
  /** Blink positional dots for a detected MCQ answer (letters A–E). Fire-and-forget. */
  showMcqHint: (letters: string[]) => void
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
  takeScreenshot: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  analyzeAudioFromBase64: (
    data: string,
    mimeType: string
  ) => Promise<{ text: string; timestamp: number }>
  analyzeAudioFile: (path: string) => Promise<{ text: string; timestamp: number }>
  getImageBase64: (path: string) => Promise<string>
  quitApp: () => Promise<void>
  /** Toggle whether the transparent overlay captures mouse clicks. */
  setMouseIgnore: (ignore: boolean) => void

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: string; model: string; isOllama: boolean }>
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
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (providerId?: string) => Promise<{ success: boolean; error?: string }>
  processScreenshotWithChoice: (
    analysisType: "analyze" | "answer"
  ) => Promise<{ success: boolean; error?: string }>
  cancelScreenshotProcessing: () => Promise<{ success: boolean; error?: string }>
  onScreenshotError: (callback: (data: { message: string; code?: string }) => void) => () => void
  getScreenPermission: () => Promise<string>
  openScreenRecordingSettings: () => Promise<{ ok: boolean }>

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
  chatStream: (message: string, handlers: ChatStreamHandlers) => () => void
}

// NOTE: a sandboxed preload (sandbox: true) cannot `require()` local modules, so
// these channel names are duplicated here rather than imported from ./events.
// They MUST stay in sync with electron/events.ts (the main-process source).
export const PROCESSING_EVENTS = {
  UNAUTHORIZED: "processing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error",
} as const

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) => ipcRenderer.invoke("delete-screenshot", path),
  copyToClipboard: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  showMcqHint: (letters: string[]) => ipcRenderer.send("mcq:hint", letters),

  // Event listeners
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions)
    ipcRenderer.on("solutions-ready", subscription)
    return () => {
      ipcRenderer.removeListener("solutions-ready", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("debug-success", subscription)
    return () => {
      ipcRenderer.removeListener("debug-success", subscription)
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    }
  },
  onScreenshotAnalysisStream: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("screenshot-analysis-stream", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-analysis-stream", subscription)
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  analyzeAudioFromBase64: (data: string, mimeType: string) =>
    ipcRenderer.invoke("analyze-audio-base64", data, mimeType),
  analyzeAudioFile: (path: string) => ipcRenderer.invoke("analyze-audio-file", path),
  getImageBase64: (path: string) => ipcRenderer.invoke("get-image-base64", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  setMouseIgnore: (ignore: boolean) => ipcRenderer.send("set-ignore-mouse-events", ignore),

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  getOllamaModelsDetailed: () => ipcRenderer.invoke("get-ollama-models-detailed"),
  getAiProviderModels: (providerId?: string) =>
    ipcRenderer.invoke("get-ai-provider-models", providerId),
  getAiProviderHealth: (providerId?: string) =>
    ipcRenderer.invoke("get-ai-provider-health", providerId),
  getAiProvidersHealth: () => ipcRenderer.invoke("get-ai-providers-health"),
  setAiProviderApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke("ai-provider:set-api-key", providerId, apiKey),
  getAiProviderSecretStatus: (providerId: string) =>
    ipcRenderer.invoke("ai-provider:secret-status", providerId),
  switchToOllama: (model?: string, url?: string) =>
    ipcRenderer.invoke("switch-to-ollama", model, url),
  testLlmConnection: (providerId?: string) => ipcRenderer.invoke("test-llm-connection", providerId),
  processScreenshotWithChoice: (analysisType: "analyze" | "answer") =>
    ipcRenderer.invoke("process-screenshot-with-choice", analysisType),
  cancelScreenshotProcessing: () => ipcRenderer.invoke("cancel-screenshot-processing"),
  onScreenshotError: (callback: (data: { message: string; code?: string }) => void) => {
    const subscription = (_: any, data: { message: string; code?: string }) => callback(data)
    ipcRenderer.on("screenshot-error", subscription)
    return () => ipcRenderer.removeListener("screenshot-error", subscription)
  },
  getScreenPermission: () => ipcRenderer.invoke("get-screen-permission"),
  openScreenRecordingSettings: () => ipcRenderer.invoke("open-screen-recording-settings"),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:getAll"),
  setSettings: (patch: DeepPartial<AppSettings>) => ipcRenderer.invoke("settings:set", patch),
  resetSettings: (section?: keyof AppSettings) => ipcRenderer.invoke("settings:reset", section),
  exportSettings: () => ipcRenderer.invoke("settings:export"),
  importSettings: (data: unknown) => ipcRenderer.invoke("settings:import", data),
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const subscription = (_: any, settings: AppSettings) => callback(settings)
    ipcRenderer.on("settings:changed", subscription)
    return () => ipcRenderer.removeListener("settings:changed", subscription)
  },

  // Shortcuts
  getShortcuts: () => ipcRenderer.invoke("shortcuts:getAll"),
  validateShortcut: (accel: string, excludeId?: ShortcutActionId) =>
    ipcRenderer.invoke("shortcuts:validate", accel, excludeId),
  setShortcut: (id: ShortcutActionId, accel: Binding) =>
    ipcRenderer.invoke("shortcuts:set", id, accel),
  resetShortcut: (id: ShortcutActionId) => ipcRenderer.invoke("shortcuts:resetOne", id),
  resetAllShortcuts: () => ipcRenderer.invoke("shortcuts:resetAll"),
  setMoveStep: (px: number) => ipcRenderer.invoke("shortcuts:setMoveStep", px),
  exportShortcuts: () => ipcRenderer.invoke("shortcuts:export"),
  importShortcuts: (data: unknown) => ipcRenderer.invoke("shortcuts:import", data),
  onShortcutsStatusChanged: (callback: (report: RegistrationReport) => void) => {
    const subscription = (_: any, report: RegistrationReport) => callback(report)
    ipcRenderer.on("shortcuts:status-changed", subscription)
    return () => ipcRenderer.removeListener("shortcuts:status-changed", subscription)
  },

  chatStream: (message: string, handlers: ChatStreamHandlers) => {
    const id = ++chatSeq
    const onToken = (_: any, t: string) => handlers.onToken?.(t)
    const cleanup = () => {
      ipcRenderer.removeListener(`llm:token:${id}`, onToken)
      ipcRenderer.removeAllListeners(`llm:done:${id}`)
      ipcRenderer.removeAllListeners(`llm:error:${id}`)
    }
    ipcRenderer.on(`llm:token:${id}`, onToken)
    ipcRenderer.once(`llm:done:${id}`, (_: any, full: string) => {
      cleanup()
      handlers.onDone?.(full)
    })
    ipcRenderer.once(`llm:error:${id}`, (_: any, err: string) => {
      cleanup()
      handlers.onError?.(err)
    })
    ipcRenderer.send("llm:chatStream", { id, message })
    return () => {
      ipcRenderer.send("llm:chatCancel", id)
      cleanup()
    }
  },
} as ElectronAPI)
