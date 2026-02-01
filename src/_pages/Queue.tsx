import React, { useState, useEffect, useRef } from "react"
import { useQuery } from "react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ModelSelector from "../components/ui/ModelSelector"

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
  const [chatMessages, setChatMessages] = useState<{role: "user"|"gemini", text: string, id?: number, isStreaming?: boolean}[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string }>({ provider: "gemini", model: "gemini-3-pro-preview" })

  // Screenshot analysis popup state
  const [showAnalysisPopup, setShowAnalysisPopup] = useState(false)
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null)

  const barRef = useRef<HTMLDivElement>(null)

  const { data: screenshots = [], refetch } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
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
      await streamChatResponse(chatInput, aiMessageId);
    } catch (err) {
      setChatMessages((msgs) => msgs.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, text: "Error: " + String(err), isStreaming: false }
          : msg
      ));
    } finally {
      setChatLoading(false);
      chatInputRef.current?.focus();
    }
  };

  // Function to handle streaming chat responses
  const streamChatResponse = async (message: string, messageId: number) => {
    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: currentModel.model,
          prompt: message,
          stream: true
        }),
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
    } catch (error) {
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

  // Seamless screenshot-to-LLM flow with analysis choice popup
  useEffect(() => {
    // Listen for screenshot taken event
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      // Refetch screenshots to update the queue
      await refetch();
      
      // Show popup to choose analysis type
      const latest = data?.path || (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path);
      if (latest) {
        setPendingScreenshot(latest);
        setShowAnalysisPopup(true);
      }
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [refetch]);

  // Handle analysis choice
  const handleAnalysisChoice = async (choice: 'analyze' | 'answer') => {
    setShowAnalysisPopup(false);
    
    if (!pendingScreenshot) return;
    
    try {
      // Call the backend to process with the chosen analysis type
      const result = await window.electronAPI.processScreenshotWithChoice(choice);
      if (!result.success) {
        console.error('Screenshot analysis failed:', result.error);
      }
    } catch (err) {
      console.error('Error processing screenshot choice:', err);
    } finally {
      setPendingScreenshot(null);
    }
  };

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
      {/* Screenshot Analysis Choice Popup */}
      {showAnalysisPopup && (
        <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
          <div className="bg-black border border-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-white text-lg font-medium mb-4">Choose Analysis Type</h3>
            <p className="text-white text-sm mb-6">How would you like me to process this screenshot?</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleAnalysisChoice('analyze')}
                className="flex-1 bg-black hover:bg-white hover:text-black border border-white text-white px-4 py-3 rounded-lg transition-colors"
              >
                <div className="text-sm font-medium">📊 Analyze</div>
                <div className="text-xs mt-1">Describe and analyze the content</div>
              </button>
              <button
                onClick={() => handleAnalysisChoice('answer')}
                className="flex-1 bg-black hover:bg-white hover:text-black border border-white text-white px-4 py-3 rounded-lg transition-colors"
              >
                <div className="text-sm font-medium">💡 Answer Code</div>
                <div className="text-xs mt-1">Provide solution or answer</div>
              </button>
            </div>
          </div>
        </div>
      )}
      
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
            <div className="overflow-y-auto mb-3 p-3 rounded-lg bg-black border-2 border-white max-h-64 min-h-[120px]">
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
                        {msg.text || (msg.isStreaming ? "Generating response..." : "")}
                        {msg.isStreaming && (
                          <span className="inline-flex ml-2 text-white/60">●</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      {/* <div className="bg-black text-white border border-white/20 px-3 py-2 rounded-lg text-sm">
                        <div className="flex items-center space-x-2">
                          // <span className="text-white">●</span>
                          <span className="text-white">{currentModel.model} is thinking...</span>
                        </div>
                      </div> */}
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
                placeholder="Type your message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="bg-white hover:bg-white/90 border-2 border-white text-white px-3 py-2 rounded-lg disabled:opacity-50"
                disabled={chatLoading || !chatInput.trim()}
                aria-label="Send"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export default Queue
