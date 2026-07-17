import { useQuery } from "react-query"
import {
  QUERY_STALE_TIME,
  QUERY_CACHE_TIME,
  QUERY_RETRY_COUNT,
  QUERY_RETRY_DELAY,
} from "../config/environment"

export function useScreenshots() {
  const {
    data: screenshots = [],
    refetch,
    error,
  } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        return await window.electronAPI.getScreenshots()
      } catch {
        return []
      }
    },
    {
      staleTime: QUERY_STALE_TIME,
      cacheTime: QUERY_CACHE_TIME,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: QUERY_RETRY_COUNT,
      retryDelay: QUERY_RETRY_DELAY,
    }
  )

  const deleteScreenshot = async (index: number): Promise<boolean> => {
    const target = screenshots[index]
    if (!target) return false
    try {
      const res = await window.electronAPI.deleteScreenshot(target.path)
      if (res.success) {
        refetch()
        return true
      }
    } catch {}
    return false
  }

  return { screenshots, refetch, error, deleteScreenshot }
}
