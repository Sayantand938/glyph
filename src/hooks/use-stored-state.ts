import * as React from "react"

/**
 * useState persisted to localStorage under `key`. Every storage access is
 * wrapped in try/catch, so a blocked or full store just means no persistence.
 * `parse` turns the stored JSON into a value, or returns null to use `fallback`.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  parse: (stored: unknown) => T | null
): [T, (next: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const parsed = parse(JSON.parse(raw))
        if (parsed !== null) return parsed
      }
    } catch {
      // Unreadable or blocked storage: use the fallback.
    }
    return fallback
  })

  const set = React.useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Not persisted; the in-memory value still applies.
      }
    },
    [key]
  )

  return [value, set]
}
