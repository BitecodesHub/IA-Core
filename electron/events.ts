// Single source of truth for the processing-event channel names, shared by the
// main process (AppState) and the preload bridge so they can never drift apart.
export const PROCESSING_EVENTS = {
  // global states
  UNAUTHORIZED: "processing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",

  // states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",

  // states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error",
} as const

export type ProcessingEvent = (typeof PROCESSING_EVENTS)[keyof typeof PROCESSING_EVENTS]
