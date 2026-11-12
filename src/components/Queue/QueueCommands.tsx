import React, { useCallback, useEffect, useRef, useState } from "react"
import { IoLogOutOutline } from "react-icons/io5"
import { AlertTriangle, Check, Copy, Loader2, Mic, Settings, Square, X } from "lucide-react"
import bitecodesLogo from "../../assets/bitecodes-logo.png"
import MessageRenderer from "../ui/MessageRenderer"

interface QueueCommandsProps {
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
  /** Current AI mode, derived from the active provider. Drives the mode badge. */
  mode: "offline" | "online"
}

type VoicePhase = "idle" | "acquiring" | "recording" | "transcribing"

interface Transcript {
  text: string
  analysis?: string
  analyzing?: boolean
  at: number
  duration: number
}

interface VoiceError {
  message: string
  kind: "mic" | "transcribe"
}

// A runaway recording must not produce a payload the transcriber cannot handle.
const MAX_RECORD_SECONDS = 300
const MIN_RECORD_SECONDS = 0.7

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** IPC wraps main-process errors: "Error invoking remote method '…': Error: <reason>". */
const cleanIpcError = (err: unknown): string =>
  String((err as any)?.message ?? err ?? "")
    .replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    .trim()

function friendlyVoiceError(raw: string): VoiceError {
  if (/sign in/i.test(raw))
    return {
      kind: "transcribe",
      message: "Sign in with Bitecodes to transcribe voice. Open Settings, sign in, then try again.",
    }
  if (/no longer supported|download the update/i.test(raw)) return { kind: "transcribe", message: raw }
  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|could not reach/i.test(raw))
    return {
      kind: "transcribe",
      message: "Could not reach Bitecodes. Check your connection and try again.",
    }
  if (/timed?\s?out|aborted/i.test(raw))
    return { kind: "transcribe", message: "Transcription timed out. Try a shorter recording." }
  return { kind: "transcribe", message: raw || "Voice transcription failed. Please try again." }
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(new Error("Could not read the recording."))
    reader.readAsDataURL(blob)
  })

/** Live microphone loudness so the user can see the mic is actually hearing them. */
const LevelMeter: React.FC<{ level: number }> = ({ level }) => (
  <span className="flex h-4 items-end gap-[2px]" aria-hidden="true">
    {[0.45, 0.75, 1, 0.75, 0.45].map((w, i) => (
      <span
        key={i}
        className="w-[3px] rounded-full bg-red-400 transition-[height] duration-100 ease-out"
        style={{ height: `${4 + Math.round(level * w * 12)}px` }}
      />
    ))}
  </span>
)

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onChatToggle,
  onSettingsToggle,
  mode,
}) => {
  const [phase, setPhase] = useState<VoicePhase>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [voiceError, setVoiceError] = useState<VoiceError | null>(null)
  const [copied, setCopied] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const requestRef = useRef(0)
  const audioRequestRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Own all resources, including the progress timer while transcription awaits IPC.
  const releaseMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (timerRef.current !== null) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => {})
  }, [])

  const invalidateRecording = useCallback(() => {
    requestRef.current++
    if (audioRequestRef.current) window.electronAPI.cancelAudioTranscription(audioRequestRef.current)
    audioRequestRef.current = null
    busyRef.current = false
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec) {
      rec.ondataavailable = null
      rec.onstop = null
      rec.onerror = null
      try {
        if (rec.state !== "inactive") rec.stop()
      } catch { /* tracks still get released if the recorder has failed */ }
    }
    chunksRef.current = []
    releaseMic()
  }, [releaseMic])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      invalidateRecording()
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [invalidateRecording])

  const cancelRecording = useCallback(() => {
    invalidateRecording()
    setTranscript(current => current ? { ...current, analyzing: false } : null)
    setPhase("idle")
    setElapsed(0)
    setLevel(0)
  }, [invalidateRecording])

  const finalizeRecording = useCallback(async (id: number, rec: MediaRecorder) => {
    if (id !== requestRef.current || recorderRef.current !== rec) return
    recorderRef.current = null
    rec.ondataavailable = null
    rec.onstop = null
    rec.onerror = null
    releaseMic()
    setLevel(0)
    const seconds = (Date.now() - startedAtRef.current) / 1000
    const chunks = chunksRef.current
    chunksRef.current = []
    const blob = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || "audio/webm" })
    if (seconds < MIN_RECORD_SECONDS || blob.size < 1200) {
      busyRef.current = false
      setPhase("idle")
      setElapsed(0)
      setVoiceError({
        kind: "transcribe",
        message: "That recording was too short. Record for at least a second and try again.",
      })
      return
    }

    setPhase("transcribing")
    setElapsed(0)
    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      if (id === requestRef.current) setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    let transcribed = false
    try {
      const base64 = await blobToBase64(blob)
      if (id !== requestRef.current) return
      const audioId = crypto.randomUUID()
      audioRequestRef.current = audioId
      const result = await window.electronAPI.analyzeAudioFromBase64(base64, blob.type, {
        id: audioId,
        onTranscribed: (early) => {
          if (id !== requestRef.current || !early.text.trim()) return
          transcribed = true
          setTranscript({
            text: early.text.trim(),
            analyzing: early.analyzing,
            at: early.timestamp,
            duration: Math.max(1, Math.round(seconds)),
          })
          releaseMic()
          busyRef.current = false
          setPhase("idle")
          setElapsed(0)
        },
      })
      if (id !== requestRef.current) return
      const text = (result?.text ?? "").trim()
      if (!text) {
        setVoiceError({
          kind: "transcribe",
          message: "No speech was detected. Try again a little closer to the microphone.",
        })
      } else {
        setTranscript({
          text,
          analysis: result?.analysis?.trim() || undefined,
          at: result.timestamp,
          duration: Math.max(1, Math.round(seconds)),
        })
        setVoiceError(null)
      }
    } catch (err) {
      if (id !== requestRef.current) return
      if (!transcribed) setVoiceError(friendlyVoiceError(cleanIpcError(err)))
    } finally {
      if (id === requestRef.current) {
        setTranscript(current => current?.analyzing ? { ...current, analyzing: false } : current)
        audioRequestRef.current = null
        releaseMic()
        busyRef.current = false
        setPhase("idle")
        setElapsed(0)
      }
    }
  }, [releaseMic])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === "inactive") return
    try {
      // onstop may be queued; release the microphone immediately, keep its chunks.
      releaseMic()
      rec.stop()
    } catch {
      cancelRecording()
      setVoiceError({ kind: "mic", message: "Could not finish recording. Please try again." })
    }
  }, [cancelRecording, releaseMic])

  const startRecording = useCallback(async () => {
    // React state has not necessarily rendered before a second activation.
    if (busyRef.current || !mountedRef.current) return
    invalidateRecording()
    setTranscript(current => current ? { ...current, analyzing: false } : null)
    busyRef.current = true
    const id = ++requestRef.current
    setPhase("acquiring")
    setVoiceError(null)
    setCopied(false)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err: any) {
      if (id !== requestRef.current) return
      cancelRecording()
      const name = err?.name ?? ""
      setVoiceError({
        kind: "mic",
        message:
          name === "NotAllowedError" || name === "SecurityError"
            ? "Microphone access is blocked. Allow Notes to use the microphone, then try again."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No microphone was found. Connect one and try again."
              : "Could not start the microphone. Close other apps using it and try again.",
      })
      return
    }
    if (id !== requestRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream

    // Loudness meter is best-effort; recording works without it.
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        if (id !== requestRef.current || !streamRef.current) return
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const next = Math.min(1, Math.sqrt(sum / data.length) * 3)
        setLevel((prev) => (Math.abs(next - prev) > 0.03 ? next : prev))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      const ctx = audioCtxRef.current
      audioCtxRef.current = null
      if (ctx) void ctx.close().catch(() => {})
    }

    try {
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (id === requestRef.current && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => { void finalizeRecording(id, recorder) }
      recorder.onerror = () => {
        if (id !== requestRef.current) return
        cancelRecording()
        setVoiceError({ kind: "mic", message: "Recording failed. Please try again." })
      }
      startedAtRef.current = Date.now()
      recorder.start(250)
      if (id !== requestRef.current || recorderRef.current !== recorder) return
      setElapsed(0)
      setPhase("recording")
      timerRef.current = setInterval(() => {
        if (id !== requestRef.current) return
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setElapsed(s)
        if (s >= MAX_RECORD_SECONDS) stopRecording()
      }, 250)
    } catch {
      cancelRecording()
      setVoiceError({ kind: "mic", message: "Could not start recording on this device. Please try again." })
    }
  }, [cancelRecording, finalizeRecording, stopRecording, invalidateRecording])

  // Bubble after focused controls, but before the window-level app shortcuts.
  useEffect(() => {
    if (phase !== "recording" && phase !== "acquiring") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      cancelRecording()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [phase, cancelRecording])

  const handleCopy = useCallback(async () => {
    if (!transcript) return
    let ok = false
    try {
      const res = await window.electronAPI.copyToClipboard(transcript.text)
      ok = res?.ok !== false
    } catch {
      ok = false
    }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(transcript.text)
        ok = true
      } catch {
        return
      }
    }
    if (!mountedRef.current) return
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 1600)
  }, [transcript])

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
          background: #ffffff;
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

        .glass-capsule,
        .voice-panel {
          --text-primary: #ffffff;
          --text-secondary: rgba(255, 255, 255, 0.8);
          --text-muted: rgba(255, 255, 255, 0.6);
        }

        .stable-button {
          background: #000000;
          border: 1px solid rgba(255, 255, 255, 0.5);
          transition: border-color 0.2s ease, background-color 0.2s ease;
          position: relative;
          isolation: isolate;
        }

        .stable-button:hover {
          background: rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 1);
        }

        .stable-button:focus-visible,
        .voice-icon-btn:focus-visible,
        .voice-action:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.8);
          outline-offset: 1px;
        }

        .voice-panel {
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 16px;
          padding: 12px 14px;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
          text-align: left;
          animation: voice-in 180ms ease-out;
        }

        .voice-panel-error {
          border-color: rgba(248, 113, 113, 0.45);
        }

        @keyframes voice-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: none; }
        }

        .voice-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.65);
          transition: background-color 0.15s ease, color 0.15s ease;
        }

        .voice-icon-btn:hover {
          background: rgba(255, 255, 255, 0.15);
          color: #ffffff;
        }

        .voice-action {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          padding: 4px 10px;
          font-size: 11px;
          line-height: 1;
          color: #ffffff;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .voice-action:hover {
          background: rgba(255, 255, 255, 0.2);
          border-color: #ffffff;
        }

        .voice-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.06);
        }
        .voice-scroll::-webkit-scrollbar { width: 6px; }
        .voice-scroll::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.06); border-radius: 3px; }
        .voice-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 3px; }
        .voice-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.45); }

        .rec-pulse { animation: rec-pulse 1.2s ease-in-out infinite; }
        @keyframes rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      <div className="text-xs text-white glass-capsule flex items-center justify-center gap-3 sm:gap-4 draggable-area rounded-full relative">
        {/* Logo + name */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="logo-circle w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border-2 border-white">
            <img src={bitecodesLogo} alt="Bitecodes" className="w-full h-full object-contain scale-[1.3]" draggable={false} />
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

        {/* Voice: record → stop/cancel → transcribe, with live feedback at every step. */}
        {phase === "recording" ? (
          <div className="flex items-center gap-1.5" role="status" aria-live="polite">
            <button
              className="stable-button rounded-lg px-2.5 py-1 text-[11px] leading-none !bg-red-600 !border-red-400 text-white flex items-center gap-1.5"
              onClick={stopRecording}
              type="button"
              title="Stop and transcribe"
              aria-label="Stop recording and transcribe"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              <span className="whitespace-nowrap">Stop</span>
            </button>
            <span className="text-[11px] leading-none text-red-300 tabular-nums whitespace-nowrap">
              <span className="rec-pulse mr-1 inline-block w-1.5 h-1.5 rounded-full bg-red-400 align-middle" />
              <span aria-hidden="true">{fmtClock(elapsed)}</span>
            </span>
            <LevelMeter level={level} />
            <button
              className="voice-icon-btn"
              onClick={cancelRecording}
              type="button"
              title="Discard recording (Esc)"
              aria-label="Discard recording"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : phase === "acquiring" ? (
          <div className="flex items-center gap-1.5">
            <span role="status" className="text-[11px]">Waiting for microphone…</span>
            <button className="voice-icon-btn" onClick={cancelRecording} type="button" aria-label="Cancel microphone request">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : phase === "transcribing" ? (
          <button
            className="stable-button rounded-lg px-2.5 py-1 text-[11px] leading-none text-white flex items-center gap-1.5 opacity-90"
            type="button"
            disabled
            role="status"
            aria-live="polite"
            aria-label="Transcribing recording"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="whitespace-nowrap">
              Transcribing… <span aria-hidden="true">{fmtClock(elapsed)}</span>
            </span>
          </button>
        ) : (
          <button
            className="stable-button rounded-lg px-2.5 py-1 text-[11px] leading-none text-white flex items-center gap-1.5"
            onClick={() => void startRecording()}
            type="button"
            title="Record voice and transcribe it"
            aria-label="Record voice"
          >
            <Mic className="w-3 h-3" />
            <span className="whitespace-nowrap">Record</span>
          </button>
        )}

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

      {/* Error card — distinct from a transcript, with a recovery action. Stays until dismissed. */}
      {voiceError && (
        <div
          className="voice-panel voice-panel-error mt-3 w-[400px] max-w-[calc(100vw-16px)] text-white"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-red-300">
              {voiceError.kind === "mic" ? "Microphone unavailable" : "Transcription failed"}
            </span>
            <button
              className="voice-icon-btn ml-auto"
              onClick={() => setVoiceError(null)}
              type="button"
              title="Dismiss"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/85">{voiceError.message}</p>
          <div className="mt-2.5 flex items-center gap-2">
            {voiceError.kind === "mic" ? (
              <button
                className="voice-action"
                onClick={() => void window.electronAPI.openPrivacySettings("microphone")}
                type="button"
              >
                Open microphone settings
              </button>
            ) : (
              <button
                className="voice-action"
                onClick={() => void startRecording()}
                type="button"
              >
                <Mic className="w-3 h-3" />
                Record again
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transcript — persistent, readable, copyable. Never auto-dismisses. */}
      {transcript && (
        <div
          className="voice-panel mt-3 w-[400px] max-w-[calc(100vw-16px)] text-white"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <Mic className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/90">
              Transcript
            </span>
            <span className="text-[10px] text-white/50 tabular-nums whitespace-nowrap">
              {fmtClock(transcript.duration)} · {fmtTime(transcript.at)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                className="voice-action"
                onClick={() => void handleCopy()}
                type="button"
                title="Copy transcript"
                aria-label="Copy transcript"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                className="voice-icon-btn"
                onClick={() => { if (phase === "idle") cancelRecording(); setTranscript(null) }}
                type="button"
                title="Dismiss"
                aria-label="Dismiss transcript"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="voice-scroll mt-2 max-h-48 overflow-y-auto pr-1.5">
            <p className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white">
              {transcript.text}
            </p>
            {(transcript.analysis || transcript.analyzing) && (
              <div className="mt-2.5 border-t border-white/15 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
                  Summary
                </span>
                <div className="mt-1 select-text break-words text-xs leading-relaxed text-white/75">
                  {transcript.analyzing ? <span role="status">Preparing summary…</span> : <MessageRenderer text={transcript.analysis!} />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default QueueCommands
