import { Button } from "@/components/ui/button"
import { formatDuration, type summarizeSession } from "@/lib/session"

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

export function FinishedState({
  summary,
  onExit,
}: {
  summary: ReturnType<typeof summarizeSession>
  onExit: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-lg font-semibold tracking-tight">Session complete.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Cards</dt>
        <dd className="tabular-nums">{summary.cards}</dd>
        <dt className="text-muted-foreground">Answers</dt>
        <dd className="tabular-nums">{summary.answers}</dd>
        <dt className="text-muted-foreground">Accuracy</dt>
        <dd className="tabular-nums">
          {summary.answers === 0
            ? "-"
            : `${Math.round(summary.accuracy * 100)}% (${summary.correct}/${summary.answers})`}
        </dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd className="tabular-nums">{formatDuration(summary.totalMs)}</dd>
      </dl>
      <Button onClick={onExit} autoFocus>
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
