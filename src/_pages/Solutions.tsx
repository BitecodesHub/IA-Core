// Solutions.tsx
import React, { useState, useEffect } from "react"
import { useQuery, useQueryClient } from "react-query"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism"

import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import { ProblemStatementData } from "../types/solutions"
import SolutionCommands from "../components/Solutions/SolutionCommands"
import { ContentSection, ComplexitySection } from "../components/Solutions/ContentSection"
import Debug from "./Debug"
import { QUERY_STALE_TIME, QUERY_CACHE_TIME } from "../config/environment"

const SolutionSection = ({
  title,
  content,
  isLoading,
}: {
  title: string
  content: React.ReactNode
  isLoading: boolean
}) => (
  <div className="space-y-2">
    <h2 className="text-[13px] font-medium text-white tracking-wide">{title}</h2>
    {isLoading ? (
      <div className="space-y-1.5">
        <div className="mt-4 flex">
          <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
            Loading solutions...
          </p>
        </div>
      </div>
    ) : (
      <div className="w-full">
        <SyntaxHighlighter
          showLineNumbers
          language="python"
          style={dracula}
          customStyle={{
            maxWidth: "100%",
            margin: 0,
            padding: "1rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
          wrapLongLines={true}
        >
          {content as string}
        </SyntaxHighlighter>
      </div>
    )}
  </div>
)

interface SolutionsProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}
const Solutions: React.FC<SolutionsProps> = ({ setView }) => {
  const queryClient = useQueryClient()

  const [debugProcessing, setDebugProcessing] = useState(false)
  const [hasDebugResult, setHasDebugResult] = useState(() => Boolean(queryClient.getQueryData(["new_solution"])))
  const [problemStatementData, setProblemStatementData] = useState<ProblemStatementData | null>(
    null
  )
  const [isStreamingAnalysis, setIsStreamingAnalysis] = useState(false)
  const [solutionData, setSolutionData] = useState<string | null>(null)
  const [thoughtsData, setThoughtsData] = useState<string[] | null>(null)
  const [timeComplexityData, setTimeComplexityData] = useState<string | null>(null)
  const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(null)

  const [failure, setFailure] = useState<string | null>(null)
  const [solutionPending, setSolutionPending] = useState(!queryClient.getQueryData(["solution"]))

  const { data: extraScreenshots = [], refetch, error: screenshotsError, isFetching } = useQuery<
    Array<{ path: string; preview: string }>,
    Error
  >(
    ["extras"],
    () => window.electronAPI.getScreenshots(),
    {
      staleTime: QUERY_STALE_TIME,
      cacheTime: QUERY_CACHE_TIME,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    }
  )

  const handleDeleteExtraScreenshot = async (index: number) => {
    const screenshotToDelete = extraScreenshots[index]
    if (!screenshotToDelete) return
    setFailure(null)
    try {
      const response = await window.electronAPI.deleteScreenshot(screenshotToDelete.path)

      if (response.success) {
        refetch() // Refetch screenshots instead of managing state directly
      } else {
        setFailure("Could not delete the screenshot. Try deleting it again.")
      }
    } catch (error) {
      setFailure("Could not delete the screenshot. Try deleting it again.")
      console.error("Error deleting extra screenshot:", error)
    }
  }

  // App owns content sizing. SolutionCommands no longer has an overflowing tooltip.
  // IPC listeners — registered ONCE, decoupled from tooltip state.
  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => {
        setFailure(null)
        setSolutionPending(false)
        setIsStreamingAnalysis(false)
        setDebugProcessing(false)
        queryClient.removeQueries(["solution"])
        queryClient.removeQueries(["new_solution"])
        setHasDebugResult(false)
        refetch()
      }),
      // Add streaming screenshot analysis listener
      window.electronAPI.onScreenshotAnalysisStream((data: any) => {
        console.log("[Solutions] Received streaming analysis update:", data)
        setProblemStatementData(data)
        setIsStreamingAnalysis(data.isStreaming || false)
        setSolutionPending(data.isStreaming || false)
        queryClient.setQueryData(["problem_statement"], data)
      }),
      window.electronAPI.onSolutionStart(() => {
        // Reset UI state for a new solution.
        setFailure(null)
        setSolutionPending(true)
        setSolutionData(null)
        setThoughtsData(null)
        setTimeComplexityData(null)
        setSpaceComplexityData(null)
      }),
      //if there was an error processing the initial solution
      window.electronAPI.onSolutionError((error: string) => {
        setFailure("Processing failed. Capture another screenshot and try again using the commands above.")
        setSolutionPending(false)
        setIsStreamingAnalysis(false)
        setDebugProcessing(false)
        // Reset solutions in the cache (even though this shouldn't ever happen) and complexities to previous states
        const solution = queryClient.getQueryData(["solution"]) as {
          code: string
          thoughts: string[]
          time_complexity: string
          space_complexity: string
        } | null
        setSolutionData(solution?.code || null)
        setThoughtsData(solution?.thoughts || null)
        setTimeComplexityData(solution?.time_complexity || null)
        setSpaceComplexityData(solution?.space_complexity || null)
        console.error("Processing error:", error)
      }),
      //when the initial solution is generated, we'll set the solution data to that
      window.electronAPI.onSolutionSuccess((data) => {
        setSolutionPending(false)
        setIsStreamingAnalysis(false)
        if (!data?.solution) {
          setFailure("No solution was returned. Capture another screenshot and try again.")
          return
        }
        setFailure(null)

        const solutionData = {
          code: data.solution.code,
          thoughts: data.solution.thoughts,
          time_complexity: data.solution.time_complexity,
          space_complexity: data.solution.space_complexity,
        }

        queryClient.setQueryData(["solution"], solutionData)
        setSolutionData(solutionData.code || null)
        setThoughtsData(solutionData.thoughts || null)
        setTimeComplexityData(solutionData.time_complexity || null)
        setSpaceComplexityData(solutionData.space_complexity || null)
      }),

      //########################################################
      //DEBUG EVENTS
      //########################################################
      window.electronAPI.onDebugStart(() => {
        setFailure(null)
        setDebugProcessing(true)
      }),
      //the first time debugging works, we'll set the view to debug and populate the cache with the data
      window.electronAPI.onDebugSuccess((data) => {
        setDebugProcessing(false)
        if (!data?.solution) {
          setFailure("No debug result was returned. Try debugging again.")
          return
        }
        setFailure(null)
        queryClient.setQueryData(["new_solution"], data.solution)
        setHasDebugResult(true)
      }),
      //when there was an error in the initial debugging, we'll show a toast and stop the little generating pulsing thing.
      window.electronAPI.onDebugError(() => {
        setFailure("Debugging failed. Your previous result is unchanged. Try debugging again.")
        setDebugProcessing(false)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        setFailure("There are no screenshots to process. Capture a screenshot and try again.")
        setSolutionPending(false)
        setIsStreamingAnalysis(false)
        setDebugProcessing(false)
      }),
    ]

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [])

  useEffect(() => {
    setProblemStatementData(queryClient.getQueryData(["problem_statement"]) || null)
    const cached = queryClient.getQueryData<{
      code: string; thoughts: string[]; time_complexity: string; space_complexity: string
    }>(["solution"])
    setSolutionData(cached?.code ?? null)
    setThoughtsData(cached?.thoughts ?? null)
    setTimeComplexityData(cached?.time_complexity ?? null)
    setSpaceComplexityData(cached?.space_complexity ?? null)

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.query.queryKey[0] === "problem_statement") {
        const problem = queryClient.getQueryData<ProblemStatementData & { isStreaming?: boolean }>(["problem_statement"])
        setProblemStatementData(problem || null)
        if (typeof problem?.isStreaming === "boolean") {
          setIsStreamingAnalysis(problem.isStreaming)
          setSolutionPending(problem.isStreaming)
        }
      }
      if (event?.query.queryKey[0] === "solution") {
        const solution = queryClient.getQueryData(["solution"]) as {
          code: string
          thoughts: string[]
          time_complexity: string
          space_complexity: string
        } | null

        setSolutionData(solution?.code ?? null)
        setThoughtsData(solution?.thoughts ?? null)
        setTimeComplexityData(solution?.time_complexity ?? null)
        setSpaceComplexityData(solution?.space_complexity ?? null)
      }
    })
    return () => unsubscribe()
  }, [queryClient])

  return (
    <>
      {hasDebugResult ? (
        <>
          <Debug isProcessing={debugProcessing} setIsProcessing={setDebugProcessing} />
        </>
      ) : (
        <div className="relative space-y-3 px-4 py-3" data-overlay-interactive>
          {failure && (
            <div role="alert" className="inline-failure">
              <p>{failure}</p>
              <button type="button" className="mt-2 underline" onClick={() => setView("queue")}>Return to queue</button>
            </div>
          )}
          {screenshotsError && (
            <div role="alert" className="inline-failure">
              <p>Could not load screenshots. Your saved results are still available.</p>
              <button type="button" className="mt-2 underline" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? "Retrying…" : "Retry loading screenshots"}
              </button>
            </div>
          )}

          {/* Conditionally render the screenshot queue if solutionData is available */}
          {solutionData && (
            <div className="bg-transparent w-fit">
              <div className="pb-3">
                <div className="space-y-3 w-fit">
                  <ScreenshotQueue
                    isLoading={debugProcessing}
                    screenshots={extraScreenshots}
                    onDeleteScreenshot={handleDeleteExtraScreenshot}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Navbar of commands with the SolutionsHelper */}
          <SolutionCommands
            extraScreenshots={extraScreenshots}
          />

          {/* Main Content - Modified width constraints */}
          <div className="w-full text-sm text-white bg-black/60 rounded-md">
            <div className="rounded-lg overflow-hidden">
              <div className="px-4 py-3 space-y-4 max-w-full">
                {/* Show Screenshot or Audio Result as main output if validation_type is manual */}
                {problemStatementData?.validation_type === "manual" ? (
                  <ContentSection
                    title={
                      problemStatementData?.output_format?.subtype === "voice"
                        ? "Audio Result"
                        : "Screenshot Analysis"
                    }
                    content={problemStatementData.problem_statement}
                    isLoading={false}
                    isStreaming={isStreamingAnalysis}
                  />
                ) : (
                  <>
                    {/* Problem Statement Section - Only for non-manual */}
                    <ContentSection
                      title={
                        problemStatementData?.output_format?.subtype === "voice"
                          ? "Voice Input"
                          : "Problem Statement"
                      }
                      content={problemStatementData?.problem_statement}
                      isLoading={solutionPending && !problemStatementData}
                    />
                    {/* Show loading state when waiting for solution */}
                    {solutionPending && problemStatementData && !solutionData && (
                      <div className="mt-4 flex">
                        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
                          {problemStatementData?.output_format?.subtype === "voice"
                            ? "Processing voice input..."
                            : "Generating solutions..."}
                        </p>
                      </div>
                    )}
                    {/* Solution Sections (legacy, only for non-manual) */}
                    {solutionData && (
                      <>
                        <ContentSection
                          title="Analysis"
                          content={
                            thoughtsData && (
                              <div className="space-y-3">
                                <div className="space-y-1">
                                  {thoughtsData.map((thought, index) => (
                                    <div key={index} className="flex items-start gap-2">
                                      <div className="w-1 h-1 rounded-full bg-blue-400/80 mt-2 shrink-0" />
                                      <div>{thought}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          }
                          isLoading={!thoughtsData}
                        />
                        <SolutionSection
                          title={
                            problemStatementData?.output_format?.subtype === "voice"
                              ? "Response"
                              : "Solution"
                          }
                          content={solutionData}
                          isLoading={!solutionData}
                        />
                        {problemStatementData?.output_format?.subtype !== "voice" && (
                          <ComplexitySection
                            timeComplexity={timeComplexityData}
                            spaceComplexity={spaceComplexityData}
                            isLoading={!timeComplexityData || !spaceComplexityData}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Solutions
