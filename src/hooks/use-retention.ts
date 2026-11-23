import { DEFAULT_RETENTION, parseRetention } from "@/db/scheduler"

import { useStoredState } from "./use-stored-state"

export const RETENTION_STORAGE_KEY = "glyph.retention"

/** The target retention (0.7 to 0.97), persisted per device like the theme. */
export function useRetention(): [number, (next: number) => void] {
  return useStoredState(
    RETENTION_STORAGE_KEY,
    DEFAULT_RETENTION,
    parseRetention
  )
}
