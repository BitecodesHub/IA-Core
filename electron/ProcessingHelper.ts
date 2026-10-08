// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { AudioService } from "./audio/AudioService"
import { SettingsService } from "./config/SettingsService"
import { isTransientError } from "./llm/retry"
import { toResizedJpeg } from "./image/resize"

// Stealth: screenshot file paths embed the OS username (via userData). Keep them
// out of production logs.
const isDev = process.env.NODE_ENV === "development"

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState
    // Local-only: the provider reads endpoint/model/params live from settings.
    this.llmHelper = new LLMHelper()
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      // Check if last screenshot is an audio file
      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue()
      const lastPath = allPaths[allPaths.length - 1]
      if (lastPath.endsWith(".mp3") || lastPath.endsWith(".wav")) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
        this.appState.setView("solutions")
        try {
          const audioResult = await this.processAudioFile(lastPath)
          mainWindow.webContents.send(
            this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
            audioResult
          )
          this.appState.setProblemInfo({
            problem_statement: audioResult.text,
            input_format: {},
            output_format: {},
            constraints: [],
            test_cases: [],
          })
          return
        } catch (err: any) {
          if (isDev) console.error("Audio processing error:", err)
          mainWindow.webContents.send(
            this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            err.message
          )
          return
        }
      }

      // NEW: Handle screenshot - show popup instead of direct analysis
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")

      // Instead of processing immediately, let the frontend show the popup
      // The actual processing will be triggered by the popup choice
      if (isDev) console.log("[ProcessingHelper] Screenshot ready for analysis, waiting for user choice")
      return
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        if (isDev) console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state (cancellable via the reset shortcut)
        const signal = this.currentExtraProcessingAbortController?.signal
        const currentSolution = await this.llmHelper.generateSolution(problemInfo, signal)
        if (signal?.aborted) return
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue,
          signal
        )

        // If cancelled mid-flight, generateSolution/debugSolutionWithImages swallow the
        // "Request cancelled" error into a placeholder fallback; do NOT broadcast that
        // as a success (it would cache and later show bogus placeholder content).
        if (signal?.aborted) return
        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS, debugResult)
      } catch (error: any) {
        if (isDev) console.error("Debug processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_ERROR, error.message)
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }

  public async processAudioBase64(data: string, mimeType: string) {
    return this.handleAudio(() => AudioService.getInstance().transcribeBase64(data, mimeType))
  }

  public async processAudioFile(filePath: string) {
    return this.handleAudio(() => AudioService.getInstance().transcribeFile(filePath))
  }

  /**
   * Local transcription, then (optionally) a local Ollama analysis of the
   * transcript. Fully offline; degrades to a clear message if the STT engine or
   * a model is unavailable.
   */
  private async handleAudio(
    run: () => Promise<{ text: string; timestamp: number }>
  ): Promise<{ text: string; timestamp: number }> {
    try {
      const { text } = await run()
      if (!text) return { text: "No speech detected in the audio.", timestamp: Date.now() }

      const audioCfg = SettingsService.getInstance().get("audio")
      if (!audioCfg.autoAnalyze) return { text, timestamp: Date.now() }

      try {
        const analysis = await this.llmHelper.chat(
          `The following is a transcript of an audio clip. Summarize it briefly and suggest possible next actions.\n\nTranscript:\n${text}`
        )
        return { text: `Transcript:\n${text}\n\n${analysis}`, timestamp: Date.now() }
      } catch {
        // Transcription succeeded but analysis failed (e.g. Ollama offline).
        return { text: `Transcript:\n${text}`, timestamp: Date.now() }
      }
    } catch (error: any) {
      return { text: `Audio processing failed: ${error?.message ?? error}`, timestamp: Date.now() }
    }
  }

  public getLLMHelper() {
    return this.llmHelper
  }

  // New method to handle screenshot analysis with user choice
  public async processScreenshotWithChoice(analysisType: "analyze" | "answer"): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()

    if (isDev) {
      console.log("[ProcessingHelper] processScreenshotWithChoice called")
      console.log("[ProcessingHelper] Current queue length:", screenshotQueue.length)
      // "Queue contents" logs full screenshot paths (embed the OS username) — dev only.
      console.log("[ProcessingHelper] Queue contents:", screenshotQueue)
    }

    if (screenshotQueue.length === 0) {
      if (isDev) console.log("[ProcessingHelper] No screenshots in queue")
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    // Always get the LATEST screenshot (last in queue)
    const lastPath = screenshotQueue[screenshotQueue.length - 1]

    if (isDev) {
      console.log("[ProcessingHelper] Selected screenshot for analysis:", lastPath)
      console.log("[ProcessingHelper] Analysis type:", analysisType)
    }

    this.currentProcessingAbortController = new AbortController()

    try {
      // Pre-flight connectivity probe. A terminal problem (missing/invalid API
      // key, auth) is surfaced immediately with a friendly message. A transient
      // one (slow link, timeout, 5xx) is NOT fatal: the streaming generation path
      // below has an idle timeout and robust retries and frequently succeeds on a
      // slow connection where this quick probe did not — so we proceed instead of
      // blocking the answer on a flaky health check.
      // Skipped for the Bitecodes model: its fallbacks are decided per request,
      // and a probe that fails would block an answer a fallback could give.
      const hosted = this.llmHelper.getCurrentProvider() === "bitecodes"
      const connectionTest = hosted ? { success: true as const } : await this.llmHelper.testConnection()
      if (!connectionTest.success) {
        const reason = connectionTest.error ?? "unknown error"
        if (!isTransientError(reason)) {
          throw new Error(`LLM connection failed: ${reason}`)
        }
        if (isDev) {
          console.log("[ProcessingHelper] Pre-flight probe failed transiently; proceeding:", reason)
        }
      }

      // Resolve a vision-capable model now (self-heals if capabilities aren't cached yet).
      // Throws a clear, actionable error if none is installed.
      await this.llmHelper.ensureVisionModel()

      // Start streaming analysis and send updates to Solutions view
      await this.streamImageAnalysisToSolutions(lastPath, mainWindow, analysisType)
    } catch (error: any) {
      if (isDev) console.error("Image processing error:", error)

      // Remediation depends on the active provider: online (OpenRouter) failures
      // must not tell the user to fix Ollama, and vice versa.
      const usingOllama = this.llmHelper.isUsingOllama()
      let errorMessage = error.message
      if (this.llmHelper.getCurrentProvider() === "bitecodes") {
        // Hosted model: no provider names, keys or settings advice.
        errorMessage = /^(Sign in with Bitecodes|This version of Notes)/.test(error.message)
          ? error.message
          : (error.message.match(
              /(You have reached today's limit[^|]*|The Bitecodes model has reached its daily capacity[^|]*|Your Bitecodes account does not include[^|]*)/
            )?.[1]?.trim() ?? "The Bitecodes model is temporarily unavailable. Please try again in a moment.")
      } else if (error.message.includes("timed out")) {
        errorMessage = usingOllama
          ? "Image analysis is taking too long. This might be because:\n• The model is still loading\n• The image is too complex\n• Ollama is not responding\n\nTry again or check your Ollama installation."
          : "Image analysis timed out. Check your network connection and try again."
      } else if (
        error.message.includes("vision model") ||
        error.message.includes("doesn't support image")
      ) {
        errorMessage = usingOllama
          ? `${error.message}\n\nTo install a vision model, run:\nollama pull llava\n\nThen restart the application.`
          : `${error.message}\n\nChoose a vision-capable model in Settings › Models.`
      } else if (
        error.message.includes("connection failed") ||
        error.message.includes("API key")
      ) {
        errorMessage = usingOllama
          ? `${error.message}\n\nMake sure Ollama is running:\n1. Start Ollama: ollama serve\n2. Install a model: ollama pull llava\n3. Restart this application`
          : `${error.message}\n\nAdd or check your OpenRouter API key in Settings › Models.`
      }

      mainWindow.webContents.send(
        this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        errorMessage
      )
    } finally {
      this.currentProcessingAbortController = null
    }
  }

  private async streamImageAnalysisToSolutions(
    imagePath: string,
    mainWindow: any,
    analysisType: "analyze" | "answer" = "analyze"
  ) {
    try {
      // Verify file exists and get stats
      const fs = require("fs")
      const path = require("path")

      // Log the screenshot being processed (dev only — path embeds the username).
      if (isDev) console.log("[ProcessingHelper] Processing screenshot:", imagePath)

      const stats = await fs.promises.stat(imagePath)
      const fileModifiedTime = stats.mtime
      const fileSize = stats.size

      if (isDev)
        console.log("[ProcessingHelper] Screenshot details:", {
          path: imagePath,
          modifiedTime: fileModifiedTime.toISOString(),
          size: fileSize,
          basename: path.basename(imagePath),
        })

      // Resize before encoding — a raw HiDPI PNG can be 4-8 MB, which is slow to
      // upload and costs tokens for no gain. The target width is computed from
      // the capturing display rather than fixed, so text arrives at roughly one
      // pixel per logical point on every platform.
      // No maxWidth: the target is derived from the display that produced the
      // capture so text stays legible at ~1 pixel per logical point. A fixed
      // width here was the cause of poor answers on 1440p/4K Windows desktops.
      const resized = await toResizedJpeg(imagePath, { quality: 92 })
      const base64Image = resized.toString("base64")

      if (isDev)
        console.log(
          `[ProcessingHelper] Image resized: ${fileSize} bytes → ${resized.length} bytes (${Math.round((resized.length / fileSize) * 100)}%)`
        )

      // Grounded, adaptive prompts. The previous "answer" prompt forced a
      // competitive-programming solution onto EVERY screenshot, so a plain note
      // ("What is java") made the model fabricate a coding problem. These prompts
      // read what is actually present first, then respond to the real content and
      // explicitly forbid inventing details that are not visible.
      const prompts = {
        analyze: `You are a precise image-analysis assistant. Follow these steps:
1. FIRST, read every single word, number, symbol, and code snippet visible in the screenshot character by character. Do not skip or paraphrase anything.
2. THEN, describe exactly what you see: the text content, code, UI elements, error messages, or diagrams.
3. Do NOT invent, assume, or hallucinate anything that is not literally visible on screen.
4. If any text is partially obscured or unclear, say so explicitly.

Be thorough and precise.`,

        answer: `You are an expert exam-solver. Follow these steps EXACTLY:

STEP 1 — READ: Carefully read every single word, option, number, and symbol visible in this screenshot. Pay attention to exact wording, punctuation, and spelling.

STEP 2 — THINK: Reason through the question step by step. Consider each option if it is multiple choice. Use your knowledge to determine the correct answer.

STEP 3 — ANSWER: Output ONLY the final answer. Nothing else.

Rules:
• Multiple-choice → reply with the correct option letter and its full text. Example: "C. 42"
• True/False → reply "True" or "False"
• Fill in the blank → reply with just the answer
• Coding problem → reply with ONLY the complete, correct, runnable code, wrapped in a single fenced code block (\`\`\`language ... \`\`\`)
• Math problem → show the key calculation steps, then the final numerical answer
• Any other question → reply with a direct, concise answer

CRITICAL: Read the question EXACTLY as written. Do not misread options. Do not skip words. Do not invent information that is not on screen. If you are unsure between options, re-read the screenshot text carefully before deciding.

MACHINE MARKER (MANDATORY LAST LINE): After your answer, output on its own final line an HTML comment encoding the multiple-choice selection so downstream tooling can act on it:
• Multiple-choice → <!--MCQ:X--> where X is the selected option letter(s). Use the letter(s) exactly as labelled in the question (A, B, C, D, or E). For more than one correct option, comma-separate them, e.g. <!--MCQ:A,C-->.
• Not multiple-choice (coding, math, true/false, fill-in-the-blank, open question) → <!--MCQ:NONE-->
Output the marker verbatim as an HTML comment and nothing after it. Only options labelled A through E map to a marker; if the question uses other labels, output <!--MCQ:NONE-->.`,
      }

      // Send initial problem info with empty text
      const initialProblemInfo = {
        problem_statement: "",
        input_format: { description: "Generated from screenshot", parameters: [] as any[] },
        output_format: {
          description: "Generated from screenshot",
          type: "string",
          subtype: "text",
        },
        complexity: { time: "N/A", space: "N/A" },
        test_cases: [] as any[],
        validation_type: "manual",
        difficulty: "custom",
        isStreaming: true,
      }

      mainWindow.webContents.send(
        this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        initialProblemInfo
      )
      this.appState.setProblemInfo(initialProblemInfo)

      let accumulatedText = ""
      const full = await this.llmHelper.streamImageAnalysis(
        prompts[analysisType],
        [base64Image],
        (token) => {
          accumulatedText += token
          const updatedProblemInfo = {
            ...initialProblemInfo,
            problem_statement: accumulatedText,
            isStreaming: true,
          }
          mainWindow.webContents.send("screenshot-analysis-stream", updatedProblemInfo)
          this.appState.setProblemInfo(updatedProblemInfo)
        },
        this.currentProcessingAbortController?.signal,
        0.0 // temperature = 0 for maximum accuracy
      )

      const finalProblemInfo = {
        ...initialProblemInfo,
        problem_statement: full || accumulatedText,
        isStreaming: false,
      }
      mainWindow.webContents.send(
        this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        finalProblemInfo
      )
      this.appState.setProblemInfo(finalProblemInfo)
      if (isDev) console.log("[ProcessingHelper] Streaming image analysis completed successfully")
    } catch (error) {
      if (isDev) console.error("[ProcessingHelper] Streaming image analysis error:", error)
      throw error
    }
  }
}
