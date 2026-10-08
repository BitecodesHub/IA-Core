// Canonical settings schema for IA-Core.
//
// This file is the single source of truth for the application settings shape,
// defaults, and value coercion. The Electron main process owns it; the renderer
// imports the TYPES only (see `src/types/settings.ts`), so there is no runtime
import { bedrockRegionOf } from "../llm/bedrockRegions"
import { BITECODES_DEFAULT_ENDPOINT, isAllowedBitecodesEndpoint } from "../llm/bitecodes"
// coupling and no cross-tree build emit.
//
// Coercion philosophy: settings must never crash the app. `coerceSettings()`
// always returns a fully-valid `AppSettings`, clamping or replacing any invalid
// value with a sane default rather than throwing. This is what makes persisted
// settings resilient to corruption, hand-editing, and forward/backward changes.

export const SETTINGS_VERSION = 7

export type ShortcutActionId =
  | "toggleWindow"
  | "showWindow"
  | "takeScreenshot"
  | "process"
  | "reset"
  | "toggleMode"
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"

export type LocalShortcutActionId =
  | "toggleChat"
  | "toggleSettings"
  | "focusChat"
  | "closePanels"
  | "stopGeneration"

/** An Electron accelerator string, e.g. "CommandOrControl+B". `null` = explicitly disabled. */
export type Accelerator = string
export type Binding = Accelerator | null

/** Which reasoning tier the router uses. "auto" picks per-task via a heuristic. */
export type ReasoningMode = "auto" | "low" | "high"
export type AiProviderType =
  | "ollama"
  | "openai-compatible"
  | "vertex-gemini"
  | "bedrock-converse"
  | "bitecodes"
export type AiCapability = "text" | "vision" | "json" | "streaming"

export interface AiProviderSettings {
  id: string
  name: string
  type: AiProviderType
  enabled: boolean
  /**
   * For Ollama this must remain loopback/private LAN. For OpenAI-compatible
   * providers, external HTTPS endpoints are accepted only when allowRemote is
   * explicitly enabled.
   */
  endpoint: string
  allowRemote: boolean
  apiKeyRequired: boolean
  lowModel: string
  highModel: string
  visionModel: string
  /**
   * Ordered fallback model slugs tried after the primary model. Only meaningful
   * for OpenRouter (sent as its native `models` array so it fails over server-side
   * on rate-limit/downtime). Empty for other providers.
   */
  fallbackModels: string[]
  temperature: number
  topP: number
  topK: number
  numCtx: number
  numPredict: number
  timeoutMs: number
  keepAlive: string
}

export interface AISettings {
  activeProviderId: string
  /** Ordered fallback providers tried after the active provider fails. */
  fallbackProviderIds: string[]
  reasoningMode: ReasoningMode
  requestRetries: number
  healthCheckOnStart: boolean
  providers: Record<string, AiProviderSettings>
}

export interface OllamaSettings {
  endpoint: string
  /** Fast/lightweight model for simple tasks; kept warm. */
  lowModel: string
  /** Stronger model for complex/multi-step tasks; loaded on demand. */
  highModel: string
  /** Vision-capable model for screenshot/image analysis. */
  visionModel: string
  /** auto = choose low/high per task; low/high = force a tier. */
  reasoningMode: ReasoningMode
  temperature: number
  topP: number
  topK: number
  numCtx: number
  /** Cap on generated tokens per response. Bounds vision-answer latency. */
  numPredict: number
  timeoutMs: number
  keepAlive: string
}

export interface AudioSettings {
  enabled: boolean
  whisperModel: string
  language: string
  translate: boolean
  autoAnalyze: boolean
  maxDurationSec: number
}

export interface WindowSettings {
  position: { x: number; y: number } | null
  size: { width: number; height: number }
  opacity: number
  alwaysOnTop: boolean
  contentProtection: boolean
  skipTaskbar: boolean
  trayEnabled: boolean
  hiddenInMissionControl: boolean
}

export interface ShortcutSettings {
  /** Sparse: only user overrides are stored. Effective binding = override ?? default. */
  bindings: Partial<Record<ShortcutActionId, Binding>>
  /** Pixels moved per window-move action. */
  moveStep: number
}

export interface LocalShortcutSettings {
  /** Sparse local/in-window shortcut overrides. */
  bindings: Partial<Record<LocalShortcutActionId, Binding>>
}

export interface GeneralSettings {
  theme: "dark" | "light" | "system"
  startMinimized: boolean
  telemetry: boolean
  /** Preload the vision model at launch so the first screenshot is warm. Costs
   * idle RAM; on by default for speed, can be disabled on RAM-constrained machines. */
  warmModelOnStart: boolean
}

export interface AppSettings {
  version: number
  ai: AISettings
  ollama: OllamaSettings
  audio: AudioSettings
  window: WindowSettings
  shortcuts: ShortcutSettings
  localShortcuts: LocalShortcutSettings
  general: GeneralSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  ai: {
    // The Bitecodes model is the default; it needs a one-time browser sign-in.
    activeProviderId: "bitecodes",
    fallbackProviderIds: [],
    reasoningMode: "auto",
    requestRetries: 1,
    healthCheckOnStart: true,
    providers: {
      // Default provider: requests go to the user's Bitecodes account, which
      // routes them through the operator's upstream providers. The model is
      // chosen server-side and never shown, so the slots hold a placeholder.
      bitecodes: {
        id: "bitecodes",
        name: "Bitecodes",
        type: "bitecodes",
        enabled: true,
        endpoint: BITECODES_DEFAULT_ENDPOINT,
        allowRemote: true,
        apiKeyRequired: true,
        lowModel: "bitecodes",
        highModel: "bitecodes",
        visionModel: "bitecodes",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        // Screenshots run two model calls server-side (read, then solve).
        timeoutMs: 300000,
        keepAlive: "30m",
      },
      ollama: {
        id: "ollama",
        name: "Ollama",
        type: "ollama",
        enabled: true,
        endpoint: "http://localhost:11434",
        allowRemote: false,
        apiKeyRequired: false,
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Online mode. OpenRouter speaks the OpenAI-compatible protocol, so it
      // reuses OpenAICompatibleProvider. Its HTTPS endpoint survives the SSRF
      // guard only because type is openai-compatible AND allowRemote is true.
      // The API key lives in SecretStore (safeStorage), never in this file.
      openrouter: {
        id: "openrouter",
        name: "OpenRouter",
        type: "openai-compatible",
        enabled: true,
        endpoint: "https://openrouter.ai/api/v1",
        allowRemote: true,
        apiKeyRequired: true,
        lowModel: "anthropic/claude-sonnet-5",
        highModel: "anthropic/claude-sonnet-5",
        visionModel: "anthropic/claude-sonnet-5",
        // Fallback chain (OpenRouter native `models` array): if Sonnet fails/rate-limits,
        // fail over to latest Opus, then to gpt-oss-120b. (gpt-oss-120b is text-only, so it
        // only helps text/chat, not screenshot vision.)
        fallbackModels: ["anthropic/claude-opus-4.8", "openai/gpt-oss-120b"],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Direct OpenAI. Strong all-round vision baseline.
      openai: {
        id: "openai",
        name: "OpenAI",
        type: "openai-compatible",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://api.openai.com/v1",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Gemini via Google's OpenAI-compatibility endpoint. Strong OCR on dense screenshots.
      gemini: {
        id: "gemini",
        name: "Google Gemini",
        type: "openai-compatible",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Groq. Lowest latency of the hosted options, which matters most on the capture-to-answer path.
      groq: {
        id: "groq",
        name: "Groq",
        type: "openai-compatible",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://api.groq.com/openai/v1",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // NVIDIA NIM (build.nvidia.com).
      nvidia: {
        id: "nvidia",
        name: "NVIDIA NIM",
        type: "openai-compatible",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://integrate.api.nvidia.com/v1",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Sharon AI Inference Engine (Australian GPU cloud). TokenVisor gateway;
      // personal access tokens look like tv-pat-…
      sharonai: {
        id: "sharonai",
        name: "Sharon AI",
        type: "openai-compatible",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://inference.sharonai.cloud/api/v1",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Google Vertex AI (Express-mode API key), served from Sydney. Default
      // model Gemini 2.5 Flash: fast, strong, and reads screenshots in ~3s.
      vertex: {
        id: "vertex",
        name: "Google Vertex AI",
        type: "vertex-gemini",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://australia-southeast1-aiplatform.googleapis.com/v1",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "gemini-2.5-flash",
        highModel: "gemini-2.5-flash",
        visionModel: "gemini-2.5-flash",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
      // Amazon Bedrock via a Bedrock API key (bearer token), Converse API, Sydney
      // region by default (selectable). Model slots stay on Auto: what is invocable
      // depends on the account's model access and region, so discovery decides.
      bedrock: {
        id: "bedrock",
        name: "Amazon Bedrock",
        type: "bedrock-converse",
        // Disabled until the user supplies a key: an enabled provider with no
        // key would surface as a spurious health-check failure at startup.
        enabled: false,
        endpoint: "https://bedrock-runtime.ap-southeast-2.amazonaws.com",
        allowRemote: true,
        apiKeyRequired: true,
        // Model slots are intentionally left on Auto. Every one of these
        // providers exposes /models, so the searchable picker fills itself in
        // after Discover — and hard-coding IDs here would rot as they rename
        // and retire models.
        lowModel: "",
        highModel: "",
        visionModel: "",
        fallbackModels: [],
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 4096,
        numPredict: 4096,
        timeoutMs: 120000,
        keepAlive: "30m",
      },
    },
  },
  ollama: {
    endpoint: "http://localhost:11434",
    lowModel: "",
    highModel: "",
    visionModel: "",
    reasoningMode: "auto",
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    numCtx: 4096,
    numPredict: 4096,
    timeoutMs: 120000,
    keepAlive: "30m",
  },
  audio: {
    enabled: true,
    whisperModel: "base.en",
    language: "auto",
    translate: false,
    autoAnalyze: true,
    maxDurationSec: 120,
  },
  window: {
    position: null,
    size: { width: 400, height: 600 },
    opacity: 1,
    alwaysOnTop: true,
    contentProtection: true,
    skipTaskbar: true,
    // Stealth default: even an empty-image tray reserves a real, hoverable menu-bar
    // slot with a tooltip and context menu. Every tray action has a global-shortcut
    // equivalent, so no functionality is lost by leaving this off by default.
    trayEnabled: false,
    hiddenInMissionControl: true,
  },
  shortcuts: {
    bindings: {},
    moveStep: 50,
  },
  localShortcuts: {
    bindings: {},
  },
  general: {
    theme: "dark",
    startMinimized: false,
    telemetry: false,
    warmModelOnStart: true,
  },
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def
  return Math.min(max, Math.max(min, n))
}

function int(v: unknown, def: number, min: number, max: number): number {
  return Math.round(num(v, def, min, max))
}

function str(v: unknown, def: string): string {
  return typeof v === "string" ? v : def
}

/**
 * Validate an Ollama endpoint URL. This is a security boundary: the endpoint is
 * used in fetch() calls that carry screenshots and transcripts, so a renderer
 * (via settings:set) must not be able to redirect that traffic to an arbitrary
 * host. Accept only http(s) pointing at a loopback/private host; otherwise fall
 * back to the default. Preserves the local-only guarantee.
 */
export function coerceEndpoint(v: unknown, def: string): string {
  if (typeof v !== "string") return def
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return def
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return def
  const host = url.hostname.toLowerCase()
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost")
  // Private LAN ranges (a self-hosted Ollama on the same network is legitimate).
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host.endsWith(".local")
  if (!isLoopback && !isPrivate) return def
  return v
}

export function coerceProviderEndpoint(
  type: AiProviderType,
  v: unknown,
  def: string,
  allowRemote: boolean
): string {
  // Bedrock: region is user-selectable, but the endpoint receives the API key and
  // every screenshot, so it must be a genuine AWS Bedrock runtime host.
  if (type === "bitecodes") {
    return typeof v === "string" && isAllowedBitecodesEndpoint(v) ? v.replace(/\/+$/, "") : def
  }
  if (type === "bedrock-converse") {
    return typeof v === "string" && bedrockRegionOf(v) ? v.replace(/\/+$/, "") : def
  }
  if (type === "ollama" || !allowRemote) return coerceEndpoint(v, def)
  if (typeof v !== "string") return def
  let url: URL
  try {
    url = new URL(v)
  } catch {
    return def
  }
  if (url.protocol === "https:") return v
  // Allow HTTP only for local/self-hosted OpenAI-compatible endpoints.
  return coerceEndpoint(v, def)
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def
}

function oneOf<T extends string>(v: unknown, def: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def
}

function providerId(v: unknown, def: string): string {
  if (typeof v !== "string") return def
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(v) ? v : def
}

/** Coerce to an array of non-empty strings, capped and de-duplicated. */
function strArray(v: unknown, def: string[]): string[] {
  if (!Array.isArray(v)) return def
  const out = Array.from(
    new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0))
  )
  return out.slice(0, 16)
}

/**
 * Managed cloud providers whose endpoint is fixed. Pinning prevents the renderer
 * (via settings:set) from redirecting a stored API key and screenshots to an
 * attacker-controlled host — the same threat the loopback/LAN guard addresses for
 * Ollama. Users who need a custom remote endpoint use the generic
 * "openai-compatible" provider, which remains freely configurable.
 *
 * The pin is applied in `coerceSettings` keyed on the provider MAP KEY (the slot
 * id), not on the coercible inner `id` field — otherwise a hostile blob could
 * store `{openrouter: {id: "x", endpoint: "https://evil"}}` and slip past the pin
 * while still resolving to the openrouter provider (and its stored key).
 */
/**
 * Shape used to coerce a provider id that is not one of the bundled defaults
 * (e.g. a user-added custom endpoint, or one imported from an older settings
 * file). Previously the generic "openai-compatible" default entry doubled as
 * this template; it has been removed as a selectable provider, so the template
 * now stands on its own. A custom provider is OpenAI-compatible, disabled, and
 * requires remote to be opted into per endpoint.
 */
export const CUSTOM_PROVIDER_TEMPLATE: Omit<AiProviderSettings, "id" | "name"> = {
  type: "openai-compatible",
  enabled: false,
  endpoint: "http://localhost:1234/v1",
  allowRemote: false,
  apiKeyRequired: false,
  lowModel: "",
  highModel: "",
  visionModel: "",
  fallbackModels: [],
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  numCtx: 4096,
  numPredict: 4096,
  timeoutMs: 120000,
  keepAlive: "30m",
}

export const PINNED_PROVIDER_ENDPOINTS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  // Google's OpenAI-compatibility surface, so Gemini reuses
  // OpenAICompatibleProvider instead of needing a native client.
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  // NVIDIA NIM / build.nvidia.com.
  nvidia: "https://integrate.api.nvidia.com/v1",
  // Sharon AI Inference Engine (TokenVisor gateway, OpenAI-compatible).
  sharonai: "https://inference.sharonai.cloud/api/v1",
  // Vertex AI, Sydney region (australia-southeast1) — native Gemini API.
  vertex: "https://australia-southeast1-aiplatform.googleapis.com/v1",
}

function coerceProvider(raw: unknown, def: AiProviderSettings): AiProviderSettings {
  const r = isObject(raw) ? raw : {}
  const type = oneOf(r.type, def.type, ["ollama", "openai-compatible", "vertex-gemini", "bedrock-converse", "bitecodes"] as const)
  const allowRemote = type !== "ollama" ? bool(r.allowRemote, def.allowRemote) : false
  return {
    id: providerId(r.id, def.id),
    name: str(r.name, def.name).slice(0, 80) || def.name,
    type,
    enabled: bool(r.enabled, def.enabled),
    endpoint: coerceProviderEndpoint(type, r.endpoint, def.endpoint, allowRemote),
    allowRemote,
    apiKeyRequired: bool(r.apiKeyRequired, def.apiKeyRequired),
    lowModel: str(r.lowModel, def.lowModel),
    highModel: str(r.highModel, def.highModel),
    visionModel: str(r.visionModel, def.visionModel),
    fallbackModels: strArray(r.fallbackModels, def.fallbackModels ?? []),
    temperature: num(r.temperature, def.temperature, 0, 2),
    topP: num(r.topP, def.topP, 0, 1),
    topK: int(r.topK, def.topK, 0, 1000),
    numCtx: int(r.numCtx, def.numCtx, 256, 1_048_576),
    numPredict: int(r.numPredict, def.numPredict, 16, 32_768),
    timeoutMs: int(r.timeoutMs, def.timeoutMs, 1000, 3_600_000),
    keepAlive: str(r.keepAlive, def.keepAlive),
  }
}

/**
 * Deep-merge `raw` over the defaults and clamp every field into its valid range.
 * Always returns a valid `AppSettings`; never throws.
 */
export function coerceSettings(raw: unknown): AppSettings {
  const r = isObject(raw) ? raw : {}
  const d = DEFAULT_SETTINGS

  const aiRaw = isObject(r.ai) ? r.ai : {}
  const ollamaRaw = isObject(r.ollama) ? r.ollama : {}
  const audioRaw = isObject(r.audio) ? r.audio : {}
  const windowRaw = isObject(r.window) ? r.window : {}
  const shortcutsRaw = isObject(r.shortcuts) ? r.shortcuts : {}
  const localShortcutsRaw = isObject(r.localShortcuts) ? r.localShortcuts : {}
  const generalRaw = isObject(r.general) ? r.general : {}

  // Window position: null or {x,y} integers.
  let position: WindowSettings["position"] = null
  if (isObject(windowRaw.position)) {
    position = {
      x: int(windowRaw.position.x, 0, -100000, 100000),
      y: int(windowRaw.position.y, 0, -100000, 100000),
    }
  }

  const sizeRaw = isObject(windowRaw.size) ? windowRaw.size : {}

  // Shortcut bindings: keep only known action ids; each value is a string or null.
  const bindings: Partial<Record<ShortcutActionId, Binding>> = {}
  const bindingsRaw = isObject(shortcutsRaw.bindings) ? shortcutsRaw.bindings : {}
  for (const key of Object.keys(bindingsRaw)) {
    if (!isKnownAction(key)) continue
    const val = bindingsRaw[key]
    if (val === null || typeof val === "string") {
      bindings[key] = val as Binding
    }
  }

  const localBindings: Partial<Record<LocalShortcutActionId, Binding>> = {}
  const localBindingsRaw = isObject(localShortcutsRaw.bindings) ? localShortcutsRaw.bindings : {}
  for (const key of Object.keys(localBindingsRaw)) {
    if (!isKnownLocalAction(key)) continue
    const val = localBindingsRaw[key]
    if (val === null || typeof val === "string") {
      localBindings[key] = val as Binding
    }
  }

  const providerDefaults = d.ai.providers
  const providersRaw = isObject(aiRaw.providers) ? aiRaw.providers : {}
  const providers: Record<string, AiProviderSettings> = {}
  const providerKeys = new Set([...Object.keys(providerDefaults), ...Object.keys(providersRaw)])
  for (const rawId of providerKeys) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(rawId)) continue
    const defProvider =
      providerDefaults[rawId] ??
      ({
        ...CUSTOM_PROVIDER_TEMPLATE,
        id: rawId,
        name: rawId,
      } satisfies AiProviderSettings)
    providers[rawId] = coerceProvider(providersRaw[rawId], defProvider)
    providers[rawId].id = rawId
    // Pin managed cloud endpoints by the map key (authoritative identity), so a
    // decoupled inner `id` cannot slip a hostile endpoint past the pin.
    const pinnedEndpoint = PINNED_PROVIDER_ENDPOINTS[rawId]
    if (pinnedEndpoint) providers[rawId].endpoint = pinnedEndpoint
  }
  if (!providers.ollama) providers.ollama = coerceProvider({}, providerDefaults.ollama)
  const rawActive = providerId(aiRaw.activeProviderId, d.ai.activeProviderId)
  const activeProviderId = providers[rawActive] ? rawActive : d.ai.activeProviderId
  const rawFallbacks = Array.isArray(aiRaw.fallbackProviderIds)
    ? aiRaw.fallbackProviderIds
    : d.ai.fallbackProviderIds
  const fallbackProviderIds = Array.from(
    new Set(
      rawFallbacks
        .map((id) => providerId(id, ""))
        .filter((id) => id && id !== activeProviderId && !!providers[id])
    )
  )

  return {
    version: int(r.version, SETTINGS_VERSION, 0, 1_000_000),
    ai: {
      activeProviderId,
      fallbackProviderIds,
      reasoningMode: oneOf(aiRaw.reasoningMode, d.ai.reasoningMode, [
        "auto",
        "low",
        "high",
      ] as const),
      requestRetries: int(aiRaw.requestRetries, d.ai.requestRetries, 0, 3),
      healthCheckOnStart: bool(aiRaw.healthCheckOnStart, d.ai.healthCheckOnStart),
      providers,
    },
    ollama: {
      endpoint: coerceEndpoint(ollamaRaw.endpoint, d.ollama.endpoint),
      lowModel: str(ollamaRaw.lowModel, d.ollama.lowModel),
      highModel: str(ollamaRaw.highModel, d.ollama.highModel),
      visionModel: str(ollamaRaw.visionModel, d.ollama.visionModel),
      reasoningMode: oneOf(ollamaRaw.reasoningMode, d.ollama.reasoningMode, [
        "auto",
        "low",
        "high",
      ] as const),
      temperature: num(ollamaRaw.temperature, d.ollama.temperature, 0, 2),
      topP: num(ollamaRaw.topP, d.ollama.topP, 0, 1),
      topK: int(ollamaRaw.topK, d.ollama.topK, 0, 1000),
      numCtx: int(ollamaRaw.numCtx, d.ollama.numCtx, 256, 1_048_576),
      numPredict: int(ollamaRaw.numPredict, d.ollama.numPredict, 16, 32_768),
      timeoutMs: int(ollamaRaw.timeoutMs, d.ollama.timeoutMs, 1000, 3_600_000),
      keepAlive: str(ollamaRaw.keepAlive, d.ollama.keepAlive),
    },
    audio: {
      enabled: bool(audioRaw.enabled, d.audio.enabled),
      whisperModel: str(audioRaw.whisperModel, d.audio.whisperModel),
      language: str(audioRaw.language, d.audio.language),
      translate: bool(audioRaw.translate, d.audio.translate),
      autoAnalyze: bool(audioRaw.autoAnalyze, d.audio.autoAnalyze),
      maxDurationSec: int(audioRaw.maxDurationSec, d.audio.maxDurationSec, 1, 3600),
    },
    window: {
      position,
      size: {
        width: int(sizeRaw.width, d.window.size.width, 200, 10000),
        height: int(sizeRaw.height, d.window.size.height, 150, 10000),
      },
      opacity: num(windowRaw.opacity, d.window.opacity, 0.1, 1),
      alwaysOnTop: bool(windowRaw.alwaysOnTop, d.window.alwaysOnTop),
      contentProtection: bool(windowRaw.contentProtection, d.window.contentProtection),
      skipTaskbar: bool(windowRaw.skipTaskbar, d.window.skipTaskbar),
      trayEnabled: bool(windowRaw.trayEnabled, d.window.trayEnabled),
      hiddenInMissionControl: bool(
        windowRaw.hiddenInMissionControl,
        d.window.hiddenInMissionControl
      ),
    },
    shortcuts: {
      bindings,
      moveStep: int(shortcutsRaw.moveStep, d.shortcuts.moveStep, 1, 1000),
    },
    localShortcuts: {
      bindings: localBindings,
    },
    general: {
      theme: oneOf(generalRaw.theme, d.general.theme, ["dark", "light", "system"] as const),
      startMinimized: bool(generalRaw.startMinimized, d.general.startMinimized),
      telemetry: bool(generalRaw.telemetry, d.general.telemetry),
      warmModelOnStart: bool(generalRaw.warmModelOnStart, d.general.warmModelOnStart),
    },
  }
}

const KNOWN_ACTIONS: readonly ShortcutActionId[] = [
  "toggleWindow",
  "showWindow",
  "takeScreenshot",
  "process",
  "reset",
  "toggleMode",
  "moveLeft",
  "moveRight",
  "moveUp",
  "moveDown",
]

const KNOWN_LOCAL_ACTIONS: readonly LocalShortcutActionId[] = [
  "toggleChat",
  "toggleSettings",
  "focusChat",
  "closePanels",
  "stopGeneration",
]

export function isKnownAction(id: string): id is ShortcutActionId {
  return (KNOWN_ACTIONS as readonly string[]).includes(id)
}

export function isKnownLocalAction(id: string): id is LocalShortcutActionId {
  return (KNOWN_LOCAL_ACTIONS as readonly string[]).includes(id)
}
