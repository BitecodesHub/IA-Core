import React from "react"
import { useSettings } from "./useSettings"

const PrivacyTab: React.FC<{ search?: string }> = () => {
  const { settings, update } = useSettings()
  if (!settings) return <div className="text-xs text-white/60">Loading…</div>

  const active = settings.ai.providers[settings.ai.activeProviderId]

  return (
    <div className="space-y-3 text-white">
      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-white/70">
          Content protection
          <span className="block text-[10px] text-white/40">
            Exclude overlay from screen sharing where the OS allows it.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.window.contentProtection}
          onChange={(e) => update({ window: { contentProtection: e.target.checked } })}
          className="accent-white"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-white/70">
          Telemetry
          <span className="block text-[10px] text-white/40">
            No telemetry is sent unless this is explicitly enabled.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.general.telemetry}
          onChange={(e) => update({ general: { telemetry: e.target.checked } })}
          className="accent-white"
        />
      </label>

      {active?.type === "openai-compatible" && (
        <label className="flex items-center justify-between gap-3 text-xs">
          <span className="text-white/70">
            Allow remote AI endpoint
            <span className="block text-[10px] text-white/40">
              When off, only loopback/private network endpoints are accepted.
            </span>
          </span>
          <input
            type="checkbox"
            checked={active.allowRemote}
            onChange={(e) =>
              update({
                ai: { providers: { [active.id]: { allowRemote: e.target.checked } } },
              } as any)
            }
            className="accent-white"
          />
        </label>
      )}
    </div>
  )
}

export default PrivacyTab
