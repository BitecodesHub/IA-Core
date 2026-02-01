import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import fs from "fs"

interface OllamaResponse {
  response: string
  done: boolean
}

export class LLMHelper {
  private model: GenerativeModel | null = null
  private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  public ollamaUrl: string = "http://localhost:11434" // Make public for access

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string) {
    this.useOllama = useOllama
    
    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      
      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey)
      this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("Either provide Gemini API key or enable Ollama mode")
    }
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json|javascript|typescript|python|java|cpp|c\+\+|csharp|php|ruby|go|rust|swift|kotlin)?\n?/gmi, '');
    text = text.replace(/\n?```$/gm, '');
    
    // Remove any leading/trailing whitespace
    text = text.trim();
    
    // Try to extract JSON from mixed content
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }
    
    return text;
  }

  private validateAndStructureResponse(response: any, expectedStructure: string): any {
    try {
      // If response is already an object, validate its structure
      if (typeof response === 'object' && response !== null) {
        return this.ensureResponseStructure(response, expectedStructure);
      }
      
      // If response is a string, try to parse it
      if (typeof response === 'string') {
        const cleaned = this.cleanJsonResponse(response);
        const parsed = JSON.parse(cleaned);
        return this.ensureResponseStructure(parsed, expectedStructure);
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('[LLMHelper] Error validating response:', error);
      return this.createFallbackResponse(expectedStructure, response);
    }
  }

  private ensureResponseStructure(response: any, expectedStructure: string): any {
    switch (expectedStructure) {
      case 'problem_extraction':
        return {
          problem_statement: response.problem_statement || "Unable to extract problem statement from the provided content.",
          context: response.context || "No additional context available.",
          suggested_responses: Array.isArray(response.suggested_responses) 
            ? response.suggested_responses 
            : ["Review the content manually", "Provide more specific information", "Try a different approach"],
          reasoning: response.reasoning || "Analysis completed with available information."
        };
      
      case 'solution_generation':
        const code = response.solution?.code || response.code || "// No code generated\n// Please provide more specific requirements";
        
        // Validate code syntax
        const validation = this.validateCodeSyntax(code);
        let finalCode = code;
        
        if (!validation.isValid) {
          console.warn("[LLMHelper] Code validation issues found:", validation.errors);
          finalCode = `${code}\n\n/* VALIDATION WARNINGS:\n${validation.errors.map(e => ` * ${e}`).join('\n')}\n */`;
        }
        
        return {
          solution: {
            code: finalCode,
            problem_statement: response.solution?.problem_statement || response.problem_statement || "Problem statement not available",
            context: response.solution?.context || response.context || "Context not available",
            suggested_responses: Array.isArray(response.solution?.suggested_responses) 
              ? response.solution.suggested_responses 
              : Array.isArray(response.suggested_responses)
              ? response.suggested_responses
              : ["Test the provided solution", "Review and modify as needed", "Check for edge cases"],
            reasoning: response.solution?.reasoning || response.reasoning || "Solution generated based on available information",
            validation: {
              isValid: validation.isValid,
              errors: validation.errors
            }
          }
        };
      
      case 'image_analysis':
        return {
          text: response.text || response.description || "Image analysis completed",
          timestamp: response.timestamp || Date.now()
        };
      
      default:
        return response;
    }
  }

  private createFallbackResponse(expectedStructure: string, originalResponse: any): any {
    const fallbackText = typeof originalResponse === 'string' 
      ? originalResponse 
      : "Unable to process the request properly. Please try again.";
    
    switch (expectedStructure) {
      case 'problem_extraction':
        return {
          problem_statement: "Error processing the provided content.",
          context: fallbackText,
          suggested_responses: ["Try rephrasing your request", "Provide clearer information", "Check the input format"],
          reasoning: "Fallback response due to processing error."
        };
      
      case 'solution_generation':
        return {
          solution: {
            code: `// Error generating solution
// Please review the requirements and try again
// Original error: ${fallbackText.substring(0, 200)}${fallbackText.length > 200 ? '...' : ''}

// TODO: Implement the required functionality
console.log("Solution generation failed - manual implementation required");`,
            problem_statement: "Unable to generate proper solution due to processing error",
            context: `Processing failed: ${fallbackText}`,
            suggested_responses: [
              "Review and clarify the requirements", 
              "Try breaking down the problem into smaller parts", 
              "Provide more specific technical details"
            ],
            reasoning: "Fallback response generated due to processing error. Manual review and implementation may be required."
          }
        };
      
      case 'image_analysis':
        return {
          text: `Image analysis failed: ${fallbackText}. Please ensure the image is clear and try again.`,
          timestamp: Date.now()
        };
      
      default:
        return { error: "Processing failed", original_response: fallbackText, timestamp: Date.now() };
    }
  }

  private validateCodeSyntax(code: string, language?: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!code || code.trim().length === 0) {
      errors.push("Code is empty");
      return { isValid: false, errors };
    }

    // Basic syntax validation for common languages
    if (language) {
      switch (language.toLowerCase()) {
        case 'javascript':
        case 'typescript':
          // Check for basic JS/TS syntax issues
          if (!this.hasMatchingBraces(code)) {
            errors.push("Mismatched braces {} in JavaScript/TypeScript code");
          }
          if (!this.hasMatchingParentheses(code)) {
            errors.push("Mismatched parentheses () in JavaScript/TypeScript code");
          }
          break;
        
        case 'python':
          // Check for basic Python syntax issues
          if (code.includes('\t') && code.includes('    ')) {
            errors.push("Mixed tabs and spaces in Python code");
          }
          break;
        
        case 'java':
        case 'csharp':
          if (!this.hasMatchingBraces(code)) {
            errors.push("Mismatched braces {} in code");
          }
          if (!code.includes(';') && code.length > 50) {
            errors.push("Missing semicolons in code");
          }
          break;
      }
    }

    // General validation
    if (!this.hasMatchingBraces(code)) {
      errors.push("Mismatched braces {}");
    }
    if (!this.hasMatchingParentheses(code)) {
      errors.push("Mismatched parentheses ()");
    }
    if (!this.hasMatchingBrackets(code)) {
      errors.push("Mismatched brackets []");
    }

    return { isValid: errors.length === 0, errors };
  }

  private hasMatchingBraces(code: string): boolean {
    let count = 0;
    for (const char of code) {
      if (char === '{') count++;
      if (char === '}') count--;
      if (count < 0) return false;
    }
    return count === 0;
  }

  private hasMatchingParentheses(code: string): boolean {
    let count = 0;
    for (const char of code) {
      if (char === '(') count++;
      if (char === ')') count--;
      if (count < 0) return false;
    }
    return count === 0;
  }

  private hasMatchingBrackets(code: string): boolean {
    let count = 0;
    for (const char of code) {
      if (char === '[') count++;
      if (char === ']') count--;
      if (count < 0) return false;
    }
    return count === 0;
  }

  private async callOllama(prompt: string, useStreaming: boolean = false): Promise<string> {
    try {
      console.log(`[LLMHelper] Calling Ollama with model: ${this.ollamaModel}, streaming: ${useStreaming}`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), useStreaming ? 120000 : 60000); // Longer timeout for streaming
      
      // Use simplified format matching the working curl example
      const requestBody = {
        model: this.ollamaModel,
        prompt: prompt,
        stream: useStreaming
      };
      
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Exact header from working curl
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LLMHelper] Ollama API error: ${response.status} ${response.statusText}. ${errorText}`);
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      if (useStreaming) {
        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body reader available");
        }

        let fullResponse = '';
        const decoder = new TextDecoder();

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
                  fullResponse += data.response;
                }
                
                // Check if streaming is complete
                if (data.done) {
                  console.log(`[LLMHelper] Streaming complete. Total response length: ${fullResponse.length}`);
                  return fullResponse;
                }
              } catch (parseError) {
                // Skip invalid JSON lines
                console.warn(`[LLMHelper] Skipping invalid JSON line: ${line.substring(0, 100)}`);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        
        if (!fullResponse) {
          throw new Error("No response content received from streaming");
        }
        
        return fullResponse;
      } else {
        // Handle non-streaming response
        const data: OllamaResponse = await response.json();
        
        if (!data.response) {
          console.error(`[LLMHelper] No response in data:`, data);
          throw new Error("No response content received from Ollama");
        }
        
        console.log(`[LLMHelper] Successfully received response from Ollama (${data.response.length} characters)`);
        return data.response;
      }
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error);
      
      // Handle timeout specifically
      if (error.name === 'AbortError') {
        const timeoutDuration = useStreaming ? '2 minutes' : '60 seconds';
        throw new Error(`Request timed out after ${timeoutDuration}. The model '${this.ollamaModel}' may be too slow or not responding.`);
      }
      
      // Provide more specific error messages
      if (error.message.includes('404')) {
        throw new Error(`Model '${this.ollamaModel}' not found. Please install it with: ollama pull ${this.ollamaModel}`);
      } else if (error.message.includes('connection') || error.message.includes('ECONNREFUSED')) {
        throw new Error(`Failed to connect to Ollama at ${this.ollamaUrl}. Make sure Ollama is running.`);
      } else {
        throw new Error(`Ollama error: ${error.message}`);
      }
    }
  }

  private async callOllamaWithImages(prompt: string, images: string[]): Promise<string> {
    try {
      console.log(`[LLMHelper] Calling Ollama with ${images.length} images using model: ${this.ollamaModel}`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for streaming
      
      // Use the exact format from the working curl example with streaming enabled
      const requestBody = {
        model: this.ollamaModel,
        prompt: prompt,
        images: images, // Raw base64 strings array - exactly like the curl example
        stream: true // Enable streaming for real-time responses
      };
      
      console.log(`[LLMHelper] Request body structure:`, {
        model: requestBody.model,
        prompt: requestBody.prompt.substring(0, 100) + '...',
        images: `[${requestBody.images.length} base64 strings]`,
        stream: requestBody.stream
      });
      
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // Exact header from working curl
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LLMHelper] Ollama API error: ${response.status} ${response.statusText}. ${errorText}`);
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader available");
      }

      let fullResponse = '';
      const decoder = new TextDecoder();

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
                fullResponse += data.response;
                console.log(`[LLMHelper] Streaming chunk: ${data.response.substring(0, 50)}...`);
              }
              
              // Check if streaming is complete
              if (data.done) {
                console.log(`[LLMHelper] Streaming complete. Total response length: ${fullResponse.length}`);
                return fullResponse;
              }
            } catch (parseError) {
              // Skip invalid JSON lines
              console.warn(`[LLMHelper] Skipping invalid JSON line: ${line.substring(0, 100)}`);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      if (!fullResponse) {
        console.error(`[LLMHelper] No content received from streaming response`);
        throw new Error("No content received from Ollama API");
      }
      
      console.log(`[LLMHelper] Successfully received streaming response from Ollama (${fullResponse.length} characters)`);
      return fullResponse;
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama with images:", error);
      
      // Handle timeout specifically
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after 2 minutes. The model '${this.ollamaModel}' may be too slow or not responding.`);
      }
      
      // Provide more specific error messages
      if (error.message.includes('404')) {
        throw new Error(`Model '${this.ollamaModel}' not found. Please install it with: ollama pull ${this.ollamaModel}`);
      } else if (error.message.includes('connection') || error.message.includes('ECONNREFUSED')) {
        throw new Error(`Failed to connect to Ollama at ${this.ollamaUrl}. Make sure Ollama is running.`);
      } else {
        throw new Error(`Ollama error: ${error.message}. Make sure you have a vision model installed and Ollama is running on ${this.ollamaUrl}`);
      }
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private isVisionModel(modelName: string): boolean {
    const visionModels = [
      'llama3.2-vision',
      'llava',
      'llava:7b',
      'llava:13b',
      'llava:34b',
      'llava-llama3',
      'llava-phi3',
      'llava-vicuna',
      'gemma3', // gemma3 supports vision
      'bakllava',
      'moondream',
      'cogvlm',
      'minicpm-v'
    ]
    
    const modelLower = modelName.toLowerCase();
    return visionModels.some(visionModel => 
      modelLower.includes(visionModel.toLowerCase()) || 
      modelLower.startsWith(visionModel.toLowerCase())
    );
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        // Prefer vision models if available
        const visionModels = availableModels.filter(model => this.isVisionModel(model));
        if (visionModels.length > 0) {
          this.ollamaModel = visionModels[0];
          console.log(`[LLMHelper] Auto-selected first available vision model: ${this.ollamaModel}`);
        } else {
          this.ollamaModel = availableModels[0];
          console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`);
        }
      }

      // Test the selected model works (no streaming for initialization test)
      const testResult = await this.callOllama("Hello", false)
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
      
      if (this.isVisionModel(this.ollamaModel)) {
        console.log(`[LLMHelper] Vision capabilities enabled with model: ${this.ollamaModel}`)
      } else {
        console.log(`[LLMHelper] Note: Current model '${this.ollamaModel}' doesn't support image analysis. Consider using a vision model like 'llama3.2-vision', 'gemma3', or 'llava' for image capabilities.`)
      }
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "Third possible answer or action"],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks. Ensure all fields are properly filled.`;

      let responseText: string;

      if (this.useOllama) {
        // Check if current model supports vision
        if (!this.isVisionModel(this.ollamaModel)) {
          throw new Error(`Image analysis requires a vision model. Current model '${this.ollamaModel}' doesn't support images. Please switch to a vision model like 'llama3.2-vision', 'gemma3', or 'llava'.`);
        }
        
        // Read and encode images as base64
        const base64Images = await Promise.all(
          imagePaths.map(async (path) => {
            const imageData = await fs.promises.readFile(path);
            return imageData.toString("base64");
          })
        );
        
        responseText = await this.callOllamaWithImages(prompt, base64Images);
      } else {
        if (!this.model) {
          throw new Error("No Gemini model configured for image analysis");
        }
        
        const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)));
        const result = await this.model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        responseText = response.text();
      }

      return this.validateAndStructureResponse(responseText, 'problem_extraction');
    } catch (error) {
      console.error("Error extracting problem from images:", error);
      return this.createFallbackResponse('problem_extraction', error.message);
    }
  }

  public async generateSolution(problemInfo: any) {
    try {
      const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The complete, working code solution here. Include proper syntax, comments, and error handling. Make sure the code is production-ready and follows best practices.",
    "problem_statement": "Restate the problem or situation clearly.",
    "context": "Relevant background/context and technical considerations.",
    "suggested_responses": ["First possible next step", "Second possible next step", "Third possible next step"],
    "reasoning": "Detailed explanation of the solution approach, why this code works, and any important considerations."
  }
}\n\nIMPORTANT REQUIREMENTS:
- Return ONLY the JSON object, without markdown formatting or code blocks
- Ensure the code is syntactically correct and complete
- Include proper error handling and edge cases
- Add meaningful comments to explain complex logic
- Follow language-specific best practices and conventions
- Make sure all fields are properly filled with meaningful content`;

      console.log("[LLMHelper] Generating solution...");
      
      let responseText: string;

      if (this.useOllama) {
        // Use streaming for solution generation for better user experience
        responseText = await this.callOllama(prompt, true);
      } else {
        if (!this.model) {
          throw new Error("No LLM model configured");
        }
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        responseText = response.text();
      }

      console.log("[LLMHelper] LLM returned result.");
      const structuredResponse = this.validateAndStructureResponse(responseText, 'solution_generation');
      console.log("[LLMHelper] Parsed and validated LLM response:", structuredResponse);
      
      return structuredResponse;
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      return this.createFallbackResponse('solution_generation', error.message);
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const prompt = `${this.systemPrompt}\n\nYou are a wingman debugging assistant. Given:
1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}
2. The current response or approach: ${currentCode}
3. The debug information in the provided images

Please analyze the debug information and provide feedback in this JSON format:
{
  "solution": {
    "code": "The corrected, complete, working code solution. Include proper syntax, error handling, and comments. Make sure it addresses the issues shown in the debug images.",
    "problem_statement": "Restate the problem and identify what went wrong.",
    "context": "Analysis of the debug information and technical context from the images.",
    "suggested_responses": ["First debugging step", "Second debugging step", "Third debugging step"],
    "reasoning": "Detailed explanation of what caused the issue, how the fix works, and why this approach solves the problem."
  }
}

IMPORTANT REQUIREMENTS:
- Return ONLY the JSON object, without markdown formatting or code blocks
- Analyze the debug images carefully to identify the root cause
- Provide a complete, working solution that fixes the identified issues
- Include proper error handling and validation
- Add meaningful comments explaining the fixes
- Ensure all fields contain meaningful, specific content`;

      let responseText: string;

      if (this.useOllama) {
        // Check if current model supports vision
        if (!this.isVisionModel(this.ollamaModel)) {
          throw new Error(`Image analysis requires a vision model. Current model '${this.ollamaModel}' doesn't support images. Please switch to a vision model like 'llama3.2-vision', 'gemma3', or 'llava'.`);
        }
        
        // Read and encode images as base64
        const base64Images = await Promise.all(
          debugImagePaths.map(async (path) => {
            const imageData = await fs.promises.readFile(path);
            return imageData.toString("base64");
          })
        );
        
        responseText = await this.callOllamaWithImages(prompt, base64Images);
      } else {
        if (!this.model) {
          throw new Error("No Gemini model configured for image analysis");
        }
        
        const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)));
        const result = await this.model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        responseText = response.text();
      }

      const structuredResponse = this.validateAndStructureResponse(responseText, 'solution_generation');
      console.log("[LLMHelper] Parsed debug LLM response:", structuredResponse);
      return structuredResponse;
    } catch (error) {
      console.error("Error debugging solution with images:", error);
      return this.createFallbackResponse('solution_generation', `Debug error: ${error.message}`);
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      if (this.useOllama) {
        // Ollama doesn't support audio analysis yet, return a helpful message
        const text = "Audio analysis is not currently supported with Ollama. Please switch to Gemini to analyze audio files, or provide a text description of the audio content.";
        return { text, timestamp: Date.now() };
      } else {
        if (!this.model) {
          throw new Error("No Gemini model configured for audio analysis");
        }
        
        const audioData = await fs.promises.readFile(audioPath);
        const audioPart = {
          inlineData: {
            data: audioData.toString("base64"),
            mimeType: "audio/mp3"
          }
        };
        const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user.`;
        const result = await this.model.generateContent([prompt, audioPart]);
        const response = await result.response;
        const text = response.text();
        return { text, timestamp: Date.now() };
      }
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      if (this.useOllama) {
        // Ollama doesn't support audio analysis yet, return a helpful message
        const text = "Audio analysis is not currently supported with Ollama. Please switch to Gemini to analyze audio files, or provide a text description of the audio content.";
        return { text, timestamp: Date.now() };
      } else {
        if (!this.model) {
          throw new Error("No Gemini model configured for audio analysis");
        }
        
        const audioPart = {
          inlineData: {
            data,
            mimeType
          }
        };
        const prompt = `${this.systemPrompt}\n\nDescribe this audio clip in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the audio. Do not return a structured JSON object, just answer naturally as you would to a user and be concise.`;
        const result = await this.model.generateContent([prompt, audioPart]);
        const response = await result.response;
        const text = response.text();
        return { text, timestamp: Date.now() };
      }
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const prompt = `${this.systemPrompt}\n\nAnalyze this image and provide a comprehensive description. Include:
- What you see in the image (objects, people, text, UI elements, etc.)
- Any technical details if it's a screenshot (error messages, code, interfaces)
- Context and relevant information
- Several specific, actionable suggestions for what the user could do next

Provide a natural, conversational response that's informative and helpful. Be specific and detailed in your analysis.`;

      let responseText: string;

      if (this.useOllama) {
        // Check if current model supports vision
        if (!this.isVisionModel(this.ollamaModel)) {
          const text = `Image analysis requires a vision model. Current model '${this.ollamaModel}' doesn't support images. 

Available vision models you can install:
• ollama pull llama3.2-vision (recommended)
• ollama pull gemma3
• ollama pull llava

After installing, restart the application to use the vision model.`;
          return { text, timestamp: Date.now() };
        }
        
        // Read and encode image as base64
        const imageData = await fs.promises.readFile(imagePath);
        const base64Image = imageData.toString("base64");
        
        responseText = await this.callOllamaWithImages(prompt, [base64Image]);
      } else {
        if (!this.model) {
          throw new Error("No Gemini model configured for image analysis");
        }
        
        const imageData = await fs.promises.readFile(imagePath);
        const imagePart = {
          inlineData: {
            data: imageData.toString("base64"),
            mimeType: "image/png"
          }
        };
        const result = await this.model.generateContent([prompt, imagePart]);
        const response = await result.response;
        responseText = response.text();
      }

      // Ensure we have meaningful content
      if (!responseText || responseText.trim().length < 10) {
        responseText = "Image analysis completed, but no detailed description was generated. The image may be unclear or the model may need adjustment.";
      }

      return this.validateAndStructureResponse({ text: responseText, timestamp: Date.now() }, 'image_analysis');
    } catch (error) {
      console.error("Error analyzing image file:", error);
      return this.createFallbackResponse('image_analysis', `Error analyzing image: ${error.message}`);
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) {
        // Use streaming for chat interactions for better user experience
        return this.callOllama(message, true);
      } else if (this.model) {
        const result = await this.model.generateContent(message);
        const response = await result.response;
        return response.text();
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    if (!this.useOllama) return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public async getOllamaVisionModels(): Promise<string[]> {
    const allModels = await this.getOllamaModels();
    return allModels.filter(model => this.isVisionModel(model));
  }

  public getCurrentProvider(): "ollama" | "gemini" {
    return this.useOllama ? "ollama" : "gemini";
  }

  public getCurrentModel(): string {
    return this.useOllama ? this.ollamaModel : "gemini-2.0-flash";
  }

  public supportsVision(): boolean {
    if (this.useOllama) {
      return this.isVisionModel(this.ollamaModel);
    } else {
      return true; // Gemini supports vision
    }
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    }
    
    if (!this.model && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.useOllama = false;
    console.log("[LLMHelper] Switched to Gemini");
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[LLMHelper] Testing connection with provider: ${this.getCurrentProvider()}, model: ${this.getCurrentModel()}`);
      
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        
        // Test with a simple prompt first (no streaming for connection test)
        try {
          const testResponse = await this.callOllama("Hello, respond with just 'OK'", false);
          console.log(`[LLMHelper] Basic test successful: ${testResponse.substring(0, 50)}...`);
          
          // If current model supports vision, test that too
          if (this.isVisionModel(this.ollamaModel)) {
            console.log(`[LLMHelper] Model ${this.ollamaModel} supports vision - connection test complete`);
          } else {
            console.log(`[LLMHelper] Model ${this.ollamaModel} is text-only - vision features not available`);
          }
          
          return { success: true };
        } catch (error) {
          return { success: false, error: `Model test failed: ${error.message}` };
        }
      } else {
        if (!this.model) {
          return { success: false, error: "No Gemini model configured" };
        }
        // Test with a simple prompt
        const result = await this.model.generateContent("Hello");
        const response = await result.response;
        const text = response.text(); // Ensure the response is valid
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      console.error(`[LLMHelper] Connection test failed:`, error);
      return { success: false, error: error.message };
    }
  }
} 