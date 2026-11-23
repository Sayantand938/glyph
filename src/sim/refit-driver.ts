/**
 * Runs a simulation the way the app lives: after each simulated day the
 * refit reminder rule (`fitReminderDue`: a manual fit every 1,000 reviews) is applied, the optimizer is run on the
 * log so far with the current weights as the baseline, and a better fit is used
 * for every later review. Shared by the closed-loop and big-deck simulations.
 */
import { buildSequences, optimizeWeights } from "@/lib/fsrs"
import { fitReminderDue } from "@/lib/fsrs/auto"

import {
  simulateAdaptive,
  type Scenario,
  type SimResult,
  type WeightsRef,
} from "./simulate"

export interface RefitAttempt {
  day: number
  reviews: number
  seconds: number
  adopted: boolean
  logLossBefore: number | null
  logLossAfter: number | null
}

export interface AdaptiveRun {
  result: SimResult
  adopted: number
  /** Total optimizer time over the run, in seconds. */
  seconds: number
  attempts: RefitAttempt[]
  weights: readonly number[] | undefined
}

export async function runAdaptive(scenario: Scenario): Promise<AdaptiveRun> {
  const weights: WeightsRef = { current: undefined }
  let lastFitReviews = 0
  const attempts: RefitAttempt[] = []
  let seconds = 0
  const result = await simulateAdaptive(
    scenario,
    weights,
    async ({ day, logs }) => {
      if (!fitReminderDue({ reviews: logs.length, lastFitReviews })) return
      lastFitReviews = logs.length
      const records = logs.map(({ cardId, reviewedAt, rating, state }) => ({
        cardId,
        reviewedAt,
        rating,
        state,
      }))
      const t0 = performance.now()
      const fit = await optimizeWeights(buildSequences(records), {
        baseline: weights.current,
      })
      const took = (performance.now() - t0) / 1000
      seconds += took
      const adopted = fit.status === "done" && fit.improved
      if (fit.status === "done" && fit.improved) weights.current = fit.weights
      attempts.push({
        day,
        reviews: logs.length,
        seconds: took,
        adopted,
        logLossBefore: fit.status === "done" ? fit.before.logLoss : null,
        logLossAfter: fit.status === "done" ? fit.after.logLoss : null,
      })
    }
  )
  return {
    result,
    adopted: attempts.filter((a) => a.adopted).length,
    seconds,
    attempts,
    weights: weights.current,
  }
}
