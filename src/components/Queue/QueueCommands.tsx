import React, { useState, useEffect, useRef } from "react"
import { IoLogOutOutline } from "react-icons/io5"
import { Settings } from "lucide-react"

interface QueueCommandsProps {
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
  /** Current AI mode, derived from the active provider. Drives the mode badge. */
  mode: "offline" | "online"
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onChatToggle,
  onSettingsToggle,
  mode,
}) => {
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioResult, setAudioResult] = useState<string | null>(null)
  const chunks = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // Stealth: ensure the microphone is fully released on unmount so the OS
  // mic-in-use indicator never lingers if the overlay closes mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (audioResult) {
      const timer = setTimeout(() => {
        setAudioResult(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [audioResult])

  const handleRecordClick = async () => {
    if (!isRecording) {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => chunks.current.push(e.data)
        recorder.onstop = async () => {
          // Safety net: release mic tracks as soon as recording stops.
          streamRef.current?.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" })
          chunks.current = []
          const reader = new FileReader()
          reader.onloadend = async () => {
            const base64Data = (reader.result as string).split(",")[1]
            try {
              const result = await window.electronAPI.analyzeAudioFromBase64(base64Data, blob.type)
              setAudioResult(result.text)
            } catch (err: any) {
              // IPC wraps main-process errors: "Error invoking remote method '…': Error: <reason>".
              const reason = String(err?.message ?? "").replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
              setAudioResult(reason || "Voice transcription failed. Please try again.")
            }
          }
          reader.readAsDataURL(blob)
        }
        setMediaRecorder(recorder)
        recorder.start()
        setIsRecording(true)
      } catch {
        // If getUserMedia succeeded but MediaRecorder construction/start threw,
        // release the acquired mic tracks so the OS indicator does not linger.
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setAudioResult("Could not start recording.")
      }
    } else {
      // Stop recording — stop the recorder AND release the mic tracks immediately
      // so the OS microphone-in-use indicator clears at once (stealth).
      mediaRecorder?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  return (
    <div className="w-fit p-1" data-overlay-interactive>
      <style>{`
        @keyframes border-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }

        .glass-capsule {
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 2px solid rgba(255, 255, 255, 0.3);
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
          top: 0; left: 0; right: 0; bottom: 0;
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
          top: 0; left: 0; right: 0; bottom: 0;
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
          transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease;
          position: relative;
          isolation: isolate;
        }

        .stable-button:hover {
          background: #ffffff;
          color: #000000;
          border-color: rgba(255, 255, 255, 1);
        }
      `}</style>

      <div className="text-xs text-white glass-capsule flex items-center justify-center gap-3 sm:gap-4 draggable-area rounded-full relative">
        {/* Logo + name */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="logo-circle w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border-2 border-white">
            <span className="text-xs sm:text-sm font-bold text-white">IA</span>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-white whitespace-nowrap">
          Bitecodes&apos;s AI
          </span>
        </div>

        {/* Mode indicator (non-interactive; inside the content-protected window). */}
        <div
          className="flex items-center gap-1.5"
          title={
            mode === "online"
              ? "Online mode — OpenRouter. ⌘⌥⇧M to toggle."
              : "Offline mode — local Ollama. ⌘⌥⇧M to toggle."
          }
        >
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              mode === "online" ? "bg-sky-400" : "bg-emerald-400"
            }`}
          />
          <span className="text-[11px] leading-none text-white/80 whitespace-nowrap">
            {mode === "online" ? "Online" : "Offline"}
          </span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-white/20" />

        {/* Actions */}
        <button
          className={`stable-button rounded-lg px-2.5 py-1 text-[11px] leading-none text-white ${
            isRecording ? "!bg-red-600 !border-red-400" : ""
          }`}
          onClick={handleRecordClick}
          type="button"
        >
          <span className="whitespace-nowrap">{isRecording ? "● Stop" : "Record"}</span>
        </button>

        <button
          className="stable-button rounded-lg px-2.5 py-1 text-[11px] leading-none text-white"
          onClick={onChatToggle}
          type="button"
        >
          <span className="whitespace-nowrap">Chat</span>
        </button>

        <button
          className="stable-button rounded-full w-7 h-7 flex items-center justify-center text-white"
          onClick={onSettingsToggle}
          type="button"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-white/20" />

        {/* Quit */}
        <button
          className="text-white/70 transition-colors hover:text-red-400 hover:cursor-pointer"
          title="Quit"
          aria-label="Quit"
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
