import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { db } from "@/db/database"
import { loadReviewRecords } from "@/db/queries"
import { saveSetting } from "@/db/repo"
import { buildSequences, optimizeWeights, shouldAutoFit } from "@/lib/fsrs"

import { useSettings } from "./use-settings"

/** How long the review count must hold still before a fit starts. */
const QUIET_MS = 15_000

/**
 * Refits the FSRS weights in the background as reviews pile up (see
 * `shouldAutoFit`), so no device drifts from the data. Mount it once, high in
 * the tree. `paused` holds it off during a study session so it never competes
 * with answering.
 *
 * It waits for `QUIET_MS` without a new review before starting, so a burst of
 * writes (a backup restore, a sync, an import) does not start it and restart it
 * after every batch, each time reading the whole log.
 *
 * The result is saved as the synced `fit` setting together with the review
 * count it was fitted at, so after a sync the other device sees the fit is
 * current and does not repeat it. An attempt that finds nothing better still
 * records the count. Errors are swallowed: it retries after the next step.
 */
export function useAutoFit(paused: boolean): void {
  const { autoFit, fit, loaded } = useSettings()
  const reviews = useLiveQuery(() => db.revlog.count(), [])
  const baseline = fit.weights
  const lastFitReviews = fit.reviews

  React.useEffect(() => {
    if (paused || !loaded || reviews === undefined) return
    if (!shouldAutoFit({ enabled: autoFit, reviews, lastFitReviews })) return

    // Leaving the effect (a new review, a synced fit, a session starting)
    // cancels the run; the next pass starts again if it is still due.
    const abort = new AbortController()
    const timer = setTimeout(() => void run(), QUIET_MS)
    const run = async () => {
      try {
        const records = await loadReviewRecords()
        const result = await optimizeWeights(buildSequences(records), {
          baseline: baseline ?? undefined,
          signal: abort.signal,
        })
        const weights =
          result.status === "done" && result.improved
            ? result.weights
            : baseline
        await saveSetting("fit", { weights, reviews })
      } catch {
        // Aborted or failed: nothing is saved, so it is tried again later.
      }
    }
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [paused, loaded, reviews, autoFit, lastFitReviews, baseline])
}
