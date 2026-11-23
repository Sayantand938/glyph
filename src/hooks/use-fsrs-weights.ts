import { parseWeights } from "@/lib/fsrs"

import { useStoredState } from "./use-stored-state"

export const WEIGHTS_STORAGE_KEY = "glyph.fsrsWeights"

/**
 * The FSRS weights fitted to this user's reviews, or null for the defaults.
 * Persisted per device like the retention; they are derived from the review log,
 * so any device can recompute them after a backup restore.
 */
export function useFsrsWeights(): [
  number[] | null,
  (next: number[] | null) => void,
] {
  return useStoredState<number[] | null>(
    WEIGHTS_STORAGE_KEY,
    null,
    parseWeights
  )
}
