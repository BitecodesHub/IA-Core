import React, { useState } from "react"
import MessageRenderer from "./MessageRenderer"

interface ThinkingAnswerRendererProps {
  text: string
}

const ThinkingAnswerRenderer: React.FC<ThinkingAnswerRendererProps> = ({ text }) => {
  const [showThinking, setShowThinking] = useState(false)

  // Parse the text to extract THINKING and ANSWER sections
  const parseResponse = (response: string) => {
    // Try to match THINKING and ANSWER sections (case insensitive)
    const thinkingRegex = /THINKING:\s*([\s\S]*?)(?=ANSWER:|$)/i
    const answerRegex = /ANSWER:\s*([\s\S]*?)$/i

    const thinkingMatch = response.match(thinkingRegex)
    const answerMatch = response.match(answerRegex)

    // If we found both sections
    if (thinkingMatch && answerMatch) {
      const thinking = thinkingMatch[1].trim()
      const answer = answerMatch[1].trim()
      return { thinking, answer, hasStructure: true }
    }

    // If only THINKING found (no ANSWER section yet)
    if (thinkingMatch && !answerMatch) {
      const thinking = thinkingMatch[1].trim()
      return { thinking, answer: "", hasStructure: true }
    }

    // If only ANSWER found (no THINKING section)
    if (!thinkingMatch && answerMatch) {
      const answer = answerMatch[1].trim()
      return { thinking: null, answer, hasStructure: false }
    }

    // No structure found, return original as answer
    return { thinking: null, answer: response, hasStructure: false }
  }

  const { thinking, answer, hasStructure } = parseResponse(text)

  // If no thinking section found, just render normally
  if (!thinking || !hasStructure) {
    return <MessageRenderer text={text} />
  }

  return (
    <div className="space-y-3">
      {/* Thinking Section - Only show if thinking content exists */}
      {thinking && thinking.trim().length > 0 && (
        <div className="border border-white/20 rounded-lg overflow-hidden bg-white/5">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/10 transition-colors text-left"
          >
            <span className="text-xs text-white/70 font-medium flex items-center gap-2">
              <span>💭</span>
              <span>Thinking Process</span>
            </span>
            <svg
              className={`w-4 h-4 text-white/70 transition-transform ${showThinking ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {showThinking && (
            <div className="px-3 py-3 text-xs text-white/90 border-t border-white/10 bg-black/30">
              <MessageRenderer text={thinking} />
            </div>
          )}
        </div>
      )}

      {/* Answer Section - Always Visible Below */}
      <div className="text-sm">
        <MessageRenderer text={answer} />
      </div>
    </div>
  )
}

export default ThinkingAnswerRenderer
