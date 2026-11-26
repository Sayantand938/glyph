import * as React from "react"

import { useLiveQuery } from "@/hooks/use-live-query"
import {
  loadStudyCard,
  loadStudyQueueIds,
  type StudyCardView,
} from "@/db/queries"
import {
  applyReview,
  buryCard,
  restoreMarks,
  type LeechOutcome,
  setFlag,
  setSuspended,
  undoReview,
} from "@/db/repo"
import { Rating, previewIntervals, type Grade } from "@/db/scheduler"
import { useSettings } from "@/hooks/use-settings"
import { useStoredState } from "@/hooks/use-stored-state"
import type { OptionIndex } from "@/lib/answer"
import { marksOf, nextDayStart, toggleFlag } from "@/lib/card-marks"
import { leechNotice, leechRule } from "@/lib/leech"
import { assembleQueue } from "@/lib/queue"
import {
  dropCardFrom,
  optionOrder,
  redoApplies,
  requeueAgain,
  requeueGap,
  summarizeSession,
} from "@/lib/session"
import type { StudyOptions } from "@/lib/study-options"

import type { StudyScope } from "../deck-tree"
import { currentTime, dropFocus, errorText, parseBool } from "./helpers"
import type { MarkUndo, RedoItem, Run, UndoEntry } from "./types"

/**
 * State and actions of one study session: builds the queue, follows the
 * current card live, saves answers, and supports undo. Rendering and keyboard
 * handling live elsewhere.
 */
export function useStudyRun(scope: StudyScope, options: StudyOptions) {
  const [seed] = React.useState(() => crypto.randomUUID())
  const [run, setRun] = React.useState<Run | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  /** A plain confirmation ("Card suspended"), as opposed to `message`, an error. */
  const [notice, setNotice] = React.useState<string | null>(null)
  const [shuffle, setShuffle] = useStoredState(
    "glyph.shuffleOptions",
    true,
    parseBool
  )
  const settings = useSettings()
  const { retention } = settings
  const weights = settings.fit.weights
  const leech = leechRule(settings.leechThreshold, settings.leechAction)
  const busy = React.useRef(false)
  const shownAt = React.useRef(0)

  // Build the queue once, at session start.
  React.useEffect(() => {
    let cancelled = false
    loadStudyQueueIds(scope, currentTime(), { include: options })
      .then((ids) => {
        if (cancelled) return
        const queue = assembleQueue(
          ids,
          seed,
          // A tag, or a deck with decks inside it, mixes cards from several decks.
          scope.kind === "tag" || scope.mixed === true
        )
        shownAt.current = currentTime()
        setRun({
          queue,
          index: 0,
          phase: { kind: "question" },
          history: [],
          hidden: [],
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorText(error, "Couldn't load cards."))
      })
    return () => {
      cancelled = true
    }
  }, [scope, options, seed])

  const cardId =
    run && run.index < run.queue.length ? run.queue[run.index] : null

  // The card and note are re-read live, so edits show up immediately. The id
  // travels with the result so a stale result for another card is never shown.
  const loaded = useLiveQuery(
    async () => ({
      id: cardId,
      view: cardId ? await loadStudyCard(cardId) : null,
    }),
    [cardId],
    ["notes", "cards"]
  )
  const ready = loaded && loaded.id === cardId ? loaded : null

  // The card after this one is read ahead, so moving on shows it at once
  // instead of an empty moment while it loads. It is live too (an edit shows),
  // and used only until the current card's own read arrives.
  const nextId =
    run && run.index + 1 < run.queue.length ? run.queue[run.index + 1] : null
  const preloaded = useLiveQuery(
    async () => ({
      id: nextId,
      view: nextId ? await loadStudyCard(nextId) : null,
    }),
    [nextId],
    ["notes", "cards"]
  )
  const ahead = preloaded && preloaded.id === cardId ? preloaded : null
  const data: StudyCardView | null = ready?.view ?? ahead?.view ?? null

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
        ? previewIntervals(
            data.card,
            rightPickedAt,
            retention,
            weights ?? undefined
          )
        : null,
    [data, rightPickedAt, retention, weights]
  )

  // Deleting the last cards can leave an empty queue after some answers; that
  // is a finished session, not "nothing to study".
  const answered = (run?.history.length ?? 0) > 0
  const finished =
    run !== null && cardId === null && (run.queue.length > 0 || answered)
  const empty = run !== null && run.queue.length === 0 && !answered
  const lastEntry = run?.history.at(-1)
  // A suspend or bury is undone first, but only while no review came after it.
  const markUndo =
    run?.lastMark && run.lastMark.historyLength === run.history.length
      ? run.lastMark
      : null
  const canUndo = markUndo !== null || (!!lastEntry && lastEntry.undoable)
  const redoItem = run?.redo?.at(-1) ?? null
  const canRedo = redoApplies(
    redoItem
      ? redoItem.kind === "review"
        ? { cardId: redoItem.entry.cardId, index: redoItem.entry.index }
        : { cardId: redoItem.mark.cardId, index: redoItem.mark.index }
      : null,
    {
      cardId,
      index: run?.index ?? 0,
      waitingForAnswer: run?.phase.kind === "question" && data !== null,
    }
  )
  const summary = summarizeSession(run?.history ?? [])

  function pick(slot: number) {
    if (!run || !data || busy.current || run.phase.kind !== "question") return
    const picked = order[slot]
    if (picked === undefined) return
    setMessage(null)
    setNotice(null)
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
    picked: OptionIndex,
    keepRedo: RedoItem[] = []
  ) {
    busy.current = true
    try {
      const durationMs = currentTime() - shownAt.current
      const { log, leech: outcome } = await applyReview(
        view.card,
        Rating.Again,
        durationMs,
        retention,
        weights ?? undefined,
        undefined,
        { correct: false, answerMs: durationMs },
        leech ?? undefined
      )
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
        leech: outcome ?? undefined,
        rating: Rating.Again,
        picked,
        wrongPick: true,
        pickedAt: 0,
        answerMs: durationMs,
      }
      noteLeech(outcome)
      // A card the leech rule suspended is not asked again this session; it
      // stays on screen (its explanation) until Next.
      const suspended = outcome?.suspended === true
      setRun(
        (r) =>
          r && {
            ...r,
            queue: suspended
              ? dropCardFrom(r.queue, r.index + 1, entry.cardId)
              : requeueAgain(r.queue, r.index, gap),
            phase: { kind: "wrong", picked },
            history: [...r.history, entry],
            hidden: suspended ? [...r.hidden, entry.cardId] : r.hidden,
            redo: keepRedo,
          }
      )
    } catch (error) {
      setMessage(errorText(error, "Couldn't save that answer."))
    } finally {
      busy.current = false
    }
  }

  async function gradeRight(
    rating: Grade,
    /** A redo gives the earlier pick back instead of reading it from the screen. */
    replay?: {
      picked: OptionIndex
      pickedAt: number
      answerMs: number
      keepRedo: RedoItem[]
    }
  ) {
    if (!run || !data || busy.current) return
    const phase = run.phase
    if (!replay && phase.kind !== "right") return
    const picked = replay
      ? replay.picked
      : (phase as { picked: OptionIndex }).picked
    const pickedAt = replay
      ? replay.pickedAt
      : (phase as { pickedAt: number }).pickedAt
    const keepRedo = replay ? replay.keepRedo : []
    const current = run
    const view = data
    busy.current = true
    setMessage(null)
    setNotice(null)
    try {
      const durationMs = currentTime() - shownAt.current
      const answerMs = replay
        ? replay.answerMs
        : Math.min(durationMs, Math.max(0, pickedAt - shownAt.current))
      const { log, leech: outcome } = await applyReview(
        view.card,
        rating,
        durationMs,
        retention,
        weights ?? undefined,
        undefined,
        { correct: true, answerMs },
        leech ?? undefined
      )
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
        leech: outcome ?? undefined,
        rating,
        picked,
        wrongPick: false,
        pickedAt,
        answerMs,
      }
      shownAt.current = currentTime()
      noteLeech(outcome)
      const suspended = outcome?.suspended === true
      setRun((r) => {
        if (!r) return r
        const queue = suspended
          ? dropCardFrom(r.queue, r.index + 1, entry.cardId)
          : failed
            ? requeueAgain(r.queue, r.index, gap)
            : r.queue
        return {
          ...r,
          queue,
          index: r.index + 1,
          phase: { kind: "question" },
          history: [...r.history, entry],
          hidden: suspended ? [...r.hidden, entry.cardId] : r.hidden,
          redo: keepRedo,
        }
      })
    } catch (error) {
      setMessage(errorText(error, "Couldn't save that review."))
    } finally {
      busy.current = false
    }
  }

  /** Tells the user when a review has just made the card a leech. */
  function noteLeech(outcome: LeechOutcome | null) {
    if (outcome) {
      setNotice(leechNotice(outcome.action, outcome.lapses, outcome.taggedNote))
    }
  }

  function next() {
    if (!run || busy.current || run.phase.kind !== "wrong") return
    setNotice(null)
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
    if (markUndo) {
      await undoMark(markUndo)
      return
    }
    const entry = run.history.at(-1)
    if (!entry || !entry.undoable) return
    busy.current = true
    setMessage(null)
    setNotice(null)
    dropFocus()
    try {
      const restored = await undoReview(
        entry.logId,
        entry.previousRow,
        entry.leech
      )
      shownAt.current = currentTime()
      setRun((r) => {
        if (!r) return r
        const history = r.history.slice(0, -1)
        // Undoing the review that made a card a leech un-suspends it, so it may
        // come back; any other suspended or buried card must not.
        const hidden = entry.leech?.suspended
          ? r.hidden.filter((id) => id !== entry.cardId)
          : r.hidden
        const queue = hidden.reduce(
          (q, id) => dropCardFrom(q, entry.index, id),
          entry.queue
        )
        return restored
          ? {
              queue,
              index: entry.index,
              phase: { kind: "question" },
              history,
              hidden,
              lastMark: r.lastMark,
              redo: [...(r.redo ?? []), { kind: "review" as const, entry }],
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

  /**
   * Does again what Undo took back: the same answer (a wrong pick, or Pass/Fail
   * on a right pick), suspend or bury, on the same card.
   */
  async function redo() {
    if (!run || !data || busy.current || !canRedo || !redoItem) return
    const rest = (run.redo ?? []).slice(0, -1)
    setMessage(null)
    setNotice(null)
    dropFocus()
    if (redoItem.kind === "mark") {
      await hideCurrent(redoItem.mark.kind, rest)
      return
    }
    const entry = redoItem.entry
    if (entry.wrongPick) {
      await recordWrong(run, data, entry.picked, rest)
    } else {
      await gradeRight(entry.rating, {
        picked: entry.picked,
        pickedAt: entry.pickedAt,
        answerMs: entry.answerMs,
        keepRedo: rest,
      })
    }
  }

  /** Takes back the latest suspend or bury: the card returns where it was, in the phase it was in. */
  async function undoMark(mark: MarkUndo) {
    busy.current = true
    setMessage(null)
    setNotice(null)
    dropFocus()
    try {
      await restoreMarks(mark.cardId, mark.previous)
      shownAt.current = currentTime()
      setRun(
        (r) =>
          r && {
            queue: mark.queue,
            index: mark.index,
            phase: mark.phase,
            history: r.history,
            hidden: r.hidden.filter((id) => id !== mark.cardId),
            redo: [...(r.redo ?? []), { kind: "mark" as const, mark }],
          }
      )
    } catch (error) {
      setMessage(errorText(error, "Couldn't undo that."))
    } finally {
      busy.current = false
    }
  }

  /**
   * Suspends or buries the current card and moves on: it and its re-queued
   * copies leave the queue. Answers already given for it stay in the history.
   */
  async function hideCurrent(
    kind: "suspend" | "bury",
    keepRedo: RedoItem[] = []
  ) {
    if (!run || !data || busy.current) return
    const current = run
    const view = data
    busy.current = true
    setMessage(null)
    dropFocus()
    try {
      const now = currentTime()
      const id = view.card.cardId
      if (kind === "suspend") await setSuspended(id, true, now)
      else await buryCard(id, now, nextDayStart(now))
      const undo: MarkUndo = {
        cardId: id,
        kind,
        previous: marksOf(view.card),
        queue: current.queue,
        index: current.index,
        phase: current.phase,
        historyLength: current.history.length,
      }
      shownAt.current = now
      setNotice(
        kind === "suspend"
          ? "Card suspended. Z undoes it."
          : "Card buried until tomorrow. Z undoes it."
      )
      setRun(
        (r) =>
          r && {
            queue: dropCardFrom(r.queue, r.index, id),
            index: r.index,
            phase: { kind: "question" },
            history: r.history,
            hidden: [...r.hidden, id],
            lastMark: undo,
            redo: keepRedo,
          }
      )
    } catch (error) {
      setMessage(errorText(error, "Couldn't update the card."))
    } finally {
      busy.current = false
    }
  }

  /** Sets the current card's flag (the same flag again clears it). The card re-reads live, so it shows at once. */
  async function flagCurrent(flag: number) {
    if (!data || busy.current) return
    const id = data.card.cardId
    busy.current = true
    setMessage(null)
    dropFocus()
    try {
      await setFlag(id, toggleFlag(data.card.flag, flag))
    } catch (error) {
      setMessage(errorText(error, "Couldn't set the flag."))
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
          redo: r.redo?.filter(
            (item) =>
              (item.kind === "review"
                ? item.entry.cardId
                : item.mark.cardId) !== noteId
          ),
        }
    )
  }

  /**
   * Takes a question that was just deleted out of the run: the current card and
   * its re-queued copies leave the queue (the next card slides into place), and
   * its answers leave the undo history and summary. The review rows it already
   * wrote stay in the database.
   */
  function dropDeleted(noteId: string) {
    shownAt.current = currentTime()
    setMessage(null)
    setRun(
      (r) =>
        r && {
          queue: dropCardFrom(r.queue, r.index, noteId),
          index: r.index,
          phase: { kind: "question" },
          hidden: r.hidden,
          redo: [],
          history: r.history
            .filter((h) => h.cardId !== noteId)
            .map((h) => ({
              ...h,
              queue: dropCardFrom(h.queue, h.index, noteId),
            })),
        }
    )
  }

  return {
    run,
    loadError,
    message,
    notice,
    shuffle,
    setShuffle,
    data,
    gone,
    order,
    intervals,
    finished,
    empty,
    canUndo,
    canRedo,
    summary,
    pick,
    gradeRight,
    next,
    skipGone,
    undo,
    redo,
    hideCurrent,
    flagCurrent,
    disableUndoFor,
    dropDeleted,
  }
}
