import * as React from "react"
import {
  CheckIcon,
  ClockIcon,
  LayersIcon,
  TargetIcon,
  TimerIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  formatDuration,
  type SessionRecord,
  type SessionSummary,
} from "@/lib/session"

export function EmptyState({
  scopeName,
  onExit,
}: {
  scopeName: string
  onExit: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-lg font-semibold tracking-tight">Nothing due.</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        There are no cards to study in {scopeName} right now.
      </p>
      <Button onClick={onExit} autoFocus>
        Back to decks
      </Button>
    </div>
  )
}

const RING_RADIUS = 44
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function verdict(accuracy: number): string {
  if (accuracy >= 0.9) return "Excellent recall."
  if (accuracy >= 0.75) return "Solid work."
  if (accuracy >= 0.5) return "Getting there."
  return "Tough round. These will come back soon."
}

function AccuracyRing({ accuracy }: { accuracy: number }) {
  // Start empty, then fill on the next frame so the ring animates in.
  const [shown, setShown] = React.useState(0)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(accuracy))
    return () => cancelAnimationFrame(frame)
  }, [accuracy])

  return (
    <div
      className="relative size-36 shrink-0"
      role="img"
      aria-label={`Accuracy ${Math.round(accuracy * 100)} percent`}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="8"
          className="stroke-muted"
        />
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className="stroke-foreground transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - shown)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {Math.round(accuracy * 100)}
          <span className="text-lg text-muted-foreground">%</span>
        </span>
        <span className="text-xs text-muted-foreground">accuracy</span>
      </div>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Accuracy ring, tiles and the answer-by-answer strip of a session so far. */
export function SessionStats({
  summary,
  records,
}: {
  summary: SessionSummary
  records: readonly SessionRecord[]
}) {
  const { cards, answers, correct, accuracy, totalMs } = summary
  const missed = answers - correct
  const retries = answers - cards
  const average = answers === 0 ? 0 : totalMs / answers

  return (
    <>
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-6">
        {answers === 0 ? (
          <p className="text-sm text-muted-foreground">
            No answers were recorded.
          </p>
        ) : (
          <>
            <AccuracyRing accuracy={accuracy} />
            <p className="text-sm font-medium">{verdict(accuracy)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {correct} right, {missed} missed
            </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          icon={<LayersIcon aria-hidden />}
          label="Cards"
          value={String(cards)}
          hint={
            retries > 0
              ? `${retries} came back for another try`
              : "Each seen once"
          }
        />
        <StatTile
          icon={<TargetIcon aria-hidden />}
          label="Answers"
          value={String(answers)}
          hint={`${correct} correct`}
        />
        <StatTile
          icon={<ClockIcon aria-hidden />}
          label="Total time"
          value={formatDuration(totalMs)}
        />
        <StatTile
          icon={<TimerIcon aria-hidden />}
          label="Per answer"
          value={answers === 0 ? "-" : `${(average / 1000).toFixed(1)}s`}
          hint="Average"
        />
      </div>

      {records.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Answer by answer</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-foreground" />
                Right
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-muted-foreground/30" />
                Missed
              </span>
            </span>
          </div>
          <div
            className="flex h-8 items-stretch gap-0.5"
            role="img"
            aria-label={`${correct} right and ${missed} missed answers, in order`}
          >
            {records.map((record, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-px flex-1 rounded-[2px]",
                  record.correct ? "bg-foreground" : "bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export function FinishedState({
  summary,
  records,
  scopeName,
  onExit,
}: {
  summary: SessionSummary
  records: readonly SessionRecord[]
  scopeName: string
  onExit: () => void
}) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  // The last answer's button still has focus, and auto-focusing the button at
  // the bottom used to open the summary scrolled past its heading.
  React.useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-6 py-2">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <CheckIcon className="size-5" aria-hidden />
        </span>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight outline-none"
        >
          Session complete
        </h2>
        <p className="text-sm text-muted-foreground">{scopeName}</p>
      </div>

      <SessionStats summary={summary} records={records} />

      <Button
        className="mt-auto w-full sm:w-auto sm:self-center sm:px-10"
        onClick={onExit}
      >
        Back to decks
      </Button>
    </div>
  )
}

/** The note was deleted while this card was queued (e.g. by a backup import). */
export function GoneState({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p role="status">This question is no longer available.</p>
      <Button onClick={onSkip}>Skip (Space)</Button>
    </div>
  )
}
