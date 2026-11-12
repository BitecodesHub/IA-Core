// Pure object helpers used by SettingsService. Kept free of any Electron import
// so they can be unit-tested in a plain Node/Vitest context.

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function safeKey(key: string): boolean {
  return !["__proto__", "constructor", "prototype"].includes(key)
}

function ownValue(object: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined
}

/** Recursively merge `patch` into a clone of `base`. Arrays/primitives overwrite. */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(patch)])) {
    if (!safeKey(key)) continue
    const pv = ownValue(patch, key)
    const bv = ownValue(base, key)
    const value = pv === undefined ? bv : pv
    out[key] = isPlainObject(value)
      ? deepMerge(isPlainObject(bv) ? bv : {}, value)
      : value
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
    if (!safeKey(key)) continue
    const childPrefix = prefix ? `${prefix}.${key}` : key
    paths.push(...diffPaths(ownValue(a, key), ownValue(b, key), childPrefix))
  }
  return paths
}
