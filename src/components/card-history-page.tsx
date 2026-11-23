import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { useLiveQuery } from "@/hooks/use-live-query"
import { loadCardHistory } from "@/db/queries"
import { formatInterval } from "@/db/scheduler"
import { LoadingBlock } from "@/components/ui/spinner"
import type { Note, RevlogRow } from "@/db/types"
import { previewText, stateLabel } from "@/lib/browse"
import { summarizeHistory } from "@/lib/card-history"
import { formatDuration } from "@/lib/session"

const DAY_MS = 24 * 60 * 60 * 1000
const PREVIEW_CHARS = 140

function clip(text: string): string {
  return text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}...`
    : text
}

function formatDate(time: number | null): string {
  if (time === null || time <= 0) return "-"
  return new Date(time).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function seconds(ms: number | null): string {
  return ms === null ? "-" : formatDuration(ms)
}

/** How the review went, in words: the pick, and the rating when it differs. */
function resultLabel(entry: RevlogRow): string {
  if (!entry.correct) return "Wrong"
  return entry.rating === 1 ? "Right, marked Fail" : "Right"
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * The review history of one question: a summary (how often it was answered
 * right, how long it takes, first and last study, next due, stability) and a
 * line per review. Read-only; follows the database live.
 */
export function CardHistoryPage({
  note,
  onClose,
}: {
  note: Note
  onClose: () => void
}) {
  const view = useLiveQuery(
    () => loadCardHistory(note.id),
    [note.id],
    ["cards", "revlog"]
  )
  const history = view ? summarizeHistory(view.logs) : null
  const card = view?.card ?? null
  const studied = card !== null && card.reps > 0

  return (
    <PageShell
      title="Review history"
      onBack={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <blockquote className="rounded-lg border p-3 text-sm">
        {clip(previewText(note.question))}
      </blockquote>

      {!history || !card ? (
        view ? (
          <p className="text-sm text-muted-foreground">
            This question has no card yet.
          </p>
        ) : (
          <LoadingBlock label="Loading history" />
        )
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Reviews" value={String(history.reviews)} />
            <Stat
              label="Answered correctly"
              value={
                history.correctRate === null
                  ? "-"
                  : `${history.correct} of ${history.reviews} (${Math.round(history.correctRate * 100)}%)`
              }
            />
            <Stat
              label="Average time to answer"
              value={seconds(history.avgAnswerMs)}
            />
            <Stat
              label="Average when correct"
              value={seconds(history.avgCorrectAnswerMs)}
            />
            <Stat label="First studied" value={formatDate(history.firstAt)} />
            <Stat label="Last studied" value={formatDate(history.lastAt)} />
            <Stat
              label="Next due"
              value={card.state === 0 ? "New" : formatDate(card.due)}
            />
            <Stat
              label="Stability"
              value={studied ? formatInterval(card.stability * DAY_MS) : "-"}
            />
            <Stat
              label="Difficulty"
              value={studied ? `${card.difficulty.toFixed(1)} / 10` : "-"}
            />
            <Stat label="Times forgotten" value={String(card.lapses)} />
            <Stat label="Status" value={stateLabel(card.state)} />
            <Stat label="Total time" value={seconds(history.totalMs)} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Times are minutes:seconds. Stability is how long the card is
            expected to be remembered; the longer, the better known.
            {history.guessed > 0 &&
              ` ${history.guessed} right ${history.guessed === 1 ? "pick was" : "picks were"} marked Fail (a guess).`}
          </p>

          {history.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not studied yet. Each review will be listed here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                    <th className="px-2 py-2 text-right font-medium">Time</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Next in
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-b-0">
                      <td className="px-2 py-2 whitespace-nowrap">
                        {formatDate(entry.reviewedAt)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {resultLabel(entry)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {seconds(entry.answerMs)}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                        {formatInterval(entry.dueAfter - entry.reviewedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
