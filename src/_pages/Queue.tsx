import React, { useState, useEffect, useRef } from "react"
import { Toast, ToastTitle, ToastDescription } from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ChatPanel, { ChatMessage } from "../components/Queue/ChatPanel"
import SettingsPanel from "../components/Settings/SettingsPanel"
import { useSettings } from "../components/Settings/useSettings"
import { useToast } from "../hooks/useToast"
import { useScreenshots } from "../hooks/useScreenshots"
import { useLocalShortcuts } from "../hooks/useLocalShortcuts"
import { extractCodeBlocks } from "../lib/extractCode"
import { parseMcqAnswer } from "../lib/mcqAnswer"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const { toastOpen, setToastOpen, toastMessage } = useToast()
  const { screenshots, refetch } = useScreenshots()
  const { settings } = useSettings()

  // Mode is derived from the active provider (single source of truth). Defaults
  // to offline until settings load, and whenever the local Ollama provider is active.
  const activeProviderId = settings?.ai.activeProviderId ?? "ollama"
  const mode: "offline" | "online" = activeProviderId === "ollama" ? "offline" : "online"

  const contentRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const screenshotAbortControllerRef = useRef<AbortController | null>(null)
  // Ids of assistant messages already scanned for code (copied once, silently).
  const copiedCodeRef = useRef<Set<number>>(new Set())
  // Ids of assistant messages already scanned for an MCQ answer (hinted once).
  const hintedMcqRef = useRef<Set<number>>(new Set())

  const handleChatSend = async () => {
    if (!chatInput.trim()) return
    if (screenshotAbortControllerRef.current) return // screenshot analysis in progress

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    const userMsg: ChatMessage = { role: "user", text: chatInput, id: Date.now() }
    const aiId = Date.now() + 1
    setChatMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", text: "", id: aiId, isStreaming: true },
    ])
    setChatLoading(true)
    setChatInput("")

    try {
      await streamChatResponse(chatInput, aiId, abortControllerRef.current.signal)
    } catch (err: any) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? {
                ...m,
                text: err.name === "AbortError" ? "Stopped" : "Couldn't complete that. Try again.",
                isStreaming: false,
              }
            : m
        )
      )
    } finally {
      setChatLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleStopChat = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setChatLoading(false)
    }
    if (screenshotAbortControllerRef.current) {
      screenshotAbortControllerRef.current.abort()
      try {
        await window.electronAPI.cancelScreenshotProcessing()
      } catch {}
      setChatLoading(false)
      setChatMessages((prev) =>
        prev.map((m) =>
          m.isStreaming ? { ...m, text: m.text + "\n\n⏹ Analysis stopped", isStreaming: false } : m
        )
      )
    }
  }

  useLocalShortcuts(settings?.localShortcuts.bindings, {
    toggleChat: () => setIsChatOpen((v) => !v),
    toggleSettings: () => setIsSettingsOpen((v) => !v),
    focusChat: () => {
      setIsChatOpen(true)
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('[data-chat-input="true"]')?.focus()
      })
    },
    closePanels: () => {
      setIsChatOpen(false)
      setIsSettingsOpen(false)
    },
    stopGeneration: () => {
      handleStopChat()
    },
  })

  const streamChatResponse = (message: string, messageId: number, signal?: AbortSignal) => {
    const history = chatMessages
      .filter((m) => !m.isStreaming)
      .slice(-10)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))

    let prompt = message
    if (history.length > 0) {
      const ctx = history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n")
      prompt = `Previous conversation:\n${ctx}\n\nUser: ${message}\n\nAssistant:`
    }

    return new Promise<void>((resolve) => {
      let acc = ""
      const cancel = window.electronAPI.chatStream(prompt, {
        onToken: (t) => {
          acc += t
          setChatMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, text: acc, isStreaming: true } : m))
          )
        },
        onDone: () => {
          setChatMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m))
          )
          resolve()
        },
        onError: () => {
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, text: "Couldn't complete that. Try again.", isStreaming: false }
                : m
            )
          )
          resolve()
        },
      })

      if (signal) {
        if (signal.aborted) {
          cancel()
          resolve()
        } else {
          signal.addEventListener(
            "abort",
            () => {
              cancel()
              setChatMessages((prev) =>
                prev.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m))
              )
              resolve()
            },
            { once: true }
          )
        }
      }
    })
  }

  // Window dimension sync — a ResizeObserver reports content growth.
  useEffect(() => {
    const update = () => {
      if (!contentRef.current) return
      window.electronAPI.updateContentDimensions({
        width: contentRef.current.scrollWidth,
        height: contentRef.current.scrollHeight,
      })
    }
    const ro = new ResizeObserver(update)
    if (contentRef.current) ro.observe(contentRef.current)
    update()
    return () => ro.disconnect()
  }, [])

  // IPC listeners — registered ONCE (not coupled to tooltip state, which would
  // tear them down and re-subscribe on every tooltip toggle).
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        // Stealth: no toast pop. Finalize any streaming placeholder in-place with a
        // subtle, in-context message so it never hangs on "Generating response…".
        const msg =
          (error || "").trim().split("\n")[0].slice(0, 200) || "Could not process that. Try again."
        setChatMessages((prev) => {
          const hasStreaming = prev.some((m) => m.isStreaming && m.role === "assistant")
          if (hasStreaming) {
            return prev.map((m) =>
              m.isStreaming && m.role === "assistant" ? { ...m, text: msg, isStreaming: false } : m
            )
          }
          return [...prev, { role: "assistant" as const, text: msg, id: Date.now() }]
        })
        setChatLoading(false)
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        // Nothing to process — stay silent (no pop).
      }),
      window.electronAPI.onScreenshotError(({ message, code, actionable }) => {
        // Stealth: no toast. Note it inline; only open a settings pane when the
        // OS actually has one for this failure. Windows has NO screen-capture
        // privacy setting, so `actionable` is false there and we must not send
        // the user hunting for a permission that does not exist.
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            text: (message || "Screenshot failed.").slice(0, 300),
            id: Date.now(),
          },
        ])
        if (code === "SCREEN_PERMISSION" && actionable) {
          window.electronAPI.openPrivacySettings("screen")
        }
      }),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [])

  // Auto-screenshot-to-LLM flow
  useEffect(() => {
    const unsub = window.electronAPI.onScreenshotTaken(async () => {
      const updated = await refetch()
      setIsChatOpen(true)

      const queue = updated?.data ?? []
      const latest = queue.length > 0 ? queue[queue.length - 1]?.path : null
      if (!latest) return

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        setChatLoading(false)
      }
      if (screenshotAbortControllerRef.current) {
        screenshotAbortControllerRef.current.abort()
      }

      screenshotAbortControllerRef.current = new AbortController()
      setChatLoading(true)
      setChatMessages((prev) => [
        ...prev,
        {
          role: "user" as const,
          text: "📸 Analyzing screenshot…",
          id: Date.now(),
          screenshotPath: latest,
        },
      ])

      try {
        const result = await window.electronAPI.processScreenshotWithChoice("answer")
        if (!result.success) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              text: result.error ?? "Couldn't analyze that. Try again.",
              id: Date.now(),
            },
          ])
        }
      } catch {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant" as const, text: "Couldn't analyze that. Try again.", id: Date.now() },
        ])
      } finally {
        screenshotAbortControllerRef.current = null
        setChatLoading(false)
      }
    })
    return () => unsub?.()
  }, [refetch])

  // Screenshot analysis streaming
  useEffect(() => {
    const onStream = (data: any) => {
      setIsChatOpen(true)
      setChatLoading(true)
      setChatMessages((prev) => {
        const hasStreaming = prev.some((m) => m.isStreaming && m.role === "assistant")
        if (hasStreaming) {
          return prev.map((m) =>
            m.isStreaming && m.role === "assistant"
              ? { ...m, text: data.problem_statement, isStreaming: data.isStreaming }
              : m
          )
        }
        return [
          ...prev,
          {
            role: "assistant" as const,
            text: data.problem_statement,
            id: Date.now(),
            isStreaming: data.isStreaming,
          },
        ]
      })
    }

    const onProblem = (data: any) => {
      setIsChatOpen(true)
      // The initial problem-extracted arrives with isStreaming:true and empty text.
      // Treat it as a streaming placeholder (ChatPanel shows "Generating response…")
      // so Claude's multi-second vision latency never looks frozen. Only the FINAL
      // event (isStreaming:false) finalizes the single bubble and re-enables input.
      const streaming = Boolean(data.isStreaming)
      setChatMessages((prev) => {
        const hasStreaming = prev.some((m) => m.isStreaming && m.role === "assistant")
        if (hasStreaming) {
          return prev.map((m) =>
            m.isStreaming && m.role === "assistant"
              ? { ...m, text: data.problem_statement, isStreaming: streaming }
              : m
          )
        }
        return [
          ...prev,
          {
            role: "assistant" as const,
            text: data.problem_statement,
            id: Date.now(),
            isStreaming: streaming,
          },
        ]
      })
      if (!streaming) {
        screenshotAbortControllerRef.current = null
        setChatLoading(false)
      }
    }

    const unsubStream = window.electronAPI.onScreenshotAnalysisStream(onStream)
    const unsubProblem = window.electronAPI.onProblemExtracted(onProblem)
    return () => {
      unsubStream?.()
      unsubProblem?.()
    }
  }, [])

  // Silently copy generated code to the clipboard the moment a response finishes.
  // No UI, no toast, no focus change — the code is just made available to paste.
  // Only completed (non-streaming) assistant messages containing a fenced code
  // block are copied, and each message is copied at most once.
  useEffect(() => {
    for (const m of chatMessages) {
      if (m.role !== "assistant" || m.isStreaming || m.id == null) continue
      if (copiedCodeRef.current.has(m.id)) continue
      copiedCodeRef.current.add(m.id)
      const code = extractCodeBlocks(m.text)
      if (code) void window.electronAPI.copyToClipboard(code)
    }
  }, [chatMessages])

  // When a completed answer is multiple-choice, blink positional dots on the
  // stealth overlay (A=top-left … E=centre) so the option is conveyed without
  // reading text. Each message is hinted at most once. Mirrors the code-copy pass.
  useEffect(() => {
    for (const m of chatMessages) {
      if (m.role !== "assistant" || m.isStreaming || m.id == null) continue
      if (hintedMcqRef.current.has(m.id)) continue
      hintedMcqRef.current.add(m.id)
      const mcq = parseMcqAnswer(m.text)
      if (mcq) window.electronAPI.showMcqHint(mcq.letters)
    }
  }, [chatMessages])

  return (
    <div
      ref={barRef}
      style={{ position: "relative", width: "100%", pointerEvents: "auto" }}
      className="select-none"
    >
      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        variant={toastMessage.variant}
        duration={3000}
      >
        <ToastTitle>{toastMessage.title}</ToastTitle>
        <ToastDescription>{toastMessage.description}</ToastDescription>
      </Toast>

      <div ref={contentRef} className="flex flex-col items-center w-full">
        <QueueCommands
          screenshots={screenshots}
          mode={mode}
          onChatToggle={() => setIsChatOpen((v) => !v)}
          onSettingsToggle={() => setIsSettingsOpen((v) => !v)}
        />

        {isSettingsOpen && (
          <div className="mt-3 w-full max-w-2xl" data-overlay-interactive>
            <SettingsPanel />
          </div>
        )}

        {isChatOpen && (
          <div className="mt-3 w-full max-w-2xl" data-overlay-interactive>
            <ChatPanel
              messages={chatMessages}
              input={chatInput}
              loading={chatLoading}
              onInputChange={setChatInput}
              onSend={handleChatSend}
              onStop={handleStopChat}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default Queue
