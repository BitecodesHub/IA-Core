import { ToastProvider } from "./components/ui/toast"
import Queue from "./_pages/Queue"
import { ToastViewport } from "@radix-ui/react-toast"
import { useEffect, useRef, useState } from "react"
import Solutions from "./_pages/Solutions"
import { QueryClient, QueryClientProvider } from "react-query"
import ErrorBoundary from "./components/ErrorBoundary"
import type { GeneralSettings } from "./types/settings"
// window.electronAPI is typed canonically in src/types/electron.d.ts

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Screenshots/solutions can change on disk and via IPC; keep data fresh
      // for a short window rather than caching forever.
      staleTime: 5_000,
      cacheTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

const App: React.FC = () => {
  const [view, setView] = useState<"queue" | "solutions" | "debug">("queue")
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const applyTheme = (theme: GeneralSettings["theme"]) => {
      const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
      document.documentElement.dataset.themePreference = theme
      document.documentElement.dataset.theme =
        theme === "system" ? (systemDark ? "dark" : "light") : theme
    }

    let currentTheme: GeneralSettings["theme"] = "dark"
    window.electronAPI.getSettings().then((settings) => {
      currentTheme = settings.general.theme
      applyTheme(currentTheme)
    })
    const off = window.electronAPI.onSettingsChanged((settings) => {
      currentTheme = settings.general.theme
      applyTheme(currentTheme)
    })
    const media = window.matchMedia?.("(prefers-color-scheme: dark)")
    const onSystemTheme = () => {
      if (currentTheme === "system") applyTheme("system")
    }
    media?.addEventListener?.("change", onSystemTheme)
    return () => {
      off()
      media?.removeEventListener?.("change", onSystemTheme)
    }
  }, [])

  // Effect for height monitoring. A ResizeObserver already reports every size
  // change (including content growth during streaming), so a MutationObserver
  // watching characterData/attributes is redundant — and it fired a window
  // resize IPC on every streamed token. Coalesce updates to one per animation
  // frame so a burst of size changes triggers at most one IPC resize.
  useEffect(() => {
    if (!containerRef.current) return

    let rafId: number | null = null
    const updateHeight = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!containerRef.current) return
        window.electronAPI?.updateContentDimensions({
          width: containerRef.current.scrollWidth,
          height: containerRef.current.scrollHeight,
        })
      })
    }

    const resizeObserver = new ResizeObserver(updateHeight)
    updateHeight()
    resizeObserver.observe(containerRef.current)

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [view]) // Re-run when view changes

  // Click-through control. The overlay window ignores mouse events by default
  // (clicks pass through its transparent areas to the app behind). While the
  // cursor is over actual UI — any element tagged data-overlay-interactive — we
  // re-enable capture so buttons/inputs work. Without this, the large transparent
  // window swallows every click inside its bounds.
  useEffect(() => {
    if (!window.electronAPI?.setMouseIgnore) return
    let ignoring = true
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const interactive = !!el && !!el.closest("[data-overlay-interactive]")
      if (interactive === !ignoring) return // no change
      ignoring = !interactive
      window.electronAPI.setMouseIgnore(ignoring)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [])

  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        setView("solutions")
        console.log("starting processing")
      }),

      window.electronAPI.onUnauthorized(() => {
        queryClient.removeQueries(["screenshots"])
        queryClient.removeQueries(["solution"])
        queryClient.removeQueries(["problem_statement"])
        setView("queue")
        console.log("Unauthorized")
      }),
      // Update this reset handler
      window.electronAPI.onResetView(() => {
        console.log("Received 'reset-view' message from main process")

        queryClient.removeQueries(["screenshots"])
        queryClient.removeQueries(["solution"])
        queryClient.removeQueries(["problem_statement"])
        setView("queue")
        console.log("View reset to 'queue' via Command+R shortcut")
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        // The write is idempotent; the previous `view === "queue"` guard read a
        // stale closure value (this effect is registered once) so it could never
        // reliably gate. Removed to avoid implying a condition it cannot enforce.
        queryClient.invalidateQueries(["problem_statement"])
        queryClient.setQueryData(["problem_statement"], data)
      }),
    ]
    return () => cleanupFunctions.forEach((cleanup) => cleanup())
  }, [])

  return (
    <ErrorBoundary>
      <div ref={containerRef} className="min-h-0 text-white">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            {view === "queue" ? (
              <Queue setView={setView} />
            ) : view === "solutions" ? (
              <Solutions setView={setView} />
            ) : (
              <></>
            )}
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    </ErrorBoundary>
  )
}

export default App
