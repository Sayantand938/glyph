/**
 * When to refit the FSRS weights by itself. Pure (no DB, no React).
 *
 * A fit is attempted once the log holds `MIN_SCORED_REVIEWS` reviews, then again
 * every `AUTO_FIT_STEP` reviews after the last attempt. The attempt is recorded
 * even when the optimizer finds nothing better (or the history is still too
 * thin), so it is not rerun on every launch. Nothing here limits how many
 * reviews, learning or new cards you study.
 */
import { MIN_SCORED_REVIEWS } from "./optimize"

/** Reviews to wait after the last attempt before the next one. */
export const AUTO_FIT_STEP = 200

export function shouldAutoFit({
  enabled,
  reviews,
  lastFitReviews,
}: {
  enabled: boolean
  /** Reviews in the log now. */
  reviews: number
  /** Reviews in the log when a fit was last attempted (on any synced device). */
  lastFitReviews: number
}): boolean {
  return (
    enabled &&
    reviews >= MIN_SCORED_REVIEWS &&
    reviews - lastFitReviews >= AUTO_FIT_STEP
  )
}
