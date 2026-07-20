import React, { useRef, useEffect } from "react"
import ThinkingAnswerRenderer from "../ui/ThinkingAnswerRenderer"
import { AUTO_SCROLL_THRESHOLD } from "../../config/environment"
import { stripMcqMarker } from "../../lib/mcqAnswer"

export interface ChatMessage {
  role: "user" | "assistant"
  text: string
  id?: number
  isStreaming?: boolean
  screenshotPath?: string
}

// Memoized so a token update (which replaces the messages array) only re-renders
// and re-parses the single message whose text/isStreaming actually changed,
// instead of re-running the regex parse for every message on every token.
const MessageBubble = React.memo(function MessageBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
          msg.role === "user"
            ? "bg-white text-black border-2 border-white"
            : "bg-black text-white border-2 border-white"
        }`}
      >
        {msg.role === "user" ? (
          <span className="whitespace-pre-wrap">{msg.text}</span>
        ) : (
          <ThinkingAnswerRenderer
            text={stripMcqMarker(msg.text) || (msg.isStreaming ? "Generating response..." : "")}
          />
        )}
      </div>
    </div>
  )
})

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  loading: boolean
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  input,
  loading,
  onInputChange,
  onSend,
  onStop,
}) => {
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!messagesRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = messagesRef.current
    if (scrollHeight - scrollTop - clientHeight < AUTO_SCROLL_THRESHOLD) {
      messagesRef.current.scrollTop = scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  return (
    <div className="bg-black border-2 border-white rounded-lg p-4 flex flex-col">
      <div
        ref={messagesRef}
        className="overflow-y-auto mb-3 p-3 rounded-lg bg-black border-2 border-white max-h-64 min-h-[120px]"
      >
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-xs text-white space-y-1">
              <div>Take a screenshot (Cmd/Ctrl + H) for automatic analysis</div>
              <div>Click Models to switch AI providers</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => (
              <MessageBubble key={msg.id ?? idx} msg={msg} />
            ))}
            {loading && messages.every((m) => !m.isStreaming) && (
              <div className="flex justify-start">
                <div className="bg-black text-white border-2 border-white px-3 py-2 rounded-lg text-sm">
                  <div className="flex items-center space-x-2">
                    <span className="animate-pulse">●</span>
                    <span>Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        className="flex gap-2 items-center"
        onSubmit={(e) => {
          e.preventDefault()
          onSend()
        }}
      >
        <input
          ref={inputRef}
          data-chat-input="true"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="ia-chat-input"
          className="flex-1 bg-black border-2 border-white px-3 py-2 rounded-lg placeholder-white/60 focus:outline-none focus:border-white"
          style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff", caretColor: "#ffffff" }}
          placeholder={loading ? "Processing… stop to send a new message" : "Type your message…"}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={loading}
        />
        {loading ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-red-600 hover:bg-red-700 border-2 border-red-600 text-white px-3 py-2 rounded-lg"
            aria-label="Stop"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 24 24"
              className="w-4 h-4"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            className="bg-white hover:bg-white/90 border-2 border-white text-black px-3 py-2 rounded-lg disabled:opacity-50"
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z"
              />
            </svg>
          </button>
        )}
      </form>
    </div>
  )
}

export default ChatPanel
