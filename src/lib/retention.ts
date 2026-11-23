/**
 * The desired-retention setting: its range, default and parsing. Pure (no DB,
 * no React, no ts-fsrs), so the synced settings can validate it.
 */

/** Target probability of recalling a card on the day it is due. */
export const DEFAULT_RETENTION = 0.85
export const MIN_RETENTION = 0.7
export const MAX_RETENTION = 0.97

/** Clamps to the supported range and rounds to a whole percent. */
export function clampRetention(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETENTION
  const percent = Math.round(value * 100)
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, percent / 100))
}

/** Reads a stored retention, or null if it isn't a usable number. */
export function parseRetention(stored: unknown): number | null {
  return typeof stored === "number" && Number.isFinite(stored)
    ? clampRetention(stored)
    : null
}
