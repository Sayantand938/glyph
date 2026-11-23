import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import {
  loadStudyCard,
  loadStudyCards,
  type StudyCardView,
} from "@/db/queries"
import { applyReview, undoReview } from "@/db/repo"
import { Rating, previewIntervals, type Grade } from "@/db/scheduler"
import { useStoredState } from "@/hooks/use-stored-state"
import type { OptionIndex } from "@/lib/answer"
import { buildQueue } from "@/lib/queue"
import {
  optionOrder,
  requeueAgain,
  requeueGap,
  summarizeSession,
} from "@/lib/session"

import type { StudyScope } from "../deck-tree"
import { currentTime, dropFocus, errorText, parseBool } from "./helpers"
import type { Run, UndoEntry } from "./types"

/**
 * State and actions of one study session: builds the queue, follows the
 * current card live, saves answers, and supports undo. Rendering and keyboard
 * handling live elsewhere.
 */
export function useStudyRun(scope: StudyScope) {
  const [seed] = React.useState(() => crypto.randomUUID())
  const [run, setRun] = React.useState<Run | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [shuffle, setShuffle] = useStoredState(
    "glyph.shuffleOptions",
    true,
    parseBool
  )
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
  }, [scope, seed])

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
  const summary = summarizeSession(run?.history ?? [])

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
      const failed = rating === Rating.Again
      const gap = requeueGap(seed, view.card.cardId, current.index)
      const entry: UndoEntry = {
        cardId: view.card.cardId,
        correct: !failed,
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
            queue: failed ? requeueAgain(r.queue, r.index, gap) : r.queue,
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

  /** The old rows no longer describe this card after a reset, so its entries can't be undone. */
  function disableUndoFor(noteId: string) {
    setRun(
      (r) =>
        r && {
          ...r,
          history: r.history.map((h) =>
            h.cardId === noteId ? { ...h, undoable: false } : h
          ),
        }
    )
  }

  return {
    run,
    loadError,
    message,
    shuffle,
    setShuffle,
    data,
    gone,
    order,
    intervals,
    finished,
    empty,
    canUndo,
    summary,
    pick,
    gradeRight,
    next,
    skipGone,
    undo,
    disableUndoFor,
  }
}
