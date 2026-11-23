/**
 * When to refit the FSRS weights by itself. Pure (no DB, no React).
 *
 * A fit is attempted once the log holds `MIN_SCORED_REVIEWS` reviews, then again
 * after `autoFitStep` more reviews: at least `AUTO_FIT_STEP`, and 10% of the log
 * as it was at the last attempt. Early on the weights are far from the learner's
 * and each refit pays off, so it runs often; later almost none is adopted, so
 * the wait grows with the log (a two-year simulation on 1000 cards adopted 4-11
 * of about 110 attempts at a flat step, nearly all in the first months). The attempt is recorded
 * even when the optimizer finds nothing better (or the history is still too
 * thin), so it is not rerun on every launch. Nothing here limits how many
 * reviews, learning or new cards you study.
 */
import { MIN_SCORED_REVIEWS } from "./optimize"

/** Fewest reviews to wait after the last attempt before the next one. */
export const AUTO_FIT_STEP = 200
/** Share of the log (as of the last attempt) to wait for, once that exceeds the step. */
export const AUTO_FIT_GROWTH = 0.1

/** Reviews to wait after an attempt made with `lastFitReviews` in the log. */
export function autoFitStep(lastFitReviews: number): number {
  return Math.max(
    AUTO_FIT_STEP,
    Math.ceil(Math.max(0, lastFitReviews) * AUTO_FIT_GROWTH)
  )
}

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
    reviews - lastFitReviews >= autoFitStep(lastFitReviews)
  )
}
