import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useImportExport } from "../src/components/Settings/useImportExport"
import ImportExportPanel from "../src/components/Settings/ImportExportPanel"

function Harness({
  exportData,
  importData,
}: {
  exportData: () => Promise<unknown>
  importData: (d: unknown) => Promise<{ ok: boolean; error?: string }>
}) {
  const io = useImportExport(exportData, importData)
  return (
    <div>
      <button onClick={io.startExport}>Export</button>
      <button onClick={io.startImport}>Import</button>
      <ImportExportPanel io={io} entity="settings" />
      {io.msg && <div role="status">{io.msg}</div>}
    </div>
  )
}

describe("in-overlay import/export (no native dialogs)", () => {
  beforeEach(() => {
    ;(window.electronAPI as any).copyToClipboard = vi.fn(async () => ({ ok: true }))
  })

  it("export serialises to the textarea and copies to the clipboard", async () => {
    const user = userEvent.setup()
    const exportData = vi.fn(async () => ({ format: "ia-core.settings", version: 4 }))
    const importData = vi.fn(async () => ({ ok: true }))
    render(<Harness exportData={exportData} importData={importData} />)
    await user.click(screen.getByRole("button", { name: /^export$/i }))
    const ta = (await screen.findByLabelText(/settings json/i)) as HTMLTextAreaElement
    expect(ta.value).toContain('"format"')
    await waitFor(() =>
      expect((window.electronAPI as any).copyToClipboard).toHaveBeenCalledWith(ta.value)
    )
  })

  it("import parses pasted JSON and applies it", async () => {
    const user = userEvent.setup()
    const exportData = vi.fn(async () => ({}))
    const importData = vi.fn(async () => ({ ok: true }))
    render(<Harness exportData={exportData} importData={importData} />)
    await user.click(screen.getByRole("button", { name: /^import$/i }))
    const ta = await screen.findByLabelText(/settings json/i)
    fireEvent.change(ta, { target: { value: '{"format":"ia-core.settings","version":4}' } })
    await user.click(screen.getByRole("button", { name: /^apply$/i }))
    await waitFor(() =>
      expect(importData).toHaveBeenCalledWith({ format: "ia-core.settings", version: 4 })
    )
  })

  it("rejects invalid JSON with an inline error and does not call import", async () => {
    const user = userEvent.setup()
    const exportData = vi.fn(async () => ({}))
    const importData = vi.fn(async () => ({ ok: true }))
    render(<Harness exportData={exportData} importData={importData} />)
    await user.click(screen.getByRole("button", { name: /^import$/i }))
    const ta = await screen.findByLabelText(/settings json/i)
    fireEvent.change(ta, { target: { value: "not json{" } })
    await user.click(screen.getByRole("button", { name: /^apply$/i }))
    expect(await screen.findByText(/not valid json/i)).toBeInTheDocument()
    expect(importData).not.toHaveBeenCalled()
  })
})
