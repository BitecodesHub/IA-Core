// Extracts fenced code blocks (```lang\n...\n```) from a (completed) assistant
// message. Used to silently copy generated code to the clipboard when a response
// finishes streaming. Returns the concatenated code of all blocks, or null when
// the text contains no fenced code — so non-code answers never touch the clipboard.

export function extractCodeBlocks(text: string): string | null {
  if (!text || typeof text !== "string") return null
  const fence = /```[^\n]*\n([\s\S]*?)```/g
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) {
    const code = m[1].replace(/\n+$/, "")
    if (code.trim().length > 0) blocks.push(code)
  }
  if (blocks.length === 0) return null
  return blocks.join("\n\n")
}
