import { describe, it, expect } from "vitest"
import { extractCodeBlocks } from "../src/lib/extractCode"

describe("extractCodeBlocks", () => {
  it("extracts a single fenced block (language tag stripped, trailing newline trimmed)", () => {
    const text = "Here you go:\n```cpp\nint main(){return 0;}\n```\nDone."
    expect(extractCodeBlocks(text)).toBe("int main(){return 0;}")
  })

  it("concatenates multiple blocks", () => {
    const text = "```js\na()\n```\nmid\n```py\nb()\n```"
    expect(extractCodeBlocks(text)).toBe("a()\n\nb()")
  })

  it("returns null when there is no fenced code (never touches clipboard for prose)", () => {
    expect(extractCodeBlocks("The answer is 42.")).toBeNull()
    expect(extractCodeBlocks("")).toBeNull()
    expect(extractCodeBlocks(null as unknown as string)).toBeNull()
  })

  it("ignores an empty code block", () => {
    expect(extractCodeBlocks("```\n\n```")).toBeNull()
  })

  it("handles a fence with no language tag", () => {
    expect(extractCodeBlocks("```\nplain code\n```")).toBe("plain code")
  })

  it("preserves internal blank lines and indentation", () => {
    const code = "def f():\n    x = 1\n\n    return x"
    expect(extractCodeBlocks("```python\n" + code + "\n```")).toBe(code)
  })
})
