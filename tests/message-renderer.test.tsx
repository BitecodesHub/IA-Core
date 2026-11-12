import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import MessageRenderer from "../src/components/ui/MessageRenderer"

vi.mock("../src/components/ui/CodeBlock", () => ({ default: ({ code, language }: { code: string; language: string }) => <pre data-language={language}>{code}</pre> }))

describe("message formatting", () => {
  it("renders headings, emphasis, inline code, paragraphs and both list types", () => {
    render(<MessageRenderer text={"## Overview\n\n**Brief Summary** and *emphasis*\n\n- Learn `Java`\n- Practice\n\n3. Compile\n4. Run"} />)
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Overview")
    expect(screen.getByText("Brief Summary").tagName).toBe("STRONG")
    expect(screen.getByText("emphasis").tagName).toBe("EM")
    expect(screen.getByText("Java").tagName).toBe("CODE")
    expect(screen.getAllByRole("listitem")).toHaveLength(4)
    expect(screen.getAllByRole("list")[1]).toHaveAttribute("start", "3")
  })

  it("preserves fenced code indentation without interpreting Markdown", () => {
    render(<MessageRenderer text={"Before\n```c++\n  **literal**\n```\nAfter"} />)
    expect(screen.getByText("**literal**")).toHaveTextContent("**literal**")
    expect(screen.getByText("**literal**").textContent).toBe("  **literal**")
    expect(screen.getByText("**literal**")).toHaveAttribute("data-language", "c++")
    expect(screen.getByText("After")).toBeInTheDocument()
  })

  it("keeps HTML and unsafe links inert", () => {
    const { container } = render(<MessageRenderer text={'<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[click](javascript:alert(1))'} />)
    expect(container.querySelector("img, script, a")).toBeNull()
    expect(container.textContent).toContain("<script>alert(1)</script>")
  })

  it("handles unfinished streaming Markdown and mixed adjacent lists", () => {
    render(<MessageRenderer text={"**unfinished\n\n- first\n1. second\n\n```js\nunclosed"} />)
    expect(screen.getByText("**unfinished")).toBeInTheDocument()
    expect(screen.getAllByRole("list")).toHaveLength(2)
    expect(screen.getByText(/unclosed/)).toBeInTheDocument()
  })
})
