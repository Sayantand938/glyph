import * as React from "react"
import { SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { countReviews, loadReviewRecords } from "@/db/queries"
import { saveSetting } from "@/db/repo"
import { useLiveQuery } from "@/hooks/use-live-query"
import { useSettings } from "@/hooks/use-settings"
import {
  FIT_REMINDER_STEP,
  MIN_SCORED_REVIEWS,
  buildSequences,
  countScored,
  fitReminderDue,
  optimizeWeights,
  type OptimizeResult,
  type Sequence,
} from "@/lib/fsrs"

type Phase =
  | { kind: "idle" }
  | { kind: "running"; progress: number }
  | { kind: "result"; result: OptimizeResult }
  | { kind: "error"; message: string }

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

function ResultNote({ result }: { result: OptimizeResult }) {
  if (result.status === "not-enough-data") {
    return (
      <p>
        Not enough history yet: {result.scored} of the {result.needed} reviews
        needed (reviews made a day or more after the previous one). Keep
        studying and try again.
      </p>
    )
  }
  const { before, after } = result
  if (!result.improved) {
    return (
      <p>
        Nothing changed. The best fit to your {result.scored} reviews was not
        clearly better than your current parameters on reviews it hadn&apos;t
        seen (error {before.logLoss.toFixed(3)} now, {after.logLoss.toFixed(3)}{" "}
        for the fit).
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p>
        Done. Fitted to {result.scored} reviews of {result.cards} questions and
        applied from your next review.
      </p>
      <p className="text-muted-foreground">
        On reviews held out from the fit: prediction error{" "}
        {before.logLoss.toFixed(3)} &rarr; {after.logLoss.toFixed(3)}, and the
        predicted-vs-actual gap {pct(before.rmse)} &rarr; {pct(after.rmse)}.
      </p>
    </div>
  )
}

/**
 * Settings block that fits the scheduler's FSRS weights to the user's own
 * review history, off the main thread's critical path (the optimizer yields to
 * the page as it works). The new weights are kept only if they predict held-out
 * reviews better than the current ones.
 */
export function FsrsOptimizer() {
  const { fit } = useSettings()
  const weights = fit.weights
  const totalReviews = useLiveQuery(() => countReviews(), [], ["revlog"])
  const refitDue =
    totalReviews !== undefined &&
    fitReminderDue({ reviews: totalReviews, lastFitReviews: fit.reviews })
  const [sequences, setSequences] = React.useState<Sequence[] | null>(null)
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" })
  const controller = React.useRef<AbortController | null>(null)

  const load = React.useCallback(async () => {
    const records = await loadReviewRecords()
    setSequences(buildSequences(records))
  }, [])

  React.useEffect(() => {
    let cancelled = false
    loadReviewRecords()
      .then((records) => {
        if (!cancelled) setSequences(buildSequences(records))
      })
      .catch(() => {
        if (!cancelled) setSequences([])
      })
    return () => {
      cancelled = true
      controller.current?.abort()
    }
  }, [])

  const scored = React.useMemo(
    () => (sequences ? countScored(sequences) : null),
    [sequences]
  )
  const running = phase.kind === "running"
  const personalized = weights !== null

  async function run() {
    const abort = new AbortController()
    controller.current = abort
    setPhase({ kind: "running", progress: 0 })
    try {
      // Re-read the log so reviews made since this page opened are included.
      const records = await loadReviewRecords()
      const fresh = buildSequences(records)
      setSequences(fresh)
      const result = await optimizeWeights(fresh, {
        baseline: weights ?? undefined,
        signal: abort.signal,
        onProgress: (progress) => setPhase({ kind: "running", progress }),
      })
      if (result.status === "done") {
        // Saved even when nothing improved: the count is where the "time to
        // refit" reminder (here or on a synced device) counts from.
        await saveSetting("fit", {
          weights: result.improved ? result.weights : weights,
          reviews: records.length,
        })
      }
      setPhase({ kind: "result", result })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setPhase({ kind: "idle" })
      } else {
        setPhase({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Optimization failed.",
        })
      }
    } finally {
      controller.current = null
      void load()
    }
  }

  return (
    <div className="space-y-3 border-t pt-4 sm:max-w-md">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Personalized parameters</h3>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {personalized ? "Fitted to you" : "Defaults"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Fits the memory model to your own answers, so intervals match how fast
          you actually forget. It counts a correct answer as remembered or
          guessed (one in four), which a flashcard app doesn&apos;t have to. You
          can run it yourself at any time.
        </p>
        {refitDue && (
          <p
            role="status"
            className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs"
          >
            Time to refit: you have made{" "}
            {(totalReviews - fit.reviews).toLocaleString()} reviews since the
            last fit. Press Optimize to keep the intervals matched to how you
            forget.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {scored === null
            ? "Counting your reviews..."
            : `${scored} usable reviews (${MIN_SCORED_REVIEWS} needed; more is better).`}
        </p>
        {!refitDue && (
          <p className="text-xs text-muted-foreground">
            It never runs by itself. A reminder shows here once{" "}
            {FIT_REMINDER_STEP.toLocaleString()} reviews have been made since
            the last fit.
          </p>
        )}
      </div>

      {running && (
        <div
          role="progressbar"
          aria-label="Optimizing"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(phase.progress * 100)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round(phase.progress * 100)}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => controller.current?.abort()}
          >
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={scored === null}
            onClick={() => void run()}
          >
            <SparklesIcon aria-hidden />
            Optimize
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!personalized || running}
          onClick={() => {
            setPhase({ kind: "idle" })
            void countReviews()
              .then((reviews) => saveSetting("fit", { weights: null, reviews }))
              .catch(() => undefined)
          }}
        >
          Reset to defaults
        </Button>
      </div>

      {phase.kind === "result" && (
        <div
          role="status"
          className="rounded-lg border bg-muted/40 p-3 text-xs"
        >
          <ResultNote result={phase.result} />
        </div>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {phase.message}
        </p>
      )}
    </div>
  )
}
