// Debug.tsx
import React, { useState, useEffect } from "react"
import { useQuery, useQueryClient } from "react-query"
import { QUERY_STALE_TIME, QUERY_CACHE_TIME } from "../config/environment"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism"
import { ComplexitySection, ContentSection } from "../components/Solutions/ContentSection"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import ExtraScreenshotsQueueHelper from "../components/Solutions/SolutionCommands"
import { diffLines } from "diff"

type DiffLine = {
  value: string
  added?: boolean
  removed?: boolean
}

const CodeComparisonSection = ({
  oldCode,
  newCode,
  isLoading,
}: {
  oldCode: string | null
  newCode: string | null
  isLoading: boolean
}) => {
  const computeDiff = () => {
    if (!oldCode || !newCode) return { leftLines: [], rightLines: [] }

    // Normalize line endings and clean up the code
    const normalizeCode = (code: string) => {
      return code
        .replace(/\r\n/g, "\n") // Convert Windows line endings to Unix
        .replace(/\r/g, "\n") // Convert remaining carriage returns
        .trim() // Remove leading/trailing whitespace
    }

    const normalizedOldCode = normalizeCode(oldCode)
    const normalizedNewCode = normalizeCode(newCode)

    // Generate the diff
    const diff = diffLines(normalizedOldCode, normalizedNewCode, {
      newlineIsToken: true,
      ignoreWhitespace: true, // Changed to true to better handle whitespace differences
    })

    // Process the diff to create parallel arrays
    const leftLines: DiffLine[] = []
    const rightLines: DiffLine[] = []

    diff.forEach((part) => {
      if (part.added) {
        // Add empty lines to left side
        leftLines.push(...Array(part.count || 0).fill({ value: "" }))
        // Add new lines to right side, filter out empty lines at the end
        rightLines.push(
          ...part.value
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => ({
              value: line,
              added: true,
            }))
        )
      } else if (part.removed) {
        // Add removed lines to left side, filter out empty lines at the end
        leftLines.push(
          ...part.value
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => ({
              value: line,
              removed: true,
            }))
        )
        // Add empty lines to right side
        rightLines.push(...Array(part.count || 0).fill({ value: "" }))
      } else {
        // Add unchanged lines to both sides
        const lines = part.value.split("\n").filter((line) => line.length > 0)
        leftLines.push(...lines.map((line) => ({ value: line })))
        rightLines.push(...lines.map((line) => ({ value: line })))
      }
    })

    return { leftLines, rightLines }
  }

  const { leftLines, rightLines } = computeDiff()

  return (
    <div className="space-y-1.5">
      <h2 className="text-[13px] font-medium text-white tracking-wide">Code Comparison</h2>
      {isLoading ? (
        <div className="space-y-1">
          <div className="mt-3 flex">
            <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
              Loading code comparison...
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-row gap-0.5 bg-[#161b22] rounded-lg overflow-hidden">
          {/* Previous Code */}
          <div className="w-1/2 border-r border-gray-700">
            <div className="bg-[#2d333b] px-3 py-1.5">
              <h3 className="text-[11px] font-medium text-gray-200">Previous Version</h3>
            </div>
            <div className="p-3 overflow-x-auto">
              <SyntaxHighlighter
                language="python"
                style={dracula}
                customStyle={{
                  maxWidth: "100%",
                  margin: 0,
                  padding: "1rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
                wrapLines={true}
                showLineNumbers={true}
                lineProps={(lineNumber) => {
                  const line = leftLines[lineNumber - 1]
                  return {
                    style: {
                      display: "block",
                      backgroundColor: line?.removed ? "rgba(139, 0, 0, 0.2)" : "transparent",
                    },
                  }
                }}
              >
                {leftLines.map((line) => line.value).join("\n")}
              </SyntaxHighlighter>
            </div>
          </div>

          {/* New Code */}
          <div className="w-1/2">
            <div className="bg-[#2d333b] px-3 py-1.5">
              <h3 className="text-[11px] font-medium text-gray-200">New Version</h3>
            </div>
            <div className="p-3 overflow-x-auto">
              <SyntaxHighlighter
                language="python"
                style={dracula}
                customStyle={{
                  maxWidth: "100%",
                  margin: 0,
                  padding: "1rem",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
                wrapLines={true}
                showLineNumbers={true}
                lineProps={(lineNumber) => {
                  const line = rightLines[lineNumber - 1]
                  return {
                    style: {
                      display: "block",
                      backgroundColor: line?.added ? "rgba(0, 139, 0, 0.2)" : "transparent",
                    },
                  }
                }}
              >
                {rightLines.map((line) => line.value).join("\n")}
              </SyntaxHighlighter>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface DebugProps {
  isProcessing: boolean
  setIsProcessing: (isProcessing: boolean) => void
}

const Debug: React.FC<DebugProps> = ({ isProcessing, setIsProcessing }) => {
  const queryClient = useQueryClient()

  const [oldCode, setOldCode] = useState<string | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [thoughtsData, setThoughtsData] = useState<string[] | null>(null)
  const [timeComplexityData, setTimeComplexityData] = useState<string | null>(null)
  const [spaceComplexityData, setSpaceComplexityData] = useState<string | null>(null)

  const [failure, setFailure] = useState<string | null>(null)

  const { data: extraScreenshots = [], refetch, error: screenshotsError, isFetching } = useQuery({
    queryKey: ["extras"],
    queryFn: () => window.electronAPI.getScreenshots(),
    staleTime: QUERY_STALE_TIME,
    cacheTime: QUERY_CACHE_TIME,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  })

  const handleDeleteExtraScreenshot = async (index: number) => {
    const screenshotToDelete = extraScreenshots[index]
    if (!screenshotToDelete) return
    setFailure(null)
    try {
      const response = await window.electronAPI.deleteScreenshot(screenshotToDelete.path)

      if (response.success) {
        refetch()
      } else {
        setFailure("Could not delete the screenshot. Try deleting it again.")
      }
    } catch (error) {
      setFailure("Could not delete the screenshot. Try deleting it again.")
      console.error("Error deleting extra screenshot:", error)
    }
  }

  useEffect(() => {
    // Try to get the new solution data from cache first
    const newSolution = queryClient.getQueryData(["new_solution"]) as {
      old_code: string
      new_code: string
      thoughts: string[]
      time_complexity: string
      space_complexity: string
    } | null

    // If we have cached data, set all state variables to the cached data
    if (newSolution) {
      setOldCode(newSolution.old_code || null)
      setNewCode(newSolution.new_code || null)
      setThoughtsData(newSolution.thoughts || null)
      setTimeComplexityData(newSolution.time_complexity || null)
      setSpaceComplexityData(newSolution.space_complexity || null)
      setIsProcessing(false)
    }

    // Set up event listeners
    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => {
        setFailure(null)
        setIsProcessing(false)
        refetch()
      }),
      window.electronAPI.onDebugSuccess((data) => {
        setIsProcessing(false)
        if (!data?.solution) {
          setFailure("No debug result was returned. Try again.")
          return
        }
        setFailure(null)
        setOldCode(data.solution.old_code || null)
        setNewCode(data.solution.new_code || null)
        setThoughtsData(data.solution.thoughts || null)
        setTimeComplexityData(data.solution.time_complexity || null)
        setSpaceComplexityData(data.solution.space_complexity || null)
      }),
      window.electronAPI.onDebugStart(() => {
        setFailure(null)
        setIsProcessing(true)
      }),
      window.electronAPI.onDebugError((error: string) => {
        setFailure(error || "There was an error debugging your code. Try again.")
        setIsProcessing(false)
        console.error("Processing error:", error)
      }),
    ]

    // App owns content sizing; the command bar has no tooltip reservation.
    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [queryClient])

  return (
    <div className="relative space-y-3 px-4 py-3" data-overlay-interactive>
      {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
      {Boolean(screenshotsError) && (
        <div role="alert" className="text-sm text-red-300">
          Could not load screenshots.
          <button disabled={isFetching} onClick={() => void refetch()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Conditionally render the screenshot queue */}
      <div className="bg-transparent w-fit">
        <div className="pb-3">
          <div className="space-y-3 w-fit">
            <ScreenshotQueue
              screenshots={extraScreenshots}
              onDeleteScreenshot={handleDeleteExtraScreenshot}
              isLoading={isProcessing}
            />
          </div>
        </div>
      </div>

      {/* Navbar of commands with the tooltip */}
      <ExtraScreenshotsQueueHelper
        extraScreenshots={extraScreenshots}
      />

      {/* Main Content */}
      <div className="w-full text-sm text-white bg-black/60 rounded-md">
        <div className="rounded-lg overflow-hidden">
          <div className="px-4 py-3 space-y-4">
            {/* Thoughts Section */}
            <ContentSection
              title="What I Changed"
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
              isLoading={isProcessing && !failure && !thoughtsData}
            />

            {/* Code Comparison Section */}
            <CodeComparisonSection
              oldCode={oldCode}
              newCode={newCode}
              isLoading={isProcessing && !failure && (!oldCode || !newCode)}
            />

            {/* Complexity Section */}
            <ComplexitySection
              timeComplexity={timeComplexityData}
              spaceComplexity={spaceComplexityData}
              isLoading={isProcessing && !failure && (!timeComplexityData || !spaceComplexityData)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Debug
