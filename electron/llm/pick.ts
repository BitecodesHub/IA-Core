// Pure model-selection fallback used by LLMHelper.chooseModel. Extracted so the
// branching (especially the remote-provider "prefer configured over arbitrary
// discovered model" hardening) is unit-testable without the Electron runtime.

import type { AiProviderSettings } from "../config/schema"
import type { ModelInfo } from "./providers"

export interface PickModelInput {
  config: AiProviderSettings
  hasImage: boolean
  /** The tier model chosen by the router (may be empty). */
  configured: string
  /** Models discovered from the provider (may be empty if discovery failed). */
  models: ModelInfo[]
  /** First auto-discovered model id for this provider, if any. */
  autoModel?: string
}

/**
 * Resolve the concrete model id to send to a provider. For remote providers a
 * configured slug is preferred over an arbitrary discovered model, so a slug
 * mismatch fails loudly at the provider instead of silently querying (and
 * billing) a different model. Ollama keeps its permissive "first available"
 * behaviour.
 */
export function pickModel(input: PickModelInput): string {
  const { config, hasImage, configured, models, autoModel } = input
  const isOllama = config.type === "ollama"

  if (hasImage) {
    const configuredVision = models.find((m) => m.name === config.visionModel && m.vision)
    if (configuredVision) return configuredVision.name
    if (!isOllama && config.visionModel) return config.visionModel
    const anyVision = models.find((m) => m.vision)
    if (anyVision) return anyVision.name
    if (config.visionModel) return config.visionModel
    throw new Error(`${config.name} has no vision-capable model configured or discovered.`)
  }

  if (models.length === 0) {
    if (configured) return configured
    if (isOllama) return "llama3.2"
    throw new Error(`${config.name} has no model configured.`)
  }

  if (configured && models.some((m) => m.name === configured)) return configured
  for (const candidate of [config.highModel, config.lowModel, autoModel]) {
    if (candidate && models.some((m) => m.name === candidate)) return candidate
  }
  if (!isOllama) {
    const preferred = configured || config.highModel || config.lowModel
    if (preferred) return preferred
  }
  return models[0].name
}
