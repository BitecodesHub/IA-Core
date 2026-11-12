import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ChatPanel, { type ChatMessage } from "../src/components/Queue/ChatPanel"

function panel(messages: ChatMessage[], loading = false) {
  return <ChatPanel messages={messages} input="" loading={loading} onInputChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} />
}
const message = (text: string): ChatMessage[] => [{ id: 1, role: "assistant", text, isStreaming: true }]

describe("ChatPanel scroll and focus intent", () => {
  it("measures identical deterministic response updates at unbatched and coalesced cadence", () => {
    const final = "synthetic response fragment ".repeat(200)
    const run = (indices: number[]) => {
      const view = render(panel([]))
      const start = performance.now()
      for (const index of indices) view.rerender(panel(message(final.slice(0, index * 28))))
      view.rerender(panel([{ id: 1, role: "assistant", text: final }]))
      const elapsed = performance.now() - start
      expect(screen.getByRole("region", { name: "Conversation" })).toHaveTextContent(final.trim())
      view.unmount()
      return elapsed
    }
    const baseline = run(Array.from({ length: 200 }, (_, i) => i + 1))
    const batched = run([1, 17, 33, 49, 65, 81, 97, 113, 129, 145, 161, 177, 193])
    console.log(JSON.stringify({ measurement: "jsdom React updates and parsing; modeled identical payload cadence", baselineUpdates: 201, batchedUpdates: 14, baselineMs: baseline, batchedMs: batched }))
  })

  it("keeps following the bottom when a large response grows", () => {
    const view = render(panel(message("first")))
    const region = screen.getByRole("region", { name: "Conversation" })
    Object.defineProperties(region, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } })
    region.scrollTop = 800
    fireEvent.scroll(region)
    Object.defineProperty(region, "scrollHeight", { value: 3000 })
    view.rerender(panel(message("large response")))
    expect(region.scrollTop).toBe(3000)
  })

  it("does not pull a reader away from older content", () => {
    const view = render(panel(message("first")))
    const region = screen.getByRole("region", { name: "Conversation" })
    Object.defineProperties(region, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } })
    region.scrollTop = 100
    fireEvent.scroll(region)
    Object.defineProperty(region, "scrollHeight", { value: 3000 })
    view.rerender(panel(message("large response")))
    expect(region.scrollTop).toBe(100)
  })

  it("does not steal focus when generation completes", () => {
    const view = render(<><button>Outside control</button>{panel(message("partial"), true)}</>)
    screen.getByRole("button", { name: "Outside control" }).focus()
    view.rerender(<><button>Outside control</button>{panel([{ id: 1, role: "assistant", text: "final" }])}</>)
    expect(screen.getByRole("button", { name: "Outside control" })).toHaveFocus()
  })
})
