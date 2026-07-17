// Renderer-facing settings types. These re-export the canonical types from the
// Electron-owned schema so there is exactly one source of truth. This is a
// type-only re-export and is fully erased at build time (no runtime coupling).
export type {
  AppSettings,
  AISettings,
  AiProviderSettings,
  AiProviderType,
  AiCapability,
  OllamaSettings,
  ReasoningMode,
  AudioSettings,
  WindowSettings,
  ShortcutSettings,
  LocalShortcutSettings,
  GeneralSettings,
  ShortcutActionId,
  LocalShortcutActionId,
  Accelerator,
  Binding,
} from "../../electron/config/schema"
