// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import dotenv from "dotenv"

dotenv.config()

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState
    
    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Don't set default here, let LLMHelper auto-detect
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"
    
    if (useOllama) {
      console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not found in environment variables. Set GEMINI_API_KEY or enable Ollama with USE_OLLAMA=true")
      }
      console.log("[ProcessingHelper] Initializing with Gemini")
      this.llmHelper = new LLMHelper(apiKey, false)
    }
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
      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();
      const lastPath = allPaths[allPaths.length - 1];
      if (lastPath.endsWith('.mp3') || lastPath.endsWith('.wav')) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START);
        this.appState.setView('solutions');
        try {
          const audioResult = await this.llmHelper.analyzeAudioFile(lastPath);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, audioResult);
          this.appState.setProblemInfo({ problem_statement: audioResult.text, input_format: {}, output_format: {}, constraints: [], test_cases: [] });
          return;
        } catch (err: any) {
          console.error('Audio processing error:', err);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message);
          return;
        }
      }

      // NEW: Handle screenshot - show popup instead of direct analysis
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      
      // Instead of processing immediately, let the frontend show the popup
      // The actual processing will be triggered by the popup choice
      console.log("[ProcessingHelper] Screenshot ready for analysis, waiting for user choice");
      return;
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots to process")
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

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
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
    // Directly use LLMHelper to analyze inline base64 audio
    return this.llmHelper.analyzeAudioFromBase64(data, mimeType);
  }

  // Add audio file processing method
  public async processAudioFile(filePath: string) {
    return this.llmHelper.analyzeAudioFile(filePath);
  }

  public getLLMHelper() {
    return this.llmHelper;
  }

  // New method to handle screenshot analysis with user choice
  public async processScreenshotWithChoice(analysisType: 'analyze' | 'answer'): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
    if (screenshotQueue.length === 0) {
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    const lastPath = screenshotQueue[screenshotQueue.length - 1];
    this.currentProcessingAbortController = new AbortController()
    
    try {
      console.log(`[ProcessingHelper] Starting ${analysisType} analysis for screenshot:`, lastPath);
      
      // Test connection first
      console.log("[ProcessingHelper] Testing LLM connection...");
      const connectionTest = await this.llmHelper.testConnection();
      if (!connectionTest.success) {
        throw new Error(`LLM connection failed: ${connectionTest.error}`);
      }
      console.log("[ProcessingHelper] LLM connection test passed");
      
      // Check if model supports vision
      if (this.llmHelper.isUsingOllama() && !this.llmHelper.supportsVision()) {
        throw new Error(`Current model '${this.llmHelper.getCurrentModel()}' doesn't support image analysis. Please install a vision model like 'llava' or 'llama3.2-vision'.`);
      }
      
      // Start streaming analysis and send updates to Solutions view
      await this.streamImageAnalysisToSolutions(lastPath, mainWindow, analysisType);
      
    } catch (error: any) {
      console.error("Image processing error:", error);
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      if (error.message.includes('timed out')) {
        errorMessage = "Image analysis is taking too long. This might be because:\n• The model is still loading\n• The image is too complex\n• Ollama is not responding\n\nTry again or check your Ollama installation.";
      } else if (error.message.includes('vision model') || error.message.includes("doesn't support image")) {
        errorMessage = `${error.message}\n\nTo install a vision model, run:\nollama pull llava\n\nThen restart the application.`;
      } else if (error.message.includes('connection failed')) {
        errorMessage = `${error.message}\n\nMake sure Ollama is running:\n1. Start Ollama: ollama serve\n2. Install a model: ollama pull llava\n3. Restart this application`;
      }
      
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, errorMessage);
    } finally {
      this.currentProcessingAbortController = null;
    }
  }

  private async streamImageAnalysisToSolutions(imagePath: string, mainWindow: any, analysisType: 'analyze' | 'answer' = 'analyze') {
    try {
      // Read and encode image as base64
      const fs = require('fs');
      const imageData = await fs.promises.readFile(imagePath);
      const base64Image = imageData.toString('base64');
      
      // Get current model from LLMHelper
      const currentModel = this.llmHelper.getCurrentModel();
      
      // Different prompts based on analysis type
      const prompts = {
        analyze: "Analyze this screenshot image in detail. Describe what you see, identify any text, UI elements, problems, or important information. Be comprehensive and helpful.",
        answer: "Look at this code screenshot and provide a complete solution or answer. If it's a coding problem, provide the working code. If it's a question, provide a detailed answer. Focus on solving or answering what's shown in the image."
      };
      
      const response = await fetch(`${this.llmHelper.ollamaUrl || 'http://localhost:11434'}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: currentModel,
          prompt: prompts[analysisType],
          images: [base64Image],
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

      // Send initial problem info with empty text
      const initialProblemInfo = {
        problem_statement: "",
        input_format: { description: "Generated from screenshot", parameters: [] as any[] },
        output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
        complexity: { time: "N/A", space: "N/A" },
        test_cases: [] as any[],
        validation_type: "manual",
        difficulty: "custom",
        isStreaming: true
      };
      
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, initialProblemInfo);
      this.appState.setProblemInfo(initialProblemInfo);

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
                
                // Send streaming update to Solutions view
                const updatedProblemInfo = {
                  ...initialProblemInfo,
                  problem_statement: accumulatedText,
                  isStreaming: !data.done
                };
                
                mainWindow.webContents.send('screenshot-analysis-stream', updatedProblemInfo);
                this.appState.setProblemInfo(updatedProblemInfo);
              }
              
              if (data.done) {
                // Send final result
                const finalProblemInfo = {
                  ...initialProblemInfo,
                  problem_statement: accumulatedText,
                  isStreaming: false
                };
                
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, finalProblemInfo);
                this.appState.setProblemInfo(finalProblemInfo);
                console.log("[ProcessingHelper] Streaming image analysis completed successfully");
                return;
              }
            } catch (parseError) {
              console.warn('[ProcessingHelper] Skipping invalid JSON line:', line.substring(0, 100));
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('[ProcessingHelper] Streaming image analysis error:', error);
      throw error;
    }
  }
}
