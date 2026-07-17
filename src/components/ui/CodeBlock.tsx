import React, { useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"

interface CodeBlockProps {
  code: string
  language: string
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err)
    }
  }

  return (
    <div className="relative group my-2">
      <div className="flex items-center justify-between bg-[#1e1e1e] border border-white/20 rounded-t-lg px-3 py-2">
        <span className="text-xs text-white/60 font-mono">{language}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-white/60 hover:text-white transition-colors px-2 py-1 rounded border border-white/20 hover:border-white/40"
        >
          {copied ? "✓ Copied!" : "Copy code"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          borderRadius: "0 0 0.5rem 0.5rem",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          borderTop: "none",
          fontSize: "0.875rem",
          lineHeight: "1.5",
        }}
        showLineNumbers={true}
        wrapLines={true}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export default CodeBlock
