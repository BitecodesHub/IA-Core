import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import WindowTab from "../src/components/Settings/WindowTab"
import { DEFAULT_SETTINGS, type AppSettings } from "../electron/config/schema"
import { deepMerge } from "../electron/config/merge"
import { SHORTCUT_ACTION_LIST } from "../electron/shortcuts/actions"

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function installSettingsStore() {
  let current = clone(DEFAULT_SETTINGS)
  current.window = {
    ...current.window,
    opacity: 0.35,
    alwaysOnTop: true,
    contentProtection: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    trayEnabled: true,
    position: { x: 120, y: 80 },
    size: { width: 620, height: 440 },
  }
  current.general = { ...current.general, startMinimized: true, theme: "light" }
  current.ai.activeProviderId = "groq"
  current.ai.providers.groq.lowModel = "custom-model"
  current.audio = { ...current.audio, enabled: true, language: "fr" }
  current.localShortcuts.bindings = { toggleChat: "Control+Shift+C", closePanels: null }
  current.shortcuts = {
    bindings: { toggleWindow: "Control+Shift+T", process: null },
    moveStep: 75,
  }

  const listeners = new Set<(settings: AppSettings) => void>()
  const publish = (next: AppSettings) => {
    current = clone(next)
    listeners.forEach((listener) => listener(clone(current)))
  }
  const api = window.electronAPI
  vi.mocked(api.getSettings).mockImplementation(async () => clone(current))
  vi.mocked(api.onSettingsChanged).mockImplementation((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  vi.mocked(api.setSettings).mockImplementation(async (patch) => {
    publish(deepMerge({ ...current }, patch) as unknown as AppSettings)
    return clone(current)
  })
  api.bitecodesLogout = vi.fn()
  return { get: () => clone(current), publish }
}

describe("WindowTab", () => {
  let store: ReturnType<typeof installSettingsStore>
  beforeEach(() => {
    store = installSettingsStore()
  })

  it("applies the visible-app preset in one patch without changing unrelated settings or credentials", async () => {
    const user = userEvent.setup()
    const before = store.get()
    render(<WindowTab />)
    const preset = await screen.findByRole("button", { name: "Use visible app settings" })
    const opacity = screen.getByRole("slider", { name: "Opacity" })
    expect(opacity).toHaveValue("0.35")
    expect(window.electronAPI.setSettings).not.toHaveBeenCalled()

    await user.click(preset)

    const patch = {
      window: {
        opacity: 1,
        alwaysOnTop: false,
        contentProtection: false,
        skipTaskbar: false,
        hiddenInMissionControl: false,
        trayEnabled: false,
      },
      general: { startMinimized: false },
      shortcuts: {
        bindings: Object.fromEntries(SHORTCUT_ACTION_LIST.map(({ id }) => [id, null])),
      },
    }
    await waitFor(() => {
      expect(window.electronAPI.setSettings).toHaveBeenCalledOnce()
      expect(window.electronAPI.setSettings).toHaveBeenCalledWith(patch)
      expect(opacity).toHaveValue("1")
    })
    expect(store.get()).toEqual({
      ...before,
      window: { ...before.window, ...patch.window },
      general: { ...before.general, ...patch.general },
      shortcuts: { ...before.shortcuts, ...patch.shortcuts },
    })
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked()
    }
    expect(window.electronAPI.setAiProviderApiKey).not.toHaveBeenCalled()
    expect(window.electronAPI.bitecodesLogout).not.toHaveBeenCalled()
    expect(window.electronAPI.resetSettings).not.toHaveBeenCalled()
  })

  it("keeps the accessible opacity slider controlled by settings broadcasts", async () => {
    render(<WindowTab />)
    const opacity = await screen.findByRole("slider", { name: "Opacity" })
    expect(opacity).toHaveValue("0.35")
    for (const value of [1, 0.6]) {
      const next = store.get()
      next.window.opacity = value
      act(() => store.publish(next))
      expect(opacity).toHaveValue(String(value))
    }
    expect(window.electronAPI.setSettings).not.toHaveBeenCalled()
  })

  it("persists manual opacity changes as numbers without applying the preset", async () => {
    render(<WindowTab />)
    const opacity = await screen.findByRole("slider", { name: "Opacity" })
    fireEvent.change(opacity, { target: { value: "0.55" } })
    await waitFor(() => {
      expect(window.electronAPI.setSettings).toHaveBeenCalledOnce()
      expect(window.electronAPI.setSettings).toHaveBeenCalledWith({
        window: { opacity: 0.55 },
      })
      expect(opacity).toHaveValue("0.55")
    })
    expect(store.get().window.alwaysOnTop).toBe(true)
  })

  it("labels the Dock/taskbar control and updates only skipTaskbar", async () => {
    const user = userEvent.setup()
    render(<WindowTab />)
    const checkbox = await screen.findByRole("checkbox", { name: "Hide from Dock / taskbar" })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    await waitFor(() => {
      expect(window.electronAPI.setSettings).toHaveBeenCalledOnce()
      expect(window.electronAPI.setSettings).toHaveBeenCalledWith({
        window: { skipTaskbar: false },
      })
      expect(checkbox).not.toBeChecked()
    })
  })

  it("warns that administrator permission is required and Safe Exam Browser is not bypassed", async () => {
    const { container } = render(<WindowTab />)
    await screen.findByRole("slider", { name: "Opacity" })
    expect(screen.getByText(/Safe Exam Browser/i)).toBeVisible()
    expect(container).toHaveTextContent(/admin(?:istrator)?|institution|organization/i)
    expect(container).toHaveTextContent(
      /permission|permit(?:ted)?|approv(?:ed|al)|allow(?:ed|list)/i
    )
    expect(container).toHaveTextContent(/(?:not|never|cannot|doesn['’]t|can['’]t).{0,80}bypass/i)
  })
})
