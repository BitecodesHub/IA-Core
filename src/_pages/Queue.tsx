import React, { useState, useEffect, useRef } from "react"
import { useQuery } from "react-query"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ModelSelector from "../components/ui/ModelSelector"
import ThinkingAnswerRenderer from "../components/ui/ThinkingAnswerRenderer"
import { QUERY_STALE_TIME, QUERY_CACHE_TIME, QUERY_RETRY_COUNT, QUERY_RETRY_DELAY, AUTO_SCROLL_THRESHOLD } from "../config/environment"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<{role: "user"|"gemini", text: string, id?: number, isStreaming?: boolean, screenshotPath?: string}[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const screenshotAbortControllerRef = useRef<AbortController | null>(null)
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string }>({ provider: "gemini", model: "gemini-3-pro-preview" })

  const barRef = useRef<HTMLDivElement>(null)

  const { data: screenshots = [], refetch, error: screenshotsError } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load screenshots", "error")
        return []
      }
    },
    {
      staleTime: QUERY_STALE_TIME,
      cacheTime: QUERY_CACHE_TIME,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: QUERY_RETRY_COUNT,
      retryDelay: QUERY_RETRY_DELAY
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        refetch()
      } else {
        console.error("Failed to delete screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  const handleChatSend = async () => {
    if (!chatInput.trim()) return;
    
    // Prevent new prompts if screenshot analysis is ongoing
    if (screenshotAbortControllerRef.current) {
      console.log('Screenshot analysis in progress. Please stop it first.');
      return;
    }
    
    // Stop any ongoing chat request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    const userMessage = { role: "user" as const, text: chatInput, id: Date.now() };
    const aiMessageId = Date.now() + 1;
    
    setChatMessages((msgs) => [...msgs, userMessage, { 
      role: "gemini" as const, 
      text: "", 
      id: aiMessageId,
      isStreaming: true 
    }]);
    setChatLoading(true);
    setChatInput("");
    
    try {
      await streamChatResponse(chatInput, aiMessageId, abortControllerRef.current.signal);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setChatMessages((msgs) => msgs.map(msg => 
          msg.id === aiMessageId 
            ? { ...msg, text: "⏹️ Stopped", isStreaming: false }
            : msg
        ));
      } else {
        setChatMessages((msgs) => msgs.map(msg => 
          msg.id === aiMessageId 
            ? { ...msg, text: "Error: " + String(err), isStreaming: false }
            : msg
        ));
      }
    } finally {
      setChatLoading(false);
      abortControllerRef.current = null;
      chatInputRef.current?.focus();
    }
  };

  // Function to stop ongoing chat
  const handleStopChat = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setChatLoading(false);
    }
    if (screenshotAbortControllerRef.current) {
      screenshotAbortControllerRef.current.abort();
      
      // Also cancel on the backend
      try {
        await window.electronAPI.cancelScreenshotProcessing();
      } catch (err) {
        console.error('Error canceling screenshot processing:', err);
      }
      
      setChatLoading(false);
      
      // Mark any streaming messages as stopped
      setChatMessages((msgs) => msgs.map(msg => 
        msg.isStreaming 
          ? { ...msg, text: msg.text + "\n\n⏹️ Analysis stopped by user", isStreaming: false }
          : msg
      ));
    }
  };

  // Function to handle streaming chat responses with conversation context
  const streamChatResponse = async (message: string, messageId: number, signal?: AbortSignal) => {
    try {
      // Build conversation context from previous messages
      const conversationHistory = chatMessages
        .filter(msg => !msg.isStreaming) // Only include completed messages
        .slice(-10) // Last 10 messages for context (5 exchanges)
        .map(msg => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.text
        }));

      // Create context-aware prompt
      let contextPrompt = message;
      if (conversationHistory.length > 0) {
        // Build conversation context
        const context = conversationHistory
          .map(msg => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
          .join("\n\n");
        
        contextPrompt = `Previous conversation:\n${context}\n\nUser: ${message}\n\nAssistant:`;
      }

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: currentModel.model,
          prompt: contextPrompt,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40
          }
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let accumulatedText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                accumulatedText += data.response;
                
                // Update the message in real-time
                setChatMessages((msgs) => msgs.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, text: accumulatedText, isStreaming: !data.done }
                    : msg
                ));
              }
              
              if (data.done) {
                // Mark streaming as complete
                setChatMessages((msgs) => msgs.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, isStreaming: false } 
                    : msg
                ));
                return;
              }
            } catch (parseError) {
              console.warn('Skipping invalid JSON line:', line.substring(0, 100));
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw abort errors
      }
      console.error('Streaming error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setChatMessages((msgs) => msgs.map(msg => 
        msg.id === messageId 
          ? { ...msg, text: `Error: ${errorMessage}`, isStreaming: false }
          : msg
      ));
    }
  };

  // Load current model configuration on mount
  useEffect(() => {
    const loadCurrentModel = async () => {
      try {
        const config = await window.electronAPI.getCurrentLlmConfig();
        setCurrentModel({ provider: config.provider, model: config.model });
      } catch (error) {
        console.error('Error loading current model config:', error);
      }
    };
    loadCurrentModel();
  }, []);

  // Auto-scroll chat to bottom only when new messages are added, not during streaming
  useEffect(() => {
    if (chatMessagesRef.current) {
      // Only scroll if we're already near the bottom or if it's a new message
      const { scrollTop, scrollHeight, clientHeight } = chatMessagesRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < AUTO_SCROLL_THRESHOLD;
      
      // Scroll to bottom only if user is already at the bottom
      if (isNearBottom) {
        chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
      }
    }
  }, [chatMessages.length]); // Only trigger on message count change, not content updates

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = contentRef.current.scrollWidth
        if (isTooltipVisible) {
          contentHeight += tooltipHeight
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  // Seamless screenshot-to-LLM flow - automatic analysis
  useEffect(() => {
    // Listen for screenshot taken event
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      console.log('[Queue] Screenshot taken event received:', data);
      
      // Refetch screenshots to update the queue
      const updatedScreenshots = await refetch();
      console.log('[Queue] Screenshots refetched, count:', updatedScreenshots?.data?.length);
      
      // Open chat automatically
      setIsChatOpen(true);
      
      // Get the LATEST screenshot from the updated queue
      const screenshotQueue = updatedScreenshots?.data || [];
      const latest = screenshotQueue.length > 0 ? screenshotQueue[screenshotQueue.length - 1]?.path : null;
      
      console.log('[Queue] Latest screenshot path:', latest);
      console.log('[Queue] All screenshots:', screenshotQueue.map(s => s.path));
      
      if (latest) {
        // Stop any ongoing requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          setChatLoading(false);
        }
        if (screenshotAbortControllerRef.current) {
          screenshotAbortControllerRef.current.abort();
        }
        
        // Create new abort controller for screenshot analysis
        screenshotAbortControllerRef.current = new AbortController();
        setChatLoading(true);
        
        // Add a user message showing screenshot is being analyzed
        setChatMessages((msgs) => [...msgs, {
          role: "user" as const,
          text: '📸 Analyzing screenshot...',
          id: Date.now(),
          screenshotPath: latest
        }]);
        
        console.log('[Queue] Starting screenshot analysis for:', latest);
        
        try {
          // Automatically process with smart analysis
          const result = await (window.electronAPI as any).processScreenshotWithChoice('answer');
          console.log('[Queue] Screenshot analysis result:', result);
          if (!result.success) {
            console.error('Screenshot analysis failed:', result.error);
            // Add error message to chat
            setChatMessages((msgs) => [...msgs, {
              role: "gemini" as const,
              text: `❌ Error: ${result.error || 'Screenshot analysis failed'}`,
              id: Date.now()
            }]);
          }
        } catch (err) {
          console.error('Error processing screenshot:', err);
          // Add error message to chat
          setChatMessages((msgs) => [...msgs, {
            role: "gemini" as const,
            text: `❌ Error: ${String(err)}`,
            id: Date.now()
          }]);
        } finally {
          screenshotAbortControllerRef.current = null;
          setChatLoading(false);
        }
      } else {
        console.error('[Queue] No screenshot path found after refetch');
      }
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [refetch]);

  // Listen for screenshot analysis results and add to chat
  useEffect(() => {
    const handleAnalysisStream = (data: any) => {
      // Ensure chat is open when streaming starts
      setIsChatOpen(true);
      setChatLoading(true);
      
      // Check if we already have a streaming message for this analysis
      setChatMessages((msgs) => {
        const hasStreamingMsg = msgs.some(msg => msg.isStreaming && msg.role === "gemini");
        
        if (hasStreamingMsg) {
          // Update existing streaming message
          return msgs.map(msg => 
            msg.isStreaming && msg.role === "gemini"
              ? { ...msg, text: data.problem_statement, isStreaming: data.isStreaming }
              : msg
          );
        } else {
          // Add new streaming message
          return [...msgs, {
            role: "gemini" as const,
            text: data.problem_statement,
            id: Date.now(),
            isStreaming: data.isStreaming
          }];
        }
      });
    };

    const handleProblemExtracted = (data: any) => {
      // Ensure chat is open when final result arrives
      setIsChatOpen(true);
      
      // Final update when streaming is complete
      setChatMessages((msgs) => {
        const hasStreamingMsg = msgs.some(msg => msg.isStreaming && msg.role === "gemini");
        
        if (hasStreamingMsg) {
          return msgs.map(msg => 
            msg.isStreaming && msg.role === "gemini"
              ? { ...msg, text: data.problem_statement, isStreaming: false }
              : msg
          );
        } else {
          // If no streaming message exists, add the final result
          return [...msgs, {
            role: "gemini" as const,
            text: data.problem_statement,
            id: Date.now(),
            isStreaming: false
          }];
        }
      });
      
      // Clear screenshot abort controller when done
      screenshotAbortControllerRef.current = null;
      setChatLoading(false);
    };

    // Register listeners
    const unsubscribeStream = (window.electronAPI as any).onScreenshotAnalysisStream(handleAnalysisStream);
    const unsubscribeProblem = window.electronAPI.onProblemExtracted(handleProblemExtracted);

    return () => {
      unsubscribeStream();
      unsubscribeProblem();
    };
  }, []);

  // Helper function to convert image to base64
  const getImageAsBase64 = async (imagePath: string): Promise<string> => {
    try {
      const response = await window.electronAPI.invoke('get-image-base64', imagePath);
      return response;
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  };

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen(!isSettingsOpen)
  }

  const handleModelChange = (provider: "ollama" | "gemini", model: string) => {
    setCurrentModel({ provider, model })
    // Update chat messages to reflect the model change
    const modelName = provider === "ollama" ? model : "Gemini 3 Pro"
    setChatMessages((msgs) => [...msgs, { 
      role: "gemini", 
      text: `🔄 Switched to ${provider === "ollama" ? "Ollama" : "☁️"} ${modelName}. Ready for your questions!` 
    }])
  }


  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        width: "100%",
        pointerEvents: "auto"
      }}
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
      {/* Main Command Bar - Always visible capsule */}
      <div className="flex flex-col items-center w-full">
        <QueueCommands
          screenshots={screenshots}
          onTooltipVisibilityChange={handleTooltipVisibilityChange}
          onChatToggle={handleChatToggle}
          onSettingsToggle={handleSettingsToggle}
        />
      
        {/* Conditional Settings Interface - Only when opened */}
        {isSettingsOpen && (
          <div className="mt-3 w-full max-w-2xl">
            <ModelSelector onModelChange={handleModelChange} onChatOpen={() => setIsChatOpen(true)} />
          </div>
        )}
        
        {/* Conditional Chat Interface - Only when opened */}
        {isChatOpen && (
          <div className="mt-3 w-full max-w-2xl">
            <div className="bg-black border-2 border-white rounded-lg p-4 flex flex-col">
            <div className="overflow-y-auto mb-3 p-3 rounded-lg bg-black border-2 border-white max-h-64 min-h-[120px]" ref={chatMessagesRef}>
              {chatMessages.length === 0 ? (
                <div className="text-center py-8">
                  {/* <div className="text-sm text-white mb-2">
                    💬 Chat with {currentModel.provider === "ollama" ? "🏠" : "☁️"} {currentModel.model}
                  </div> */}
                  <div className="text-xs text-white space-y-1">
                    <div>Take a screenshot (Cmd/Ctrl + H) for automatic analysis</div>
                    <div>Click Models to switch AI providers</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatMessages.map((msg, idx) => (
                    <div
                      key={msg.id || idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                          msg.role === "user" 
                            ? "bg-white text-white border-2 border-white" 
                            : "bg-black text-white border-2 border-white"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <span className="whitespace-pre-wrap">{msg.text}</span>
                        ) : (
                          <ThinkingAnswerRenderer text={msg.text || (msg.isStreaming ? "Generating response..." : "")} />
                        )}
                      </div>
                    </div>
                  ))}
                  {chatLoading && chatMessages.every(msg => !msg.isStreaming) && (
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
              onSubmit={e => {
                e.preventDefault();
                handleChatSend();
              }}
            >
              <input
                ref={chatInputRef}
                className="flex-1 bg-black border-2 border-white px-3 py-2 rounded-lg placeholder-white/60 focus:outline-none focus:border-white"
                style={{ color: '#ffffff' }}
                placeholder={chatLoading ? "Processing... Stop to send new message" : "Type your message..."}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              {chatLoading ? (
                <button
                  type="button"
                  onClick={handleStopChat}
                  className="bg-red-600 hover:bg-red-700 border-2 border-red-600 text-white px-3 py-2 rounded-lg"
                  aria-label="Stop"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="bg-white hover:bg-white/90 border-2 border-white text-black px-3 py-2 rounded-lg disabled:opacity-50"
                  disabled={chatLoading || !chatInput.trim()}
                  aria-label="Send"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                  </svg>
                </button>
              )}
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export default Queue
