import { EventEmitter } from "node:events"
import type { WebContents } from "electron"
import { describe, expect, it } from "vitest"
import { RequestRegistry } from "../electron/RequestRegistry"

function sender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as WebContents
}

describe("RequestRegistry", () => {
  it("isolates identical request IDs across senders", () => {
    const registry = new RequestRegistry()
    const a = sender()
    const b = sender()
    const first = registry.begin(a, "chat:1")
    const second = registry.begin(b, "chat:1")
    registry.cancel(a, "chat:1")
    expect(first.signal.aborted).toBe(true)
    expect(second.active()).toBe(true)
    second.finish()
    expect(b.listenerCount("destroyed")).toBe(0)
    expect(b.listenerCount("did-start-navigation")).toBe(0)
  })

  it("does not let stale completion remove its replacement", () => {
    const registry = new RequestRegistry()
    const owner = sender()
    const first = registry.begin(owner, "chat:1")
    const second = registry.begin(owner, "chat:1")
    first.finish()
    expect(first.signal.aborted).toBe(true)
    expect(first.active()).toBe(false)
    expect(second.active()).toBe(true)
    second.finish()
    expect(second.active()).toBe(false)
  })

  it("cancels only on full main-frame navigation", () => {
    const registry = new RequestRegistry()
    const owner = sender()
    const request = registry.begin(owner, "chat:1")
    owner.emit("did-start-navigation", {}, "about:blank", true, true)
    owner.emit("did-start-navigation", {}, "about:blank", false, false)
    expect(request.active()).toBe(true)
    owner.emit("did-start-navigation", {}, "about:blank", false, true)
    expect(request.signal.aborted).toBe(true)
    expect(owner.listenerCount("destroyed")).toBe(0)
  })

  it("cancels every request belonging to a destroyed sender", () => {
    const registry = new RequestRegistry()
    const owner = sender()
    const first = registry.begin(owner, "chat:1")
    const second = registry.begin(owner, "screenshot:1")
    owner.emit("destroyed")
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(owner.listenerCount("did-start-navigation")).toBe(0)
  })

  it("cancels all owners on reset and accepts fresh requests", () => {
    const registry = new RequestRegistry()
    const a = sender()
    const b = sender()
    const first = registry.begin(a, "chat:1")
    const second = registry.begin(b, "chat:2")
    registry.cancelAll()
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(registry.begin(a, "chat:1").active()).toBe(true)
  })

  it("immediately aborts requests for an already destroyed sender", () => {
    const registry = new RequestRegistry()
    const owner = sender()
    owner.isDestroyed = () => true
    const request = registry.begin(owner, "chat:1")
    expect(request.signal.aborted).toBe(true)
    expect(request.active()).toBe(false)
    expect(owner.listenerCount("destroyed")).toBe(0)
  })
})
