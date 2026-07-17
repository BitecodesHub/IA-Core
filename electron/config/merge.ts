// Pure object helpers used by SettingsService. Kept free of any Electron import
// so they can be unit-tested in a plain Node/Vitest context.

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Recursively merge `patch` into a clone of `base`. Arrays/primitives overwrite. */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch)) {
    const pv = patch[key]
    const bv = out[key]
    if (isPlainObject(pv) && isPlainObject(bv)) {
      out[key] = deepMerge(bv, pv)
    } else if (pv !== undefined) {
      out[key] = pv
    }
  }
  return out
}

/** Return the dotted paths whose values differ between two objects. */
export function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (a === b) return []
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix || "."]
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const paths: string[] = []
  for (const key of keys) {
    const childPrefix = prefix ? `${prefix}.${key}` : key
    paths.push(...diffPaths(a[key], b[key], childPrefix))
  }
  return paths
}
