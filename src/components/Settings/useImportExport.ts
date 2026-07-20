import { useState } from "react"

type Mode = null | "export" | "import"

/**
 * Stealth-safe settings/shortcuts import-export. Replaces the native OS file
 * dialogs (which render OUTSIDE content protection and appear in screen shares)
 * with an in-overlay copy/paste flow: export serialises to JSON shown in-panel
 * and copied to the clipboard; import parses pasted JSON. Everything stays inside
 * the content-protected renderer.
 */
export function useImportExport(
  exportData: () => Promise<unknown>,
  importData: (data: unknown) => Promise<{ ok: boolean; error?: string }>
) {
  const [mode, setMode] = useState<Mode>(null)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState<string | null>(null)

  const startExport = async () => {
    try {
      const data = await exportData()
      const json = JSON.stringify(data, null, 2)
      setText(json)
      setMode("export")
      const res = await window.electronAPI.copyToClipboard(json)
      setMsg(res.ok ? "Copied to clipboard — paste into a text file to save." : "Copy it below.")
    } catch (e: any) {
      setMsg(e?.message ?? "Export failed.")
    }
  }

  const startImport = () => {
    setText("")
    setMode("import")
    setMsg(null)
  }

  const copy = async () => {
    const res = await window.electronAPI.copyToClipboard(text)
    setMsg(res.ok ? "Copied." : "Copy failed.")
  }

  const apply = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setMsg("That is not valid JSON.")
      return
    }
    try {
      const res = await importData(parsed)
      if (res.ok) {
        setMode(null)
        setMsg("Imported.")
      } else {
        setMsg(res.error ?? "Import failed.")
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Import failed.")
    }
  }

  const close = () => {
    setMode(null)
    setMsg(null)
  }

  return { mode, text, setText, msg, startExport, startImport, copy, apply, close }
}
