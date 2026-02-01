import React from 'react'
import CodeBlock from './CodeBlock'

interface MessageRendererProps {
  text: string
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ text }) => {
  // Parse code blocks with language detection
  const parseMessage = (message: string) => {
    const parts: JSX.Element[] = []
    
    // Regex to match code blocks with optional language
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
    let lastIndex = 0
    let match

    while ((match = codeBlockRegex.exec(message)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        const textBefore = message.substring(lastIndex, match.index)
        parts.push(
          <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
            {textBefore}
          </span>
        )
      }

      // Add code block
      const language = match[1] || 'text'
      const code = match[2].trim()
      parts.push(
        <CodeBlock key={`code-${match.index}`} code={code} language={language} />
      )

      lastIndex = match.index + match[0].length
    }

    // Add remaining text after last code block
    if (lastIndex < message.length) {
      const textAfter = message.substring(lastIndex)
      parts.push(
        <span key={`text-${lastIndex}`} className="whitespace-pre-wrap">
          {textAfter}
        </span>
      )
    }

    return parts.length > 0 ? parts : <span className="whitespace-pre-wrap">{message}</span>
  }

  return <div className="break-words">{parseMessage(text)}</div>
}

export default MessageRenderer
