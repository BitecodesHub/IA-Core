import React from "react"
import { useImportExport } from "./useImportExport"

interface Props {
  io: ReturnType<typeof useImportExport>
  /** Noun for messages, e.g. "settings" or "shortcuts". */
  entity: string
}

/** In-overlay import/export panel (textarea + actions). Renders nothing when idle. */
const ImportExportPanel: React.FC<Props> = ({ io, entity }) => {
  if (!io.mode) return null
  const isExport = io.mode === "export"
  return (
    <div className="mb-2 border border-white/15 rounded-md p-2 space-y-2">
      <div className="text-[11px] text-white/70">
        {isExport
          ? `Your ${entity} (copied to the clipboard). Paste it into a text file to keep a backup.`
          : `Paste previously exported ${entity} JSON, then Apply.`}
      </div>
      <textarea
        aria-label={`${entity} JSON`}
        readOnly={isExport}
        value={io.text}
        onChange={(e) => io.setText(e.target.value)}
        spellCheck={false}
        className="w-full h-28 bg-black border border-white/25 rounded px-2 py-1 text-[11px] font-mono text-white resize-none"
        placeholder={isExport ? undefined : "{ …exported JSON… }"}
      />
      <div className="flex items-center gap-2">
        {isExport ? (
          <button
            onClick={io.copy}
            className="text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10"
          >
            Copy
          </button>
        ) : (
          <button
            onClick={io.apply}
            disabled={!io.text.trim()}
            className="text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10 disabled:opacity-40"
          >
            Apply
          </button>
        )}
        <button
          onClick={io.close}
          className="text-xs px-2 py-1 rounded border border-white/25 text-white/70 hover:bg-white/10"
        >
          Close
        </button>
      </div>
    </div>
  )
}

export default ImportExportPanel
