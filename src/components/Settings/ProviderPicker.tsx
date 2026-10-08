import React from "react"
import Combobox from "../ui/Combobox"
import type { ComboOption } from "../../lib/modelOptions"
import type { AiProviderSettings } from "../../types/settings"

export interface ProviderKeyState {
  /** Whether a key is stored for this provider id. */
  hasApiKey: boolean
}

interface ProviderPickerProps {
  providers: AiProviderSettings[]
  value: string
  activeProviderId: string
  /** Key presence per provider id; missing entry = unknown, treated as no key. */
  keyState?: Record<string, ProviderKeyState>
  onChange: (id: string) => void
  className?: string
}

/** Host portion of an endpoint, for the option's secondary line. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}

/**
 * Build the picker's options. Pure and exported so the ordering and badge rules
 * are testable without rendering.
 *
 * Ordering: the active provider first, then ready-to-use providers (key
 * present), then the rest alphabetically — so the useful choices are reachable
 * without scrolling once several providers exist.
 */
export function buildProviderOptions(
  providers: AiProviderSettings[],
  activeProviderId: string,
  keyState: Record<string, ProviderKeyState> = {}
): ComboOption[] {
  const ready = (p: AiProviderSettings) => !p.apiKeyRequired || keyState[p.id]?.hasApiKey === true

  const sorted = [...providers].sort((a, b) => {
    if (a.id === activeProviderId !== (b.id === activeProviderId)) {
      return a.id === activeProviderId ? -1 : 1
    }
    if (ready(a) !== ready(b)) return ready(a) ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return sorted.map((p) => {
    const badges: ComboOption["badges"] = []
    if (p.id === activeProviderId) badges.push({ text: "active", tone: "ok" })
    if (p.apiKeyRequired && !keyState[p.id]?.hasApiKey) {
      badges.push({ text: p.type === "bitecodes" ? "sign in" : "no key", tone: "warn" })
    }
    if (!p.enabled && p.id !== activeProviderId) badges.push({ text: "off", tone: "muted" })
    return {
      // `kind: "model"` is what makes a row searchable/filterable in Combobox;
      // "auto"/"configured" rows are pinned and never filtered.
      kind: "model" as const,
      value: p.id,
      label: p.name,
      detail: endpointHost(p.endpoint),
      badges,
    }
  })
}

/**
 * Searchable provider selector.
 *
 * Replaces a horizontal segmented control that was fine for one online provider
 * and unusable once there were several — the segments overflowed the narrow
 * settings panel with no way to scroll or search.
 */
const ProviderPicker: React.FC<ProviderPickerProps> = ({
  providers,
  value,
  activeProviderId,
  keyState,
  onChange,
  className,
}) => (
  <Combobox
    ariaLabel="Online provider"
    value={value}
    onChange={onChange}
    options={buildProviderOptions(providers, activeProviderId, keyState)}
    hint="Type to search providers by name or host."
    emptyText="No matching provider"
    className={className ?? "w-56"}
  />
)

export default ProviderPicker
