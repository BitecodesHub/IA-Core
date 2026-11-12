import React from "react"
import CodeBlock from "./CodeBlock"

interface MessageRendererProps {
  text: string
}

function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n]+\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-black/10 px-1 font-mono">{part.slice(1, -1)}</code>
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{inline(part.slice(2, -2))}</strong>
    }
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
}

function prose(text: string): React.ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: React.ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(lines[i])
    if (heading) {
      const Tag = `h${heading[1].length}` as keyof JSX.IntrinsicElements
      blocks.push(<Tag key={i} className="mb-1 mt-2 font-semibold">{inline(heading[2])}</Tag>)
      i++
      continue
    }
    const list = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(lines[i])
    if (list) {
      const ordered = !list[1]
      const start = ordered ? parseInt(lines[i].trim(), 10) : undefined
      const items: React.ReactNode[] = []
      const key = i
      while (i < lines.length) {
        const item = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(lines[i])
        if (!item || !item[1] !== ordered) break
        items.push(<li key={i}>{inline(item[2])}</li>)
        i++
      }
      blocks.push(ordered
        ? <ol key={key} start={start} className="my-1 list-decimal space-y-1 pl-5">{items}</ol>
        : <ul key={key} className="my-1 list-disc space-y-1 pl-5">{items}</ul>)
      continue
    }
    const key = i
    const paragraph = [lines[i++]]
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++])
    blocks.push(<p key={key} className="my-1 whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>)
  }
  return blocks
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ text }) => {
  const parts: React.ReactNode[] = []
  const fences = /```([\w+-]*)[^\S\n]*\r?\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = fences.exec(text)) !== null) {
    if (match.index > last) parts.push(<React.Fragment key={`text-${last}`}>{prose(text.slice(last, match.index))}</React.Fragment>)
    parts.push(<CodeBlock key={`code-${match.index}`} code={match[2].replace(/\r?\n$/, "")} language={match[1] || "text"} />)
    last = fences.lastIndex
  }
  if (last < text.length) parts.push(<React.Fragment key={`text-${last}`}>{prose(text.slice(last))}</React.Fragment>)
  return <div className="break-words">{parts}</div>
}

export default MessageRenderer
