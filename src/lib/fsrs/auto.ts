/**
 * When to suggest refitting the FSRS weights. Pure (no DB, no React).
 *
 * The fit is never started by itself: the user runs it from Settings, and this
 * only says when to remind them. It is due once the log holds
 * `FIT_REMINDER_STEP` more reviews than when a fit was last attempted (the
 * count is stored with the fit, so a fit made on another synced device counts
 * too, and an attempt that finds nothing better still resets the wait). The
 * weights move slowly once a few thousand reviews are in, so a thousand is
 * plenty; reminding earlier would only nag. Nothing here limits how many
 * reviews, learning or new cards you study.
 */
import { MIN_SCORED_REVIEWS } from "./optimize"

/** Reviews to make after a fit before suggesting the next one. */
export const FIT_REMINDER_STEP = 1000

export function fitReminderDue({
  reviews,
  lastFitReviews,
}: {
  /** Reviews in the log now. */
  reviews: number
  /** Reviews in the log when a fit was last attempted (on any synced device). */
  lastFitReviews: number
}): boolean {
  return (
    reviews >= MIN_SCORED_REVIEWS &&
    reviews - lastFitReviews >= FIT_REMINDER_STEP
  )
}
