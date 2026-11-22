import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowLeftIcon,
  KeyboardIcon,
  PencilIcon,
  ShuffleIcon,
  Undo2Icon,
} from "lucide-react"

import { EditNoteModal } from "@/components/edit-note-modal"
import { OptionButton, type OptionStatus } from "@/components/option-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { loadStudyCard, loadStudyCards, type StudyCardView } from "@/db/queries"
import { applyReview, undoReview } from "@/db/repo"
import { Rating, previewIntervals, type Grade } from "@/db/scheduler"
import type { CardRow } from "@/db/types"
import { useStoredState } from "@/hooks/use-stored-state"
import type { OptionIndex } from "@/lib/answer"
import { buildQueue } from "@/lib/queue"
import {
  formatDuration,
  optionOrder,
  requeueAgain,
  requeueGap,
  summarizeSession,
  type SessionRecord,
} from "@/lib/session"

import type { StudyScope } from "./deck-tree"

const LABELS = ["A", "B", "C", "D"] as const

const currentTime = (): number => Date.now()

type Phase =
  | { kind: "question" }
  /** Picked a wrong option; the Again review is already saved. */
  | { kind: "wrong"; picked: OptionIndex }
  /** Picked the right option; waiting for Hard/Good/Easy. Nothing saved yet. */
  | { kind: "right"; picked: OptionIndex; pickedAt: number }

/** A saved review plus what is needed to take it back. */
interface UndoEntry extends SessionRecord {
  logId: string
  previousRow: CardRow
  /** Queue and position from before the answer (so any re-queued copy goes too). */
  queue: string[]
  index: number
  /** False once the card's progress was reset by an edit. */
  undoable: boolean
}

interface Run {
  queue: string[]
  index: number
  phase: Phase
  history: UndoEntry[]
}

function parseBool(stored: unknown): boolean | null {
  return typeof stored === "boolean" ? stored : null
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  )
}

function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.tagName === "A")
  )
}

function dropFocus() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

export function StudySession({
  scope,
  newLimit,
  onExit,
}: {
  scope: StudyScope
  /** New cards still allowed today. */
  newLimit: number
  onExit: () => void
}) {
  const [seed] = React.useState(() => crypto.randomUUID())
  const [run, setRun] = React.useState<Run | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [shuffle, setShuffle] = useStoredState(
    "glyph.shuffleOptions",
    true,
    parseBool
  )
  const [editing, setEditing] = React.useState(false)
  const [confirmExit, setConfirmExit] = React.useState(false)
  const busy = React.useRef(false)
  const shownAt = React.useRef(0)

  // Build the queue once, at session start.
  React.useEffect(() => {
    let cancelled = false
    loadStudyCards(scope)
      .then((cards) => {
        if (cancelled) return
        const queue = buildQueue({
          cards,
          now: currentTime(),
          newLimit,
          seed,
          mixed: scope.kind === "subject",
        })
        shownAt.current = currentTime()
        setRun({ queue, index: 0, phase: { kind: "question" }, history: [] })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorText(error, "Couldn't load cards."))
      })
    return () => {
      cancelled = true
    }
  }, [scope, newLimit, seed])

  const cardId =
    run && run.index < run.queue.length ? run.queue[run.index] : null

  // The card and note are re-read live, so edits show up immediately. The id
  // travels with the result so a stale result for another card is never shown.
  const loaded = useLiveQuery(
    async () => ({
      id: cardId,
      view: cardId ? await loadStudyCard(cardId) : null,
    }),
    [cardId]
  )
  const ready = loaded && loaded.id === cardId ? loaded : null
  const data: StudyCardView | null = ready?.view ?? null

  // A card whose note was deleted meanwhile (e.g. by a backup import) is
  // offered as "unavailable" and can be skipped.
  const gone = ready !== null && cardId !== null && ready.view === null

  // Keyed on the queue position only (never the note text), so it is fixed for
  // one card view and survives reveal and edits.
  const position = run?.index ?? 0
  const order = React.useMemo(
    () => (cardId ? optionOrder(seed, cardId, position, shuffle) : []),
    [seed, cardId, position, shuffle]
  )

  const phase = run?.phase
  const rightPickedAt = phase?.kind === "right" ? phase.pickedAt : null
  const intervals = React.useMemo(
    () =>
      data && rightPickedAt !== null
        ? previewIntervals(data.card, rightPickedAt)
        : null,
    [data, rightPickedAt]
  )

  const finished = run !== null && run.queue.length > 0 && cardId === null
  const empty = run !== null && run.queue.length === 0
  const lastEntry = run?.history.at(-1)
  const canUndo = !!lastEntry && lastEntry.undoable

  function requestExit() {
    if (!run || empty || finished) onExit()
    else setConfirmExit(true)
  }

  function pick(slot: number) {
    if (!run || !data || busy.current || run.phase.kind !== "question") return
    const picked = order[slot]
    if (picked === undefined) return
    setMessage(null)
    dropFocus()

    if (picked === data.note.correctIndex) {
      setRun({
        ...run,
        phase: { kind: "right", picked, pickedAt: currentTime() },
      })
      return
    }
    void recordWrong(run, data, picked)
  }

  async function recordWrong(
    current: Run,
    view: StudyCardView,
    picked: OptionIndex
  ) {
    busy.current = true
    try {
      const durationMs = currentTime() - shownAt.current
      const { log } = await applyReview(view.card, Rating.Again, durationMs)
      const gap = requeueGap(seed, view.card.cardId, current.index)
      const entry: UndoEntry = {
        cardId: view.card.cardId,
        correct: false,
        durationMs,
        logId: log.id,
        previousRow: view.card,
        queue: current.queue,
        index: current.index,
        undoable: true,
      }
      setRun(
        (r) =>
          r && {
            ...r,
            queue: requeueAgain(r.queue, r.index, gap),
            phase: { kind: "wrong", picked },
            history: [...r.history, entry],
          }
      )
    } catch (error) {
      setMessage(errorText(error, "Couldn't save that answer."))
    } finally {
      busy.current = false
    }
  }

  async function gradeRight(rating: Grade) {
    if (!run || !data || busy.current || run.phase.kind !== "right") return
    const current = run
    const view = data
    busy.current = true
    setMessage(null)
    try {
      const durationMs = currentTime() - shownAt.current
      const { log } = await applyReview(view.card, rating, durationMs)
      const entry: UndoEntry = {
        cardId: view.card.cardId,
        correct: true,
        durationMs,
        logId: log.id,
        previousRow: view.card,
        queue: current.queue,
        index: current.index,
        undoable: true,
      }
      shownAt.current = currentTime()
      setRun(
        (r) =>
          r && {
            ...r,
            index: r.index + 1,
            phase: { kind: "question" },
            history: [...r.history, entry],
          }
      )
    } catch (error) {
      setMessage(errorText(error, "Couldn't save that review."))
    } finally {
      busy.current = false
    }
  }

  function next() {
    if (!run || busy.current || run.phase.kind !== "wrong") return
    shownAt.current = currentTime()
    setRun({ ...run, index: run.index + 1, phase: { kind: "question" } })
  }

  function skipGone() {
    if (!run || !gone || busy.current) return
    shownAt.current = currentTime()
    setRun({ ...run, index: run.index + 1, phase: { kind: "question" } })
  }

  async function undo() {
    if (!run || busy.current) return
    const entry = run.history.at(-1)
    if (!entry || !entry.undoable) return
    busy.current = true
    setMessage(null)
    dropFocus()
    try {
      const restored = await undoReview(entry.logId, entry.previousRow)
      shownAt.current = currentTime()
      setRun((r) => {
        if (!r) return r
        const history = r.history.slice(0, -1)
        return restored
          ? {
              queue: entry.queue,
              index: entry.index,
              phase: { kind: "question" },
              history,
            }
          : { ...r, history }
      })
      if (!restored) setMessage("That review can't be undone any more.")
    } catch (error) {
      setMessage(errorText(error, "Couldn't undo that review."))
    } finally {
      busy.current = false
    }
  }

  // Keyboard shortcuts. The listener is registered once (capture phase, so it
  // runs before dialog handlers) and calls the latest handler.
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    if (editing || confirmExit || isTypingTarget(event.target)) return
    if (!run) return

    const key = event.key.toLowerCase()
    const confirmKey = key === " " || key === "enter"
    // A focused button handles Space/Enter itself.
    if (confirmKey && isButtonTarget(event.target)) return

    let handled = true
    if (key === "escape") requestExit()
    else if (key === "z") void undo()
    else if (empty || finished) {
      if (confirmKey) onExit()
      else handled = false
    } else if (gone) {
      if (confirmKey) skipGone()
      else handled = false
    } else if (!data) handled = false
    else if (key === "e") setEditing(true)
    else if (run.phase.kind === "question") {
      const slot = "1234".indexOf(key)
      const letter = "abcd".indexOf(key)
      if (key.length === 1 && slot >= 0) pick(slot)
      else if (key.length === 1 && letter >= 0) pick(letter)
      else handled = false
    } else if (run.phase.kind === "wrong") {
      if (confirmKey) next()
      else handled = false
    } else if (confirmKey || key === "2") void gradeRight(Rating.Good)
    else if (key === "1") void gradeRight(Rating.Hard)
    else if (key === "3") void gradeRight(Rating.Easy)
    else handled = false

    if (handled) {
      // Stop here so a dialog opened by this key doesn't see the same event
      // (an Escape that opens the exit dialog would close it again at once).
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const latestOnKey = React.useRef(onKey)
  React.useEffect(() => {
    latestOnKey.current = onKey
  })
  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => latestOnKey.current(event)
    window.addEventListener("keydown", listener, true)
    return () => window.removeEventListener("keydown", listener, true)
  }, [])

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p role="alert">{loadError}</p>
        <Button variant="outline" onClick={onExit}>
          Back
        </Button>
      </div>
    )
  }
  if (!run) {
    return (
      <p className="py-8 text-sm text-muted-foreground" role="status">
        Loading...
      </p>
    )
  }

  const summary = summarizeSession(run.history)
  const statusFor = (original: OptionIndex): OptionStatus => {
    if (!data || run.phase.kind === "question") return "idle"
    if (original === data.note.correctIndex) return "correct"
    if (original === run.phase.picked) {
      return run.phase.kind === "wrong" ? "wrong" : "picked"
    }
    return "dim"
  }
  const answered = run.phase.kind !== "question"
  const hint =
    run.phase.kind === "question"
      ? "1-4 or A-D pick, E edit, Z undo, Esc exit"
      : run.phase.kind === "wrong"
        ? "Space next, E edit, Z undo, Esc exit"
        : "Space good, 1 hard, 2 good, 3 easy, E edit, Z undo"

  return (
    <div className="flex flex-1 flex-col gap-4 py-4">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Exit session"
          title="Exit (Esc)"
          onClick={requestExit}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1 text-center text-sm tabular-nums">
          <span className="sr-only">{scope.name}: </span>
          {empty
            ? scope.name
            : `${Math.min(run.index + 1, run.queue.length)} / ${run.queue.length}`}
        </div>
        <Button
          variant={shuffle ? "secondary" : "ghost"}
          size="icon"
          aria-label="Shuffle options"
          aria-pressed={shuffle}
          title={shuffle ? "Option shuffle: on" : "Option shuffle: off"}
          onClick={(e) => {
            e.currentTarget.blur()
            setShuffle(!shuffle)
          }}
        >
          <ShuffleIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo last answer"
          title="Undo (Z)"
          disabled={!canUndo}
          onClick={() => void undo()}
        >
          <Undo2Icon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit question"
          title="Edit (E)"
          disabled={!data || finished || empty}
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </Button>
        <span
          className="flex size-8 items-center justify-center text-muted-foreground"
          title={
            "Keyboard\nQuestion: 1-4 / A-D pick, E edit, Esc exit\nAfter wrong: Space next\nAfter right: Space good, 1 hard, 2 good, 3 easy\nAny time: Z undo"
          }
        >
          <KeyboardIcon className="size-4" aria-label="Keyboard shortcuts" />
        </span>
      </div>

      {message && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {message}
        </p>
      )}

      {empty ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-lg font-semibold tracking-tight">Nothing due.</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            There are no cards to study in {scope.name} right now.
          </p>
          <Button onClick={onExit} autoFocus>
            Back to decks
          </Button>
        </div>
      ) : finished ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-lg font-semibold tracking-tight">
            Session complete.
          </p>
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
      ) : gone ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p role="status">This question is no longer available.</p>
          <Button onClick={skipGone}>Skip (Space)</Button>
        </div>
      ) : !data ? (
        <p className="py-4 text-sm text-muted-foreground" role="status">
          Loading...
        </p>
      ) : (
        <div key={run.index} className="flex flex-col gap-4">
          <p className="text-base font-medium break-words whitespace-pre-wrap">
            {data.note.question}
          </p>

          <div
            className="flex flex-col gap-2"
            role="group"
            aria-label="Options"
          >
            {order.map((original, slot) => (
              <OptionButton
                key={original}
                label={LABELS[slot]}
                text={data.note.options[original]}
                status={statusFor(original)}
                locked={answered}
                onPick={() => pick(slot)}
              />
            ))}
          </div>

          {answered && data.note.extra.trim() !== "" && (
            <div
              className="rounded-lg border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap"
              aria-live="polite"
            >
              {data.note.extra}
            </div>
          )}

          {run.phase.kind === "wrong" && (
            <Button size="lg" className="w-full" onClick={next}>
              Next Card (Space)
            </Button>
          )}

          {run.phase.kind === "right" && intervals && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="lg"
                className="h-auto flex-col gap-0 py-2"
                onClick={() => void gradeRight(Rating.Hard)}
              >
                <span>Hard</span>
                <span className="text-xs text-muted-foreground">
                  {intervals.hard} &middot; 1
                </span>
              </Button>
              <Button
                size="lg"
                className="h-auto flex-col gap-0 py-2"
                onClick={() => void gradeRight(Rating.Good)}
              >
                <span>Good</span>
                <span className="text-xs opacity-80">
                  {intervals.good} &middot; 2
                </span>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-auto flex-col gap-0 py-2"
                onClick={() => void gradeRight(Rating.Easy)}
              >
                <span>Easy</span>
                <span className="text-xs text-muted-foreground">
                  {intervals.easy} &middot; 3
                </span>
              </Button>
            </div>
          )}
        </div>
      )}

      {!empty && !finished && (
        <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      <EditNoteModal
        note={editing && data ? data.note : null}
        onClose={() => setEditing(false)}
        onSaved={(note, resetFsrs) => {
          if (!resetFsrs) return
          // The old rows no longer describe this card, so they can't be undone.
          setRun(
            (r) =>
              r && {
                ...r,
                history: r.history.map((h) =>
                  h.cardId === note.id ? { ...h, undoable: false } : h
                ),
              }
          )
        }}
      />

      <Dialog open={confirmExit} onOpenChange={setConfirmExit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this session?</DialogTitle>
            <DialogDescription>
              Every answer so far is already saved. The remaining cards will be
              waiting next time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmExit(false)}>
              Keep studying
            </Button>
            <Button
              onClick={() => {
                setConfirmExit(false)
                onExit()
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
