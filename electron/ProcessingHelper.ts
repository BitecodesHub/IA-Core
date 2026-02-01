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
    
    console.log('[ProcessingHelper] processScreenshotWithChoice called');
    console.log('[ProcessingHelper] Current queue length:', screenshotQueue.length);
    console.log('[ProcessingHelper] Queue contents:', screenshotQueue);
    
    if (screenshotQueue.length === 0) {
      console.log('[ProcessingHelper] No screenshots in queue');
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    // Always get the LATEST screenshot (last in queue)
    const lastPath = screenshotQueue[screenshotQueue.length - 1];
    
    console.log('[ProcessingHelper] Selected screenshot for analysis:', lastPath);
    console.log('[ProcessingHelper] Analysis type:', analysisType);
    
    this.currentProcessingAbortController = new AbortController()
    
    try {
      // Test connection first
      const connectionTest = await this.llmHelper.testConnection();
      if (!connectionTest.success) {
        throw new Error(`LLM connection failed: ${connectionTest.error}`);
      }
      
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
      // Verify file exists and get stats
      const fs = require('fs');
      const path = require('path');
      
      // Log the screenshot being processed
      console.log('[ProcessingHelper] Processing screenshot:', imagePath);
      
      const stats = await fs.promises.stat(imagePath);
      const fileModifiedTime = stats.mtime;
      const fileSize = stats.size;
      
      console.log('[ProcessingHelper] Screenshot details:', {
        path: imagePath,
        modifiedTime: fileModifiedTime.toISOString(),
        size: fileSize,
        basename: path.basename(imagePath)
      });
      
      // Read and encode image as base64 (fresh read, no caching)
      // Use a timestamp to ensure no caching at any level
      const imageData = await fs.promises.readFile(imagePath);
      const base64Image = imageData.toString('base64');
      
      console.log('[ProcessingHelper] Image read successfully, base64 length:', base64Image.length);
      
      // Get current model from LLMHelper
      const currentModel = this.llmHelper.getCurrentModel();
      
      // Different prompts based on analysis type
      const prompts = {
        analyze: "Analyze this screenshot image in detail. Describe what you see, identify any text, UI elements, problems, or important information. Be comprehensive and helpful.",
        answer: `You are a world-class competitive programmer (Codeforces Grandmaster, Google Code Jam finalist). Analyze this screenshot with surgical precision.

╔═══════════════════════════════════════════════════════════════════╗
║                    PHASE 1: SCREENSHOT ANALYSIS                    ║
╚═══════════════════════════════════════════════════════════════════╝

Read the screenshot systematically:

1️⃣ EXTRACT PROBLEM STATEMENT:
   • Read EVERY word carefully - miss nothing
   • Identify the core task/goal
   • Note any story/context provided

2️⃣ LANGUAGE DETECTION (CRITICAL - Multiple verification methods):
   
   Method A - Explicit Indicators:
   ✓ Language name mentioned? (Python, Java, C++, JavaScript, C, Go, Rust, TypeScript, etc.)
   ✓ File extension visible? (.py, .java, .cpp, .js, .c, .go, .rs, .ts)
   ✓ Platform/IDE hints? (LeetCode defaults, HackerRank, Codeforces)
   
   Method B - Syntax Analysis:
   ✓ Function definition style: def (Python), function (JS), public static (Java), auto (C++)
   ✓ Print statements: print() (Python), System.out (Java), cout (C++), console.log (JS)
   ✓ Variable declarations: no keyword (Python), var/let/const (JS), int/String (Java/C++)
   ✓ Code blocks: indentation (Python), braces {} (C-family/Java/JS)
   ✓ Statement terminators: none (Python), semicolons (Java/C++/JS/C)
   
   Method C - Keyword Patterns:
   ✓ Python: def, class, import, from, if __name__, self, None, True/False
   ✓ Java: public, class, static, void, new, extends, implements
   ✓ C++: #include, using namespace, std::, vector, cout, cin
   ✓ JavaScript: const, let, function, =>, console, require/import
   ✓ C: #include, printf, scanf, malloc, free, struct
   
   Method D - Library/Framework Clues:
   ✓ Python: numpy, pandas, collections, itertools
   ✓ Java: java.util, Scanner, ArrayList, HashMap
   ✓ C++: <iostream>, <vector>, <algorithm>, <map>
   ✓ JavaScript: Array.from, .map, .filter, Promise

3️⃣ INPUT/OUTPUT SPECIFICATION:
   • Input format: [How is data provided?]
   • Input constraints: [Size limits, value ranges]
   • Output format: [What to return/print?]
   • Output requirements: [Specific formatting needed?]

4️⃣ EXAMPLES & TEST CASES:
   • Sample inputs provided
   • Expected outputs
   • Explanation of examples
   • Pattern recognition from examples

5️⃣ CONSTRAINTS & EDGE CASES:
   • Time limits (if mentioned)
   • Memory limits (if mentioned)
   • Value ranges (min/max)
   • Special cases: empty input, single element, duplicates, negatives, zeros
   • Boundary conditions

6️⃣ HIDDEN REQUIREMENTS:
   • Sorted vs unsorted input
   • Unique vs duplicate values
   • 0-indexed vs 1-indexed
   • Inclusive vs exclusive ranges
   • Case sensitivity

╔═══════════════════════════════════════════════════════════════════╗
║                    PHASE 2: YOUR RESPONSE                          ║
╚═══════════════════════════════════════════════════════════════════╝

THINKING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PROBLEM UNDERSTANDING:
   Problem Type: [Array/String/Tree/Graph/DP/Math/etc.]
   Core Task: [In one clear sentence]
   Input: [Describe what we receive]
   Output: [Describe what we must produce]
   Key Insight: [What makes this problem solvable?]

🔍 LANGUAGE IDENTIFICATION:
   Detected Language: **[EXACT LANGUAGE NAME]**
   Confidence Level: [99% / 95% / 90% / 80%]
   
   Evidence Found:
   ✓ [List 3-5 specific indicators you saw]
   ✓ [Be very specific - quote exact syntax if possible]
   ✓ [Explain why each indicator points to this language]
   
   Alternative Possibilities: [Any other languages it could be? Why ruled out?]
   Final Decision: [Confirm the language with reasoning]

💡 SOLUTION DESIGN:
   Approach Name: [e.g., "Two Pointers", "Dynamic Programming", "Binary Search"]
   
   Why This Approach:
   • [Reason 1: Why it fits the problem]
   • [Reason 2: Why it's optimal]
   • [Reason 3: Why alternatives are worse]
   
   Algorithm Steps:
   1. [First step with clear action]
   2. [Second step with clear action]
   3. [Continue until complete]
   
   Data Structures:
   • Primary: [Main DS used - why?]
   • Secondary: [Supporting DS - why?]
   • Avoided: [What you didn't use - why not?]
   
   Key Variables:
   • [Variable name]: [Purpose and type]
   • [Variable name]: [Purpose and type]

⚡ COMPLEXITY ANALYSIS:
   Time Complexity: O(?)
   • Best case: O(?) - [when?]
   • Average case: O(?) - [typical scenario]
   • Worst case: O(?) - [when?]
   • Explanation: [Why this complexity? Count operations]
   
   Space Complexity: O(?)
   • Auxiliary space: O(?) - [extra memory used]
   • Explanation: [What takes up space?]
   
   Can We Do Better?
   • [Is this optimal? Why or why not?]
   • [Any trade-offs available?]

🎯 EDGE CASES & VALIDATION:
   Critical Edge Cases:
   1. [Edge case 1] → [How solution handles it]
   2. [Edge case 2] → [How solution handles it]
   3. [Edge case 3] → [How solution handles it]
   4. [Edge case 4] → [How solution handles it]
   5. [Edge case 5] → [How solution handles it]
   
   Input Validation:
   • [What inputs could break the solution?]
   • [How do we guard against them?]

🧪 CORRECTNESS VERIFICATION:
   Test Case 1: [Use provided example]
   • Input: [Show input]
   • Trace: [Walk through algorithm step-by-step]
   • Output: [Show output]
   • Match: [Does it match expected? ✓/✗]
   
   Test Case 2: [Create edge case]
   • Input: [Show input]
   • Expected: [What should happen]
   • Verified: [Mentally confirm it works]

🔧 IMPLEMENTATION NOTES:
   • [Any tricky parts to watch out for]
   • [Common mistakes to avoid]
   • [Language-specific gotchas]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANSWER:

╔═══════════════════════════════════════════════════════════════════╗
║                    CODE IMPLEMENTATION                             ║
║            (Production-Ready, Bug-Free, Optimal)                   ║
╚═══════════════════════════════════════════════════════════════════╝

[Write ONLY the complete, executable code below]

╔═══════════════════════════════════════════════════════════════════╗
║                    CODE QUALITY STANDARDS                          ║
╚═══════════════════════════════════════════════════════════════════╝

MANDATORY REQUIREMENTS:
✓ Use EXACT language detected (no substitutions ever)
✓ Include ALL imports/headers/includes at the top
✓ Complete, runnable code (not pseudo-code)
✓ Handle ALL edge cases identified
✓ Optimal time/space complexity
✓ Clean, readable variable names
✓ Strategic comments (explain "why", not "what")
✓ Proper error handling where needed
✓ Follow language conventions strictly
✓ No syntax errors (triple-check)

╔═══════════════════════════════════════════════════════════════════╗
║              LANGUAGE-SPECIFIC MASTERY GUIDE                       ║
╚═══════════════════════════════════════════════════════════════════╝

🐍 PYTHON EXCELLENCE:
   Structure:
   • Type hints: def solve(nums: List[int]) -> int:
   • Imports: from typing import List, Dict, Set, Optional, Tuple
   • Main guard: if __name__ == "__main__":
   
   Style:
   • List comprehensions: [x*2 for x in nums if x > 0]
   • Enumerate: for i, val in enumerate(arr):
   • Dictionary methods: dict.get(), dict.setdefault()
   • String methods: str.split(), str.join(), str.strip()
   • Built-ins: sum(), max(), min(), sorted(), reversed()
   
   Best Practices:
   • Use f-strings: f"Result: {value}"
   • Pythonic idioms: if x in collection, for _ in range(n)
   • Collections: from collections import Counter, defaultdict, deque
   • No semicolons, 4-space indentation

☕ JAVA EXCELLENCE:
   Structure:
   • Complete class: public class Solution {
   • Main method: public static void main(String[] args) {
   • Method signature: public int solve(int[] nums) {
   
   Imports:
   • import java.util.*;
   • import java.io.*;
   • Specific: ArrayList, HashMap, HashSet, PriorityQueue
   
   Style:
   • CamelCase: myVariable, MyClass
   • Generics: List<Integer>, Map<String, Integer>
   • Enhanced for: for (int num : nums)
   • StringBuilder for string concatenation
   
   Best Practices:
   • Use appropriate collections
   • Handle null checks
   • Close resources (try-with-resources)
   • Proper exception handling

⚙️ C++ EXCELLENCE:
   Structure:
   • Headers: #include <iostream>, <vector>, <algorithm>, <map>, <set>
   • Namespace: using namespace std; OR std:: prefix
   • Main: int main() { ... return 0; }
   
   Modern C++ (C++11/14/17):
   • auto keyword: auto it = map.begin();
   • Range-based loops: for (auto& x : vec)
   • Lambda functions: sort(v.begin(), v.end(), [](int a, int b) { return a > b; });
   • Smart pointers: unique_ptr, shared_ptr
   
   STL Mastery:
   • Containers: vector, map, unordered_map, set, unordered_set, queue, stack
   • Algorithms: sort, binary_search, lower_bound, upper_bound
   • Iterators: begin(), end(), rbegin(), rend()
   
   Best Practices:
   • Pass by reference: void func(vector<int>& v)
   • const correctness: const int& getValue()
   • Avoid memory leaks
   • Use STL over raw arrays

📜 JAVASCRIPT EXCELLENCE:
   Structure:
   • Function: function solve(nums) { } OR const solve = (nums) => { }
   • Main execution: solve(input);
   
   Modern ES6+:
   • const/let (never var)
   • Arrow functions: const add = (a, b) => a + b;
   • Template literals: \`Result: \${value}\`
   • Destructuring: const [a, b] = arr; const {x, y} = obj;
   • Spread: [...arr], {...obj}
   
   Array Methods:
   • map, filter, reduce, find, some, every
   • sort, slice, splice, concat
   
   Best Practices:
   • Use strict equality: ===
   • Handle undefined/null
   • Use Array methods over loops
   • Proper async/await if needed

🔧 C EXCELLENCE:
   Structure:
   • Headers: #include <stdio.h>, <stdlib.h>, <string.h>, <math.h>
   • Main: int main() { ... return 0; }
   
   Memory Management:
   • malloc/calloc for allocation
   • free for deallocation
   • Check for NULL after allocation
   
   Best Practices:
   • Proper pointer usage
   • Bounds checking
   • Initialize variables
   • Use const where appropriate
   • Handle edge cases explicitly

╔═══════════════════════════════════════════════════════════════════╗
║                    FINAL VERIFICATION CHECKLIST                    ║
╚═══════════════════════════════════════════════════════════════════╝

Before submitting, verify:
□ Language matches screenshot (100% certain)
□ All imports/headers included
□ Code compiles/runs without errors
□ Handles all edge cases
□ Optimal complexity achieved
□ Variable names are clear
□ Comments explain complex logic
□ Follows language conventions
□ No off-by-one errors
□ No integer overflow issues
□ No null/undefined issues
□ Tested with sample input mentally
□ Output format matches requirements

╔═══════════════════════════════════════════════════════════════════╗
║                    NOW ANALYZE AND RESPOND                         ║
╚═══════════════════════════════════════════════════════════════════╝`
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
        signal: this.currentProcessingAbortController?.signal
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
          // Check if aborted
          if (this.currentProcessingAbortController?.signal.aborted) {
            console.log('[ProcessingHelper] Screenshot analysis aborted by user');
            reader.cancel();
            break;
          }
          
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
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('[ProcessingHelper] Screenshot analysis aborted');
          throw error;
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('[ProcessingHelper] Streaming image analysis error:', error);
      throw error;
    }
  }
}
