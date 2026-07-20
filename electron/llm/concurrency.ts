// Pure, dependency-free concurrency helper. Extracted so it can be unit-tested
// without the Electron runtime. Used to bound fan-out (e.g. per-model capability
// probes) so a long model list does not open dozens of simultaneous requests.

/**
 * Map `items` through async `fn` with at most `limit` in flight at once,
 * preserving input order in the returned results. A rejection from any `fn`
 * rejects the whole call (matching `Promise.all` semantics).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results
  let next = 0
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await fn(items[i], i)
      }
    })
  )
  return results
}
