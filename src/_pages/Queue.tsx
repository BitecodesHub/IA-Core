import React, { useState, useEffect, useRef } from "react"
import { formatProviderError } from "../lib/providerError"
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

let messageSequence = 0

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
  const screenshotRequestRef = useRef<{ id: string; messageId: number; controller: AbortController } | null>(null)
  // Ids of assistant messages already scanned for code (copied once, silently).
  const copiedCodeRef = useRef<Set<number>>(new Set())
  // Ids of assistant messages already scanned for an MCQ answer (hinted once).
  const hintedMcqRef = useRef<Set<number>>(new Set())

  const handleChatSend = async () => {
    if (!chatInput.trim() || screenshotRequestRef.current) return
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    const userMsg: ChatMessage = { role: "user", text: chatInput, id: ++messageSequence }
    const aiId = ++messageSequence
    setChatMessages((prev) => [...prev, userMsg, { role: "assistant", text: "", id: aiId, isStreaming: true }])
    setChatLoading(true)
    setChatInput("")
    try {
      await streamChatResponse(chatInput, aiId, controller.signal)
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setChatMessages((prev) => prev.map((m) => m.id === aiId
          ? { ...m, text: [m.text, formatProviderError(err?.message ?? err)].filter(Boolean).join("\n\n"), isStreaming: false }
          : m))
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
        setChatLoading(false)
      }
    }
  }

  const stopRequests = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    const request = screenshotRequestRef.current
    screenshotRequestRef.current = null
    if (request) {
      request.controller.abort()
      void window.electronAPI.cancelScreenshotProcessing(request.id).catch(() => {})
    }
  }

  const handleStopChat = () => {
    stopRequests()
    setChatLoading(false)
    setChatMessages((prev) => prev.map((m) => m.isStreaming
      ? { ...m, text: m.text || "Stopped", isStreaming: false }
      : m))
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
      let settled = false
      let cancel = () => {}
      const finish = (text: string) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", abort)
        setChatMessages((prev) => prev.map((m) => m.id === messageId
          ? { ...m, text, isStreaming: false } : m))
        resolve()
      }
      const abort = () => {
        cancel()
        finish(acc || "Stopped")
      }
      if (signal?.aborted) { finish("Stopped"); return }
      cancel = window.electronAPI.chatStream(prompt, {
        onToken: (t) => {
          if (settled || signal?.aborted) return
          acc += t
          const text = acc
          setChatMessages((prev) => prev.map((m) => m.id === messageId
            ? { ...m, text, isStreaming: true } : m))
        },
        onDone: (full) => finish(full || acc),
        onError: (error) => finish([acc, formatProviderError(error)].filter(Boolean).join("\n\n")),
      })
      if (!settled) signal?.addEventListener("abort", abort, { once: true })
    })
  }

  // IPC listeners — registered ONCE (not coupled to tooltip state, which would
  // tear them down and re-subscribe on every tooltip toggle).
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onResetView(() => {
        stopRequests()
        setChatMessages([])
        setChatInput("")
        setChatLoading(false)
        copiedCodeRef.current.clear()
        hintedMcqRef.current.clear()
        void refetch()
      }),
      window.electronAPI.onSolutionError((error: string, requestId?: string) => {
        const request = screenshotRequestRef.current
        if (requestId && request?.id !== requestId) return
        const msg = error ? formatProviderError(error) : "Could not process that. Try again."
        if (request) {
          screenshotRequestRef.current = null
          setChatMessages((prev) => prev.map((m) => m.id === request.messageId
            ? { ...m, text: [m.text, msg].filter(Boolean).join("\n\n"), isStreaming: false } : m))
          setChatLoading(false)
        } else {
          setChatMessages((prev) => [...prev, { role: "assistant", text: msg, id: ++messageSequence }])
        }
        setView("queue")
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

  useEffect(() => {
    const unsub = window.electronAPI.onScreenshotTaken(async ({ path }) => {
      stopRequests()
      void refetch()
      setIsChatOpen(true)
      const request = { id: crypto.randomUUID(), messageId: ++messageSequence, controller: new AbortController() }
      screenshotRequestRef.current = request
      setChatLoading(true)
      setChatMessages((prev) => [
        ...prev.map((m) => m.isStreaming ? { ...m, text: m.text || "Stopped", isStreaming: false } : m),
        { role: "user", text: "Analyzing screenshot…", id: ++messageSequence, screenshotPath: path },
        { role: "assistant", text: "", id: request.messageId, isStreaming: true },
      ])
      try {
        const result = await window.electronAPI.processScreenshotWithChoice("answer", request.id)
        if (!result.success) throw new Error(result.error || "Couldn't analyze that. Try again.")
      } catch (error: any) {
        if (screenshotRequestRef.current !== request) return
        const text = formatProviderError(error?.message ?? error)
        setChatMessages((prev) => prev.map((m) => m.id === request.messageId
          ? { ...m, text: [m.text, text].filter(Boolean).join("\n\n"), isStreaming: false } : m))
      } finally {
        if (screenshotRequestRef.current === request) {
          screenshotRequestRef.current = null
          setChatLoading(false)
          setChatMessages((prev) => prev.map((m) => m.id === request.messageId ? { ...m, isStreaming: false } : m))
        }
      }
    })
    const onUpdate = (data: { requestId: string; problem_statement: string; isStreaming: boolean }) => {
      const request = screenshotRequestRef.current
      if (!request || request.id !== data.requestId || request.controller.signal.aborted) return
      setChatMessages((prev) => prev.map((m) => m.id === request.messageId
        ? { ...m, text: data.problem_statement, isStreaming: data.isStreaming } : m))
      if (!data.isStreaming) {
        screenshotRequestRef.current = null
        setChatLoading(false)
      }
    }
    const unsubStream = window.electronAPI.onScreenshotAnalysisStream(onUpdate)
    const unsubProblem = window.electronAPI.onProblemExtracted(onUpdate)
    return () => {
      unsub()
      unsubStream()
      unsubProblem()
      stopRequests()
    }
  }, [refetch])

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
