import { spawn } from "node:child_process"
import { Readable } from "node:stream"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"
import { SettingsService } from "../config/SettingsService"
import { backoffDelayMs, isTransientError } from "../llm/retry"

// Primary engine is whisper.cpp (Metal-accelerated, near real-time, fully local
// and offline once the model file is present). transformers.js is kept only as a
// slow, last-resort fallback for environments without the whisper.cpp binary.
const FFMPEG_IDLE_MS = 30_000
const WHISPER_IDLE_MS = 60_000 // whisper-cli should emit output well within this
const MODEL_DOWNLOAD_RETRIES = 3
const TRANSFORMERS_TIMEOUT_MS = 90_000

// Friendly setting value -> ggml model filename (whisper.cpp) and transformers.js id.
const GGML_MODEL_MAP: Record<string, string> = {
  tiny: "ggml-tiny.bin",
  "tiny.en": "ggml-tiny.en.bin",
  base: "ggml-base.bin",
  "base.en": "ggml-base.en.bin",
  small: "ggml-small.bin",
  "small.en": "ggml-small.en.bin",
  medium: "ggml-medium.bin",
}
const XENOVA_MODEL_MAP: Record<string, string> = {
  tiny: "Xenova/whisper-tiny",
  "tiny.en": "Xenova/whisper-tiny.en",
  base: "Xenova/whisper-base",
  "base.en": "Xenova/whisper-base.en",
  small: "Xenova/whisper-small",
  "small.en": "Xenova/whisper-small.en",
  medium: "Xenova/whisper-medium",
}

const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

const IS_WINDOWS = process.platform === "win32"
/** Executable suffix. Bare names resolve through PATH; explicit paths need it. */
const EXE = IS_WINDOWS ? ".exe" : ""

/** Paths a bundled helper binary would be shipped at (packaged app). */
function bundledBinaryPaths(name: string): string[] {
  if (!process.resourcesPath) return []
  return [
    path.join(process.resourcesPath, "bin", `${name}${EXE}`),
    path.join(process.resourcesPath, name, `${name}${EXE}`),
  ]
}

/**
 * Where a user-installed copy of a helper binary is likely to live.
 * The previous implementation only ever checked POSIX prefixes, so on Windows
 * every lookup fell through to a bare command name and whisper.cpp was reported
 * as permanently unavailable even when installed.
 */
function windowsSearchPaths(name: string): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files"
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
  const localAppData = process.env.LOCALAPPDATA ?? ""
  const chocolatey = process.env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey"
  return [
    `C:\\${name}\\bin\\${name}.exe`,
    path.join(programFiles, name, "bin", `${name}.exe`),
    path.join(programFiles, name, `${name}.exe`),
    path.join(programFilesX86, name, "bin", `${name}.exe`),
    path.join(chocolatey, "bin", `${name}.exe`),
    // winget shims
    localAppData ? path.join(localAppData, "Microsoft", "WinGet", "Links", `${name}.exe`) : "",
    // scoop
    localAppData ? path.join(localAppData, "..", "scoop", "shims", `${name}.exe`) : "",
  ].filter(Boolean)
}

function posixSearchPaths(name: string): string[] {
  return [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]
}

function resolveFfmpeg(): string {
  const candidates = [
    ...bundledBinaryPaths("ffmpeg"),
    ...(IS_WINDOWS ? windowsSearchPaths("ffmpeg") : posixSearchPaths("ffmpeg")),
  ]
  // Falling back to the bare name lets a PATH install still work; spawn() then
  // fails with ENOENT, which the caller reports as "ffmpeg not available".
  return firstExisting(candidates) ?? `ffmpeg${EXE}`
}

/** Locate the whisper.cpp CLI: a bundled copy first (packaged app), then the OS's usual install locations. */
function resolveWhisperCli(): string | null {
  return firstExisting([
    ...bundledBinaryPaths("whisper-cli"),
    ...(IS_WINDOWS ? windowsSearchPaths("whisper-cli") : posixSearchPaths("whisper-cli")),
  ])
}

export interface TranscriptionResult {
  text: string
  timestamp: number
}

/**
 * Fully-local speech-to-text. Audio (any container ffmpeg can read) is decoded to
 * 16 kHz mono and transcribed with whisper.cpp (Metal) when available, falling
 * back to a local transformers.js Whisper model otherwise. No audio ever leaves
 * the machine.
 */
export class AudioService {
  private static instance: AudioService | null = null
  private settings = SettingsService.getInstance()
  private asr: any = null
  private asrModelId = ""
  private readonly ffmpeg = resolveFfmpeg()
  private readonly whisperCli = resolveWhisperCli()

  static getInstance(): AudioService {
    if (!AudioService.instance) AudioService.instance = new AudioService()
    return AudioService.instance
  }

  private get modelDir(): string {
    return path.join(app.getPath("userData"), "whisper-models")
  }

  async transcribeFile(filePath: string): Promise<TranscriptionResult> {
    const cfg = this.settings.get("audio")

    // Preferred path: whisper.cpp (fast, local, Metal).
    if (this.whisperCli) {
      const model = await this.ensureGgmlModel(cfg.whisperModel)
      if (model) {
        const wav = await this.decodeToWav(filePath)
        try {
          const text = await this.runWhisperCli(model, wav, cfg)
          return { text, timestamp: Date.now() }
        } finally {
          await fs.promises.unlink(wav).catch(() => {})
        }
      }
    }

    // Fallback: transformers.js (slow; only when whisper.cpp is unavailable).
    return this.transcribeWithTransformers(filePath, cfg)
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

  // --- whisper.cpp path -----------------------------------------------------

  /** Resolve the ggml model file for the setting, downloading it once if absent. */
  private async ensureGgmlModel(setting: string): Promise<string | null> {
    const file = GGML_MODEL_MAP[setting] ?? "ggml-base.en.bin"
    const bundled = process.resourcesPath
      ? path.join(process.resourcesPath, "whisper-models", file)
      : ""
    const local = path.join(this.modelDir, file)
    const found = firstExisting([local, bundled])
    if (found) return found

    // Not present — download once to the local cache (retry on transient errors).
    fs.mkdirSync(this.modelDir, { recursive: true })
    const url = `${MODEL_BASE_URL}/${file}`
    const tmp = `${local}.${process.pid}.part`
    let attempt = 0
    for (;;) {
      try {
        await this.downloadFile(url, tmp)
        try {
          await fs.promises.rename(tmp, local)
        } catch (renameErr: any) {
          if (["EXDEV", "EPERM", "EBUSY"].includes(renameErr?.code)) {
            await fs.promises.copyFile(tmp, local)
            await fs.promises.unlink(tmp).catch(() => {})
          } else {
            throw renameErr
          }
        }
        return local
      } catch (err: any) {
        await fs.promises.unlink(tmp).catch(() => {})
        const msg = err?.message ?? String(err)
        if (attempt >= MODEL_DOWNLOAD_RETRIES || !isTransientError(msg)) return null
        attempt++
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt, 800, 8000)))
      }
    }
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url, { redirect: "follow" })
    if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`)
    const out = fs.createWriteStream(dest)
    await new Promise<void>((resolve, reject) => {
      const readable = Readable.fromWeb(res.body as any)
      readable.on("error", reject)
      out.on("error", reject)
      out.on("finish", () => resolve())
      readable.pipe(out)
    })
  }

  /** Decode any audio to a 16 kHz mono 16-bit WAV file that whisper.cpp reads. */
  private decodeToWav(inputPath: string): Promise<string> {
    const wav = path.join(os.tmpdir(), "ia-core-audio", `${uuidv4()}.wav`)
    fs.mkdirSync(path.dirname(wav), { recursive: true })
    return new Promise((resolve, reject) => {
      const ff = spawn(
        this.ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          "-y",
          wav,
        ],
        // Stealth: ffmpeg is a console app and this is a GUI process with no
        // console, so Windows would otherwise flash a visible cmd window on
        // every transcription. Node's windowsHide default is false.
        { windowsHide: true }
      )
      let err = ""
      let settled = false
      let watchdog: ReturnType<typeof setTimeout>
      const done = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        fn()
      }
      const arm = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(
          () => done(() => (ff.kill("SIGKILL"), reject(new Error("ffmpeg stalled")))),
          FFMPEG_IDLE_MS
        )
      }
      arm()
      ff.stderr.on("data", (d: Buffer) => {
        arm()
        err += d.toString()
      })
      ff.on("error", (e) => done(() => reject(new Error(`ffmpeg not available: ${e.message}`))))
      ff.on("close", (code) =>
        done(() =>
          code === 0
            ? resolve(wav)
            : reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-300)}`))
        )
      )
    })
  }

  private runWhisperCli(
    model: string,
    wavPath: string,
    cfg: { language: string; translate: boolean }
  ): Promise<string> {
    const cli = this.whisperCli as string
    const threads = String(Math.min(8, Math.max(2, os.cpus().length - 2)))
    const args = ["-m", model, "-f", wavPath, "-nt", "-t", threads]
    if (cfg.translate) args.push("-tr")
    // .en models are English-only; only pass a language for multilingual models.
    if (!/\.en\./.test(path.basename(model)) && cfg.language && cfg.language !== "auto") {
      args.push("-l", cfg.language)
    }
    return new Promise((resolve, reject) => {
      // windowsHide: see decodeToWav — prevents a console window flashing.
      const p = spawn(cli, args, { windowsHide: true })
      let out = ""
      let err = ""
      let settled = false
      let watchdog: ReturnType<typeof setTimeout>
      const done = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        fn()
      }
      const arm = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(
          () => done(() => (p.kill("SIGKILL"), reject(new Error("whisper.cpp stalled")))),
          WHISPER_IDLE_MS
        )
      }
      arm()
      p.stdout.on("data", (d: Buffer) => {
        arm()
        out += d.toString()
      })
      p.stderr.on("data", (d: Buffer) => (err += d.toString()))
      p.on("error", (e) => done(() => reject(new Error(`whisper.cpp not available: ${e.message}`))))
      p.on("close", (code) =>
        done(() =>
          code === 0
            ? resolve(out.replace(/\s+/g, " ").trim())
            : reject(new Error(`whisper.cpp failed (code ${code}): ${err.slice(-300)}`))
        )
      )
    })
  }

  // --- transformers.js fallback (slow; only if whisper.cpp is unavailable) --

  private async transcribeWithTransformers(
    filePath: string,
    cfg: { language: string; translate: boolean }
  ): Promise<TranscriptionResult> {
    const pcm = await this.decodeToPcm(filePath)
    if (pcm.length === 0) return { text: "", timestamp: Date.now() }
    const asr = await this.getPipeline()
    const seconds = pcm.length / 16000
    const options: Record<string, unknown> = {
      language: cfg.language === "auto" ? undefined : cfg.language,
      task: cfg.translate ? "translate" : "transcribe",
    }
    if (seconds > 30) {
      options.chunk_length_s = 30
      options.stride_length_s = 5
    }
    let timer: ReturnType<typeof setTimeout>
    const out = await Promise.race([
      asr(pcm, options),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Local transcription timed out after ${Math.round(
                  TRANSFORMERS_TIMEOUT_MS / 1000
                )}s. Install whisper.cpp for fast on-device transcription.`
              )
            ),
          TRANSFORMERS_TIMEOUT_MS
        )
      }),
    ]).finally(() => clearTimeout(timer))
    const text = (
      Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : (out?.text ?? "")
    ).trim()
    return { text, timestamp: Date.now() }
  }

  private async getPipeline(): Promise<any> {
    const cfg = this.settings.get("audio")
    const modelId = XENOVA_MODEL_MAP[cfg.whisperModel] ?? "Xenova/whisper-base.en"
    if (this.asr && this.asrModelId === modelId) return this.asr

    let transformers: any
    try {
      const specifier = "@xenova/transformers"
      transformers = await import(specifier)
    } catch {
      throw new Error(
        IS_WINDOWS
          ? "No local transcription engine available. Install whisper.cpp (winget install whisper-cpp, or place whisper-cli.exe on PATH) and ffmpeg (winget install Gyan.FFmpeg)."
          : "No local transcription engine available. Install whisper.cpp (brew install whisper-cpp) or `npm install @xenova/transformers`."
      )
    }
    transformers.env.cacheDir = this.modelDir
    transformers.env.allowLocalModels = true
    transformers.env.allowRemoteModels = true
    transformers.env.useFSCache = true
    let lastErr: any
    for (let attempt = 0; attempt <= MODEL_DOWNLOAD_RETRIES; attempt++) {
      try {
        this.asr = await transformers.pipeline("automatic-speech-recognition", modelId)
        this.asrModelId = modelId
        return this.asr
      } catch (e: any) {
        lastErr = e
        if (attempt >= MODEL_DOWNLOAD_RETRIES) break
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt + 1, 800, 8000)))
      }
    }
    throw new Error(`Failed to load the transcription model. ${lastErr?.message ?? lastErr}`)
  }

  /** Decode any audio file to 16 kHz mono float32 PCM via ffmpeg (transformers.js input). */
  private decodeToPcm(inputPath: string): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const ff = spawn(
        this.ffmpeg,
        ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
        // windowsHide: see decodeToWav.
        { windowsHide: true }
      )
      const chunks: Buffer[] = []
      let err = ""
      let settled = false
      let watchdog: ReturnType<typeof setTimeout>
      const done = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        fn()
      }
      const arm = () => {
        clearTimeout(watchdog)
        watchdog = setTimeout(
          () => done(() => (ff.kill("SIGKILL"), reject(new Error("ffmpeg stalled")))),
          FFMPEG_IDLE_MS
        )
      }
      arm()
      ff.stdout.on("data", (d: Buffer) => {
        arm()
        chunks.push(d)
      })
      ff.stderr.on("data", (d: Buffer) => (err += d.toString()))
      ff.on("error", (e) => done(() => reject(new Error(`ffmpeg not available: ${e.message}`))))
      ff.on("close", (code) =>
        done(() => {
          if (code !== 0) {
            reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-300)}`))
            return
          }
          const buf = Buffer.concat(chunks)
          const usable = buf.length - (buf.length % 4)
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable)
          resolve(new Float32Array(ab))
        })
      )
    })
  }
}
