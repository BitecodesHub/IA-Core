import React, { useState, useEffect, useRef } from "react"
import { IoLogOutOutline } from "react-icons/io5"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshots,
  onChatToggle,
  onSettingsToggle
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioResult, setAudioResult] = useState<string | null>(null)
  const chunks = useRef<Blob[]>([])

  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible])

  useEffect(() => {
    if (audioResult) {
      const timer = setTimeout(() => {
        setAudioResult(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [audioResult])

  const handleTooltipToggle = () => {
    setIsTooltipVisible(!isTooltipVisible)
  }

  const handleRecordClick = async () => {
    if (!isRecording) {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => chunks.current.push(e.data)
        recorder.onstop = async () => {
          const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || 'audio/webm' })
          chunks.current = []
          const reader = new FileReader()
          reader.onloadend = async () => {
            const base64Data = (reader.result as string).split(',')[1]
            try {
              const result = await window.electronAPI.analyzeAudioFromBase64(base64Data, blob.type)
              setAudioResult(result.text)
            } catch (err) {
              setAudioResult('Audio analysis failed.')
            }
          }
          reader.readAsDataURL(blob)
        }
        setMediaRecorder(recorder)
        recorder.start()
        setIsRecording(true)
      } catch (err) {
        setAudioResult('Could not start recording.')
      }
    } else {
      // Stop recording
      mediaRecorder?.stop()
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  return (
    <div className="w-fit p-1">
      <style>{`
        @keyframes glow-pulse {
          0%, 100% {
            box-shadow: 0 0 3px rgba(255, 255, 255, 0.3),
                        0 0 5px rgba(255, 255, 255, 0.2);
          }
          50% {
            box-shadow: 0 0 5px rgba(255, 255, 255, 0.4),
                        0 0 8px rgba(255, 255, 255, 0.25);
          }
        }

        @keyframes border-flow {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }  
        
        .glass-capsule {
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 2px solid #ffffff;
          border-radius: 9999px;
          position: relative;
          overflow: visible;
          min-height: 48px;
          padding: 8px 16px;
          isolation: isolate;
          will-change: auto;
        }
        
        .glass-capsule::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.6),
            rgba(255, 255, 255, 0.1),
            rgba(255, 255, 255, 0.6)
          );
          background-size: 200% 100%;
          animation: border-flow 3s linear infinite;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          opacity: 0.4;
        }

        .logo-circle {
          position: relative;
          background: #000000;
          overflow: hidden;
        }

        .logo-circle::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: inherit;
          padding: 2px;
          background: linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.7),
            rgba(255, 255, 255, 0.2),
            rgba(255, 255, 255, 0.7)
          );
          background-size: 200% 200%;
          animation: border-flow 2s linear infinite;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }

        .stable-button {
          background: #000000;
          border: 1px solid rgba(255, 255, 255, 0.5);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          position: relative;
          isolation: isolate;
          will-change: border-color, box-shadow;
        }

        .stable-button:hover {
          background: #ffffff;
          color: #000000;
          border-color: rgba(255, 255, 255, 1);
        }

        .help-button {
          background: #000000;
          border: 1px solid rgba(255, 255, 255, 0.5);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          position: relative;
          isolation: isolate;
          will-change: border-color, box-shadow;
        }

        .help-button:hover {
          background: #000000;
          border-color: rgba(255, 255, 255, 1);
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
        }
      `}</style>

      <div className="text-xs text-white glass-capsule sm:px-6 flex items-center justify-center gap-3 sm:gap-4 draggable-area rounded-full relative">
        {/* Logo Circle with Ismail's AI */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="logo-circle w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 border-white">
            <span className="text-xs sm:text-sm font-bold text-white">IA</span>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-white whitespace-nowrap">Ismail's AI</span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-white/30" />

        {/* Show/Hide */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] sm:text-[11px] leading-none text-white whitespace-nowrap">Show/Hide</span>
          <div className="flex gap-1">
            <button className="stable-button rounded-lg px-2 py-1 text-[10px] sm:text-[11px] leading-none text-white">
              ⌘
            </button>
            <button className="stable-button rounded-lg px-2 py-1 text-[10px] sm:text-[11px] leading-none text-white">
              B
            </button>
          </div>
        </div>

        {/* Solve Command */}
        {screenshots.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] sm:text-[11px] leading-none text-white whitespace-nowrap">Solve</span>
            <div className="flex gap-1">
              <button className="stable-button rounded-lg px-2 py-1 text-[10px] sm:text-[11px] leading-none text-white">
                ⌘
              </button>
              <button className="stable-button rounded-lg px-2 py-1 text-[10px] sm:text-[11px] leading-none text-white">
                ↵
              </button>
            </div>
          </div>
        )}

        {/* Voice Recording Button */}
        <div className="flex items-center gap-2">
          <button
            className={`stable-button rounded-lg px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] leading-none text-white flex items-center gap-1 ${
              isRecording ? '!bg-red-600 !border-red-400' : ''
            }`}
            onClick={handleRecordClick}
            type="button"
          >
            {isRecording ? (
              <span className="whitespace-nowrap">●Stop</span>
            ) : (
              <span className="whitespace-nowrap">Record</span>
            )}
          </button>
        </div>

        {/* Chat Button */}
        <div className="flex items-center gap-2">
          <button
            className="stable-button rounded-lg px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] leading-none text-white flex items-center gap-1"
            onClick={onChatToggle}
            type="button"
          >
            <span className="whitespace-nowrap">Chat</span>
          </button>
        </div>

        {/* Settings Button */}
        <div className="flex items-center gap-2">
          <button
            className="stable-button rounded-lg px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] leading-none text-white flex items-center gap-1"
            onClick={onSettingsToggle}
            type="button"
          >
            <span className="whitespace-nowrap">Models</span>
          </button>
        </div>

        {/* Question mark with tooltip */}
        <div className="relative inline-block">
          <button
            className="help-button w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center cursor-pointer z-10"
            onClick={handleTooltipToggle}
            type="button"
          >
            <span className="text-[10px] sm:text-xs text-white font-semibold">?</span>
          </button>

          {/* Tooltip Content */}
          {isTooltipVisible && (
            <div
              ref={tooltipRef}
              className="absolute top-full right-0 mt-2 w-72 sm:w-80 z-50 max-w-[90vw]"
            >
              <div className="p-3 sm:p-4 text-xs bg-black backdrop-blur-md rounded-2xl border border-white text-white shadow-2xl overflow-hidden">
                <div className="space-y-4">
                  <h3 className="font-semibold text-sm text-white">Keyboard Shortcuts</h3>
                  <div className="space-y-3">
                    {/* Toggle Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white flex-shrink-0">Toggle Window</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            ⌘
                          </span>
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            B
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/80">
                        Show or hide this window.
                      </p>
                    </div>
                    {/* Screenshot Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white flex-shrink-0">Take Screenshot</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            ⌘
                          </span>
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            H
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/80">
                        Take a screenshot of the problem description. The tool
                        will extract and analyze the problem. The 5 latest
                        screenshots are saved.
                      </p>
                    </div>

                    {/* Solve Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white flex-shrink-0">Solve Problem</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            ⌘
                          </span>
                          <span className="bg-black border border-white/50 px-2 py-1 rounded-lg text-[10px] leading-none text-white">
                            ↵
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/80">
                        Generate a solution based on the current problem.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-white/30" />

        {/* Sign Out Button */}
        <button
          className="text-red-400 transition-colors hover:cursor-pointer"
          title="Sign Out"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>

      {/* Audio Result Display */}
      {audioResult && (
        <div className="mt-3 p-3 bg-black backdrop-blur-md border border-white rounded-2xl text-white text-xs max-w-md shadow-lg">
          <span className="font-semibold">Audio Result:</span> {audioResult}
        </div>
      )}
    </div>
  )
}

export default QueueCommands