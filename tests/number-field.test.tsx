import React, { useState } from "react"
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import NumberField from "../src/components/ui/NumberField"

function Harness({ min, max, step }: { min: number; max: number; step: number }) {
  const [v, setV] = useState(1)
  return (
    <>
      <NumberField label="Temp" value={v} min={min} max={max} step={step} hint="h" onCommit={setV} />
      <div data-testid="v">{v}</div>
    </>
  )
}

describe("NumberField clamping", () => {
  it("clamps an over-max value on blur", () => {
    render(<Harness min={0} max={2} step={0.1} />)
    const input = screen.getByLabelText("Temp") as HTMLInputElement
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.blur(input)
    expect(screen.getByTestId("v")).toHaveTextContent("2")
  })

  it("clamps an under-min value on blur", () => {
    render(<Harness min={0} max={2} step={0.1} />)
    const input = screen.getByLabelText("Temp") as HTMLInputElement
    fireEvent.change(input, { target: { value: "-3" } })
    fireEvent.blur(input)
    expect(screen.getByTestId("v")).toHaveTextContent("0")
  })

  it("commits an in-range value unchanged", () => {
    render(<Harness min={0} max={2} step={0.1} />)
    const input = screen.getByLabelText("Temp") as HTMLInputElement
    fireEvent.change(input, { target: { value: "1.5" } })
    fireEvent.blur(input)
    expect(screen.getByTestId("v")).toHaveTextContent("1.5")
  })

  it("ignores an empty value (does not silently commit 0, reverts to prior)", () => {
    render(<Harness min={256} max={4096} step={256} />)
    const input = screen.getByLabelText("Temp") as HTMLInputElement
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)
    // Prior value (1) is retained rather than committing 0 (which would bypass min=256).
    expect(screen.getByTestId("v")).toHaveTextContent("1")
  })
})

describe("TextField accessible name", () => {
  it("names the field by its label alone, not label + hint", async () => {
    const { default: TextField } = await import("../src/components/ui/TextField")
    render(
      <TextField
        label="Endpoint"
        value="https://api.groq.com/openai/v1"
        hint="Groq endpoint is fixed for security."
        readOnly
        onCommit={() => {}}
      />
    )
    // A nested sr-only hint used to be concatenated into the label text, so the
    // accessible name was "Endpoint Groq endpoint is fixed for security."
    const input = screen.getByLabelText("Endpoint") as HTMLInputElement
    expect(input.value).toBe("https://api.groq.com/openai/v1")
    expect(input.readOnly).toBe(true)
    // The hint stays available as a description.
    expect(input.getAttribute("aria-describedby")).toBeTruthy()
  })
})
