import { describe, it, expect } from "vitest"
import {
  validateAccelerator,
  normalizeAccelerator,
  detectDuplicates,
  findConflict,
} from "../electron/shortcuts/validation"
import { DEFAULT_BINDINGS, DEFAULT_LOCAL_BINDINGS } from "../electron/shortcuts/actions"
import type { ShortcutActionId, Binding } from "../electron/config/schema"

describe("validateAccelerator", () => {
  it("accepts a modifier + key", () => {
    const v = validateAccelerator("CommandOrControl+B")
    expect(v.valid).toBe(true)
    expect(v.normalized).toBe("CommandOrControl+B")
  })

  it("rejects empty input", () => {
    expect(validateAccelerator("").error).toBe("empty")
  })

  it("rejects modifier-only", () => {
    expect(validateAccelerator("Control+Shift").error).toBe("no-key")
  })

  it("rejects a bare key with no modifier", () => {
    expect(validateAccelerator("B").error).toBe("no-modifier")
  })

  it("rejects two non-modifier keys", () => {
    expect(validateAccelerator("Control+A+B").error).toBe("multiple-keys")
  })

  it("rejects unknown tokens", () => {
    expect(validateAccelerator("Control+Nope").error).toBe("unknown-token")
  })

  it("flags reserved combinations but still validates", () => {
    const v = validateAccelerator("CommandOrControl+Q")
    expect(v.valid).toBe(true)
    expect(v.reserved).toBe(true)
  })

  it("accepts function keys and arrows", () => {
    expect(validateAccelerator("Alt+F4").valid).toBe(true)
    expect(validateAccelerator("CommandOrControl+Left").valid).toBe(true)
  })
})

describe("normalizeAccelerator", () => {
  it("orders modifiers canonically and uppercases letters", () => {
    expect(normalizeAccelerator("shift+control+b")).toBe("Control+Shift+B")
  })

  it("treats equivalent orderings as equal", () => {
    expect(normalizeAccelerator("Shift+CommandOrControl+H")).toBe(
      normalizeAccelerator("CommandOrControl+Shift+H")
    )
  })

  it("de-duplicates repeated modifiers", () => {
    expect(normalizeAccelerator("Control+Control+B")).toBe("Control+B")
  })

  it("keeps Command and CommandOrControl distinct for conflict purposes", () => {
    expect(normalizeAccelerator("Command+B")).not.toBe(normalizeAccelerator("CommandOrControl+B"))
  })
})

describe("validateAccelerator — numpad and named keys", () => {
  it("accepts numpad tokens", () => {
    expect(validateAccelerator("CommandOrControl+num5").valid).toBe(true)
    expect(validateAccelerator("CommandOrControl+numadd").valid).toBe(true)
  })

  it("accepts the Plus named key and canonicalizes it", () => {
    const v = validateAccelerator("Alt+Plus")
    expect(v.valid).toBe(true)
    expect(v.normalized.endsWith("+Plus")).toBe(true)
  })
})

describe("detectDuplicates / findConflict", () => {
  const effective = {
    toggleWindow: "CommandOrControl+B",
    takeScreenshot: "CommandOrControl+H",
    process: "commandorcontrol+b", // same as toggleWindow after normalization
  } as unknown as Record<ShortcutActionId, Binding>

  it("detects normalized duplicates", () => {
    const dups = detectDuplicates(effective)
    expect(dups).toHaveLength(1)
    expect(dups[0].actionIds.sort()).toEqual(["process", "toggleWindow"])
  })

  it("ignores disabled (null) bindings", () => {
    const withNull = { a: null, b: null } as unknown as Record<ShortcutActionId, Binding>
    expect(detectDuplicates(withNull)).toHaveLength(0)
  })

  it("findConflict skips the target action itself", () => {
    expect(findConflict("toggleWindow" as ShortcutActionId, "CommandOrControl+B", effective)).toBe(
      "process"
    )
    expect(
      findConflict("takeScreenshot" as ShortcutActionId, "CommandOrControl+H", effective)
    ).toBeNull()
  })
})

describe("default shortcuts are conflict-resistant", () => {
  it("every default is a valid accelerator", () => {
    for (const accel of Object.values(DEFAULT_BINDINGS)) {
      if (accel === null) continue
      expect(validateAccelerator(accel).valid, `${accel} should be valid`).toBe(true)
    }
  })

  it("has no in-app duplicate bindings", () => {
    expect(detectDuplicates(DEFAULT_BINDINGS)).toHaveLength(0)
  })

  it("uses three modifiers (Cmd/Ctrl+Alt+Shift) so it never collides with OS/app shortcuts", () => {
    for (const accel of Object.values(DEFAULT_BINDINGS)) {
      if (accel === null) continue
      expect(accel.startsWith("CommandOrControl+Alt+Shift+"), `${accel}`).toBe(true)
    }
  })

  it("does not collide with local shortcut defaults", () => {
    const all = [
      ...Object.values(DEFAULT_BINDINGS),
      ...Object.values(DEFAULT_LOCAL_BINDINGS),
    ].filter(Boolean) as string[]
    expect(new Set(all.map((a) => normalizeAccelerator(a))).size).toBe(all.length)
  })
})

describe("toggleMode shortcut (online/offline)", () => {
  it("is bound to ⌘⌥⇧M by default and is valid", () => {
    expect(DEFAULT_BINDINGS.toggleMode).toBe("CommandOrControl+Alt+Shift+M")
    expect(validateAccelerator(DEFAULT_BINDINGS.toggleMode as string).valid).toBe(true)
  })

  it("does not conflict with any other default binding", () => {
    const conflict = findConflict(
      "toggleMode" as ShortcutActionId,
      normalizeAccelerator("CommandOrControl+Alt+Shift+M"),
      DEFAULT_BINDINGS
    )
    expect(conflict).toBeNull()
  })
})
