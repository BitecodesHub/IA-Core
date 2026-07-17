// Environment configuration
export const isDevelopment = process.env.NODE_ENV === "development"
export const isProduction = process.env.NODE_ENV === "production"

// Feature flags
export const ENABLE_DEBUG_LOGS = isDevelopment
export const ENABLE_ERROR_REPORTING = isProduction

// API Configuration
export const OLLAMA_DEFAULT_URL = "http://localhost:11434"
export const OLLAMA_TIMEOUT = 30000 // 30 seconds

// App Configuration
export const MAX_SCREENSHOTS = 5
export const SCREENSHOT_QUALITY = 90
export const AUTO_SCROLL_THRESHOLD = 100 // pixels from bottom

// Performance — bounded so refetchOnMount/focus work and cached image
// previews are eventually garbage-collected (Infinity defeated both).
export const QUERY_STALE_TIME = 5_000 // 5s
export const QUERY_CACHE_TIME = 5 * 60_000 // 5min
export const QUERY_RETRY_COUNT = 3
export const QUERY_RETRY_DELAY = 1000

// UI Configuration
export const TOAST_DURATION = 3000
export const AUDIO_RESULT_DURATION = 3000

// Logging utility
export const log = {
  debug: (...args: any[]) => {
    if (ENABLE_DEBUG_LOGS) {
      console.log("[DEBUG]", ...args)
    }
  },
  info: (...args: any[]) => {
    console.log("[INFO]", ...args)
  },
  warn: (...args: any[]) => {
    console.warn("[WARN]", ...args)
  },
  error: (...args: any[]) => {
    console.error("[ERROR]", ...args)
  },
}
