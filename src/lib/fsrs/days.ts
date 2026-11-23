/**
 * What "a day later" means for scheduling. ts-fsrs counts the difference
 * between UTC calendar dates, so for someone far from UTC a review at 5 pm and
 * another at 6 pm can count as a day apart. Glyph counts local calendar days
 * instead (the same boundary the queue and "bury" use), and both the scheduler
 * (db/scheduler.ts shifts the dates it hands to ts-fsrs) and the optimizer
 * (history.ts) go through this one definition, so fitted weights are applied to
 * the very quantity they were fitted on.
 */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Hour of the local day at which a new study day starts (0 = midnight). */
export const DAY_ROLLOVER_HOURS = 0

/** Milliseconds to add to a UTC timestamp to get its local wall-clock time. */
export function localOffsetMs(timestamp: number): number {
  return -new Date(timestamp).getTimezoneOffset() * 60_000
}

/**
 * The timestamp moved so that its UTC calendar date is the local study day it
 * falls in. Differences between two such timestamps, in whole UTC dates, are
 * differences in local days (and stay right across a daylight-saving change,
 * because each timestamp uses its own offset).
 */
export function toStudyClock(
  timestamp: number,
  offsetMs = localOffsetMs(timestamp)
): number {
  return timestamp + offsetMs - DAY_ROLLOVER_HOURS * HOUR
}

/** Whole study days from `previous` to `current` (never negative). */
export function elapsedStudyDays(
  previous: number,
  current: number,
  offsetOf: (timestamp: number) => number = localOffsetMs
): number {
  const a = Math.floor(toStudyClock(previous, offsetOf(previous)) / DAY)
  const b = Math.floor(toStudyClock(current, offsetOf(current)) / DAY)
  return Math.max(0, b - a)
}
