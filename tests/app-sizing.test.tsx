import React from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "../src/App"

vi.mock("../src/_pages/Queue", () => ({ default: () => <div>synthetic queue</div> }))
vi.mock("../src/_pages/Solutions", () => ({ default: () => null }))
vi.mock("../src/components/SignInGate", () => ({ default: () => null, useBitecodesSignedIn: () => true }))
vi.mock("../src/components/UpdateBanner", () => ({ UpdateBanner: () => null, UpdateRequiredGate: () => null, useUpdateState: () => null }))
vi.mock("../src/components/ui/toast", () => ({ ToastProvider: ({ children }: any) => children }))
vi.mock("@radix-ui/react-toast", () => ({ ToastViewport: () => null }))

let resize: () => void
let frame: FrameRequestCallback | undefined
let dimensions: ReturnType<typeof vi.fn>
beforeEach(() => {
  frame = undefined
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
  vi.stubGlobal("cancelAnimationFrame", vi.fn(() => { frame = undefined }))
  dimensions = vi.fn()
  window.electronAPI = {
    getSettings: vi.fn().mockResolvedValue({ general: { theme: "dark" } }),
    onSettingsChanged: vi.fn(() => vi.fn()),
    onSolutionStart: vi.fn(() => vi.fn()), onUnauthorized: vi.fn(() => vi.fn()),
    onResetView: vi.fn(() => vi.fn()), onProblemExtracted: vi.fn(() => vi.fn()),
    updateContentDimensions: dimensions,
  } as any
})
afterEach(() => vi.unstubAllGlobals())

function flush() {
  const callback = frame
  frame = undefined
  act(() => callback?.(0))
}

describe("App sizing owner", () => {
  it("coalesces 200 observer notifications into one resize and suppresses unchanged dimensions", async () => {
    const view = render(<App />)
    const root = view.container.querySelector(".app-content")!
    Object.defineProperties(root, { scrollWidth: { value: 480, configurable: true }, scrollHeight: { value: 300, configurable: true } })
    for (let i = 0; i < 200; i++) resize()
    flush()
    expect(dimensions).toHaveBeenCalledOnce()
    expect(dimensions).toHaveBeenCalledWith({ width: 480, height: 300, center: false })
    for (let i = 0; i < 200; i++) resize()
    flush()
    expect(dimensions).toHaveBeenCalledOnce()
    Object.defineProperty(root, "scrollHeight", { value: 500 })
    resize()
    flush()
    expect(dimensions).toHaveBeenCalledTimes(2)
    await act(async () => {})
    console.log(JSON.stringify({ measurement: "root observer notification burst", notifications: 400, unchangedResizeCalls: 1, changedResizeCalls: 1 }))
  })

  it("cancels scheduled sizing on unmount", async () => {
    const view = render(<App />)
    view.unmount()
    flush()
    expect(dimensions).not.toHaveBeenCalled()
    await act(async () => {})
  })
})
