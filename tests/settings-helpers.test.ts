import { describe, it, expect } from "vitest"
import { deepMerge, diffPaths } from "../electron/config/merge"
import {
  resolveEffectiveBindings,
  DEFAULT_BINDINGS,
  resolveEffectiveLocalBindings,
  DEFAULT_LOCAL_BINDINGS,
} from "../electron/shortcuts/actions"

describe("deepMerge", () => {
  it("merges nested objects without dropping sibling keys", () => {
    const base = { a: { x: 1, y: 2 }, b: 3 }
    const out = deepMerge(base, { a: { y: 20 } })
    expect(out).toEqual({ a: { x: 1, y: 20 }, b: 3 })
  })

  it("overwrites primitives and ignores undefined patch values", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9, b: undefined })).toEqual({ a: 9, b: 2 })
  })

  it("does not mutate the base object", () => {
    const base = { a: { x: 1 } }
    deepMerge(base, { a: { x: 2 } })
    expect(base.a.x).toBe(1)
  })

  it("lets a null patch value overwrite the base (distinct from undefined)", () => {
    // Used to 'disable' a shortcut: override = null must persist, not be skipped.
    expect(deepMerge({ a: "x" }, { a: null })).toEqual({ a: null })
    expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null })
  })

  it("replaces arrays wholesale rather than merging them", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] })
  })
})

describe("diffPaths", () => {
  it("returns dotted paths of changed leaves", () => {
    const a = { window: { opacity: 1, size: { width: 400 } } }
    const b = { window: { opacity: 0.8, size: { width: 400 } } }
    expect(diffPaths(a, b)).toEqual(["window.opacity"])
  })

  it("returns empty when objects are equal", () => {
    expect(diffPaths({ a: 1 }, { a: 1 })).toEqual([])
  })

  it("surfaces an added key", () => {
    expect(diffPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"])
  })

  it("surfaces a removed key", () => {
    expect(diffPaths({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"])
  })

  it("treats an array-leaf change as a single changed path", () => {
    expect(diffPaths({ t: [1, 2] }, { t: [1, 3] })).toEqual(["t"])
  })

  it("reports a null-to-object transition at the parent path", () => {
    expect(diffPaths({ w: { p: null } }, { w: { p: { x: 1 } } })).toEqual(["w.p"])
  })

  it("returns multiple dotted paths for multiple changed leaves", () => {
    expect(diffPaths({ a: 1, b: 2 }, { a: 9, b: 8 })).toEqual(["a", "b"])
  })
})

describe("resolveEffectiveBindings", () => {
  it("fills defaults for absent actions", () => {
    const eff = resolveEffectiveBindings({})
    expect(eff.toggleWindow).toBe(DEFAULT_BINDINGS.toggleWindow)
  })

  it("preserves an explicit null (disabled) override distinct from absent", () => {
    const eff = resolveEffectiveBindings({ toggleWindow: null })
    expect(eff.toggleWindow).toBeNull()
    expect(eff.takeScreenshot).toBe(DEFAULT_BINDINGS.takeScreenshot)
  })

  it("applies a custom override", () => {
    const eff = resolveEffectiveBindings({ takeScreenshot: "Alt+S" })
    expect(eff.takeScreenshot).toBe("Alt+S")
  })
})

describe("resolveEffectiveLocalBindings", () => {
  it("fills local defaults for absent actions", () => {
    const eff = resolveEffectiveLocalBindings({})
    expect(eff.toggleChat).toBe(DEFAULT_LOCAL_BINDINGS.toggleChat)
  })

  it("preserves an explicit disabled local shortcut", () => {
    const eff = resolveEffectiveLocalBindings({ focusChat: null })
    expect(eff.focusChat).toBeNull()
    expect(eff.toggleSettings).toBe(DEFAULT_LOCAL_BINDINGS.toggleSettings)
  })
})
