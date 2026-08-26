import React, { useState } from "react"
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Combobox from "../src/components/ui/Combobox"
import { buildModelOptions, type ModelLike } from "../src/lib/modelOptions"

function Harness({
  initial = "",
  models,
  visionOnly,
  maxVisible,
}: {
  initial?: string
  models: ModelLike[]
  visionOnly?: boolean
  maxVisible?: number
}) {
  const [v, setV] = useState(initial)
  return (
    <>
      <Combobox
        ariaLabel="Model"
        value={v}
        onChange={setV}
        maxVisible={maxVisible}
        options={buildModelOptions(models, { value: v, visionOnly })}
      />
      <div data-testid="val">{v === "" ? "AUTO" : v}</div>
    </>
  )
}

const MODELS: ModelLike[] = [
  { name: "anthropic/claude-sonnet-5", vision: true },
  { name: "openai/gpt-4o", vision: true },
  { name: "meta/llama-3", vision: false },
]

describe("Combobox", () => {
  it("opens on focus and lists Auto + all models", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    const list = screen.getByRole("listbox")
    expect(within(list).getByRole("option", { name: /Auto/ })).toBeInTheDocument()
    expect(within(list).getByRole("option", { name: /claude-sonnet-5/ })).toBeInTheDocument()
    expect(within(list).getByRole("option", { name: /llama-3/ })).toBeInTheDocument()
  })

  it("filters by typed query while keeping Auto pinned", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    await user.keyboard("gpt")
    const list = screen.getByRole("listbox")
    expect(within(list).getByRole("option", { name: /gpt-4o/ })).toBeInTheDocument()
    expect(within(list).queryByRole("option", { name: /llama-3/ })).not.toBeInTheDocument()
    expect(within(list).getByRole("option", { name: /Auto/ })).toBeInTheDocument()
  })

  it("selects a model via mouse and emits its value", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: /gpt-4o/ }))
    expect(screen.getByTestId("val")).toHaveTextContent("openai/gpt-4o")
  })

  it("navigates with arrow keys and commits with Enter", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    // Active starts on Auto (index 0). Two downs → third option (claude at idx1, gpt at idx2? order: Auto, claude, gpt, llama)
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("openai/gpt-4o")
  })

  it("selects Auto (empty value)", async () => {
    const user = userEvent.setup()
    render(<Harness initial="openai/gpt-4o" models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: /Auto/ }))
    expect(screen.getByTestId("val")).toHaveTextContent("AUTO")
  })

  it("preserves a configured value that is not in the discovered list", async () => {
    const user = userEvent.setup()
    render(<Harness initial="x/custom-model" models={MODELS} />)
    // Closed input shows the configured value.
    expect(screen.getByRole("combobox")).toHaveValue("x/custom-model (configured)")
    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("option", { name: /x\/custom-model \(configured\)/ })).toBeInTheDocument()
  })

  it("groups free models under a 'Free models' header at the top, before 'All models'", async () => {
    const user = userEvent.setup()
    const models: ModelLike[] = [
      { name: "openai/gpt-4o", vision: true },
      { name: "deepseek/deepseek-r1:free", vision: false, free: true },
    ]
    render(<Harness models={models} />)
    await user.click(screen.getByRole("combobox"))
    const list = screen.getByRole("listbox")
    expect(within(list).getByText("Free models")).toBeInTheDocument()
    expect(within(list).getByText("All models")).toBeInTheDocument()
    const rows = within(list).getAllByRole("option")
    // Auto first, then the free model, then the paid one.
    expect(rows.map((r) => r.textContent)).toEqual([
      "Auto",
      "deepseek/deepseek-r1:freefree",
      "openai/gpt-4ovision",
    ])
    expect(within(list).getByLabelText("free")).toBeInTheDocument()
  })

  it("hides section headers while searching (results are rank-ordered, not grouped)", async () => {
    const user = userEvent.setup()
    const models: ModelLike[] = [
      { name: "openai/gpt-4o", vision: true },
      { name: "deepseek/deepseek-r1:free", vision: false, free: true },
    ]
    render(<Harness models={models} />)
    await user.click(screen.getByRole("combobox"))
    await user.keyboard("deep")
    const list = screen.getByRole("listbox")
    expect(within(list).queryByText("Free models")).not.toBeInTheDocument()
    expect(within(list).getByRole("option", { name: /deepseek-r1/ })).toBeInTheDocument()
  })

  it("shows no headers when the provider reports no free models", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    const list = screen.getByRole("listbox")
    expect(within(list).queryByText("Free models")).not.toBeInTheDocument()
    expect(within(list).queryByText("All models")).not.toBeInTheDocument()
  })

  it("keeps focus and keyboard nav alive after clicking a section header", async () => {
    const user = userEvent.setup()
    const models: ModelLike[] = [
      { name: "openai/gpt-4o", vision: true },
      { name: "deepseek/deepseek-r1:free", vision: false, free: true },
    ]
    render(<Harness models={models} />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    // A header click must not blur the input (mousedown default prevented, like
    // option rows) — otherwise the still-open menu goes keyboard-dead.
    await user.click(within(screen.getByRole("listbox")).getByText("Free models"))
    expect(input).toHaveFocus()
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("deepseek/deepseek-r1:free")
  })

  it("falls back to Auto on open when the selected model is beyond the rendered cap", async () => {
    const user = userEvent.setup()
    const models: ModelLike[] = [
      { name: "m1", vision: false },
      { name: "m2", vision: false },
      { name: "m3", vision: false },
    ]
    // Options: Auto, m1, m2, m3 — cap of 3 renders Auto..m2, so selected m3 is
    // not visible. The highlight must land on Auto (index 0), not park on the
    // last visible row where Enter would commit the wrong model (m2).
    render(<Harness initial="m3" models={models} maxVisible={3} />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-opt-0$/)
    await user.keyboard("{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("AUTO")
  })

  it("tags the portalled listbox as overlay-interactive so the click-through window keeps mouse capture over it", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} />)
    await user.click(screen.getByRole("combobox"))
    // The menu is portalled to <body>, outside every tagged page container. Without
    // its own tag, App.tsx's hit-test would set mouse-ignore over the open menu and
    // clicks/wheel would fall through the overlay window (menu unclickable and
    // unscrollable while hover highlighting still works).
    expect(screen.getByRole("listbox")).toHaveAttribute("data-overlay-interactive")
  })

  it("shows a vision badge on vision-capable options and hides non-vision in a vision-only slot", async () => {
    const user = userEvent.setup()
    render(<Harness models={MODELS} visionOnly />)
    await user.click(screen.getByRole("combobox"))
    const list = screen.getByRole("listbox")
    expect(within(list).getAllByLabelText("vision-capable").length).toBeGreaterThan(0)
    // llama-3 is non-vision → excluded from a vision-only slot.
    expect(within(list).queryByRole("option", { name: /llama-3/ })).not.toBeInTheDocument()
  })
})
