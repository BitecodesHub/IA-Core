import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"
import { SettingsService } from "../config/SettingsService"

// Map the friendly setting value to a transformers.js Whisper model id.
const MODEL_MAP: Record<string, string> = {
  tiny: "Xenova/whisper-tiny",
  "tiny.en": "Xenova/whisper-tiny.en",
  base: "Xenova/whisper-base",
  "base.en": "Xenova/whisper-base.en",
  small: "Xenova/whisper-small",
  "small.en": "Xenova/whisper-small.en",
  medium: "Xenova/whisper-medium",
}

function resolveFfmpeg(): string {
  const candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return "ffmpeg" // fall back to PATH
}

export interface TranscriptionResult {
  text: string
  timestamp: number
}

/**
 * Fully-local speech-to-text. Audio (any container ffmpeg can read) is decoded to
 * 16 kHz mono float PCM and transcribed with a local Whisper model via
 * transformers.js. The engine is an OPTIONAL dependency loaded lazily, so the app
 * runs without it and reports a clear message instead of crashing.
 */
export class AudioService {
  private static instance: AudioService | null = null
  private settings = SettingsService.getInstance()
  private asr: any = null
  private asrModelId = ""
  private readonly ffmpeg = resolveFfmpeg()

  static getInstance(): AudioService {
    if (!AudioService.instance) AudioService.instance = new AudioService()
    return AudioService.instance
  }

  async transcribeFile(filePath: string): Promise<TranscriptionResult> {
    const pcm = await this.decodeToPcm(filePath)
    if (pcm.length === 0) return { text: "", timestamp: Date.now() }
    const asr = await this.getPipeline()
    const cfg = this.settings.get("audio")
    const out = await asr(pcm, {
      language: cfg.language === "auto" ? undefined : cfg.language,
      task: cfg.translate ? "translate" : "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const text = (
      Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : (out?.text ?? "")
    ).trim()
    return { text, timestamp: Date.now() }
  }

  async transcribeBase64(data: string, _mimeType: string): Promise<TranscriptionResult> {
    const dir = path.join(os.tmpdir(), "ia-core-audio")
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `${uuidv4()}.audio`)
    await fs.promises.writeFile(tmp, Buffer.from(data, "base64"))
    try {
      return await this.transcribeFile(tmp)
    } finally {
      await fs.promises.unlink(tmp).catch(() => {})
    }
  }

  private async getPipeline(): Promise<any> {
    const cfg = this.settings.get("audio")
    const modelId = MODEL_MAP[cfg.whisperModel] ?? "Xenova/whisper-base.en"
    if (this.asr && this.asrModelId === modelId) return this.asr

    let transformers: any
    try {
      // Optional dependency, resolved at runtime via a computed specifier so the
      // bundler/types do not require it to be present.
      const specifier = "@xenova/transformers"
      transformers = await import(specifier)
    } catch {
      throw new Error(
        "Local transcription engine is not installed. Run `npm install @xenova/transformers` to enable offline audio."
      )
    }
    transformers.env.cacheDir = path.join(app.getPath("userData"), "whisper-models")
    transformers.env.allowLocalModels = false
    this.asr = await transformers.pipeline("automatic-speech-recognition", modelId)
    this.asrModelId = modelId
    return this.asr
  }

  /** Decode any audio file to 16 kHz mono float32 PCM via ffmpeg. */
  private decodeToPcm(inputPath: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const ff = spawn(this.ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ])
      const chunks: Buffer[] = []
      let err = ""
      ff.stdout.on("data", (d: Buffer) => chunks.push(d))
      ff.stderr.on("data", (d: Buffer) => (err += d.toString()))
      ff.on("error", (e) =>
        reject(new Error(`ffmpeg not available (${this.ffmpeg}): ${e.message}`))
      )
      ff.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-300)}`))
          return
        }
        const buf = Buffer.concat(chunks)
        const usable = buf.length - (buf.length % 4)
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable)
        resolve(new Float32Array(ab))
      })
    })
  }
}
