/**
 * The only module that talks to ts-fsrs. UI code imports `Rating`, `State`
 * and the helpers from here, never from "ts-fsrs" directly.
 *
 * Glyph uses a two-grade scale: `Again` (fail) and `Good` (pass). FSRS is at
 * least as accurate with two buttons as with four, so `Grade` is narrowed to
 * those two and nothing can schedule a card with Hard or Easy. Old review logs
 * may still hold ratings 2 and 4 (see `RevlogRow`); they are only ever read.
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type FSRS,
} from "ts-fsrs"

import type { CardRow, Note, RevlogRow } from "./types"

export { Rating, State }

/** The only ratings Glyph produces: fail or pass. */
export type Grade = Rating.Again | Rating.Good

/** Target probability of recalling a card on the day it is due. */
export const DEFAULT_RETENTION = 0.85
export const MIN_RETENTION = 0.7
export const MAX_RETENTION = 0.97

/** Clamps to the supported range and rounds to a whole percent. */
export function clampRetention(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RETENTION
  const percent = Math.round(value * 100)
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, percent / 100))
}

/** Reads a stored retention, or null if it isn't a usable number. */
export function parseRetention(stored: unknown): number | null {
  return typeof stored === "number" && Number.isFinite(stored)
    ? clampRetention(stored)
    : null
}

const schedulers = new Map<number, FSRS>()

function schedulerFor(retention: number): FSRS {
  const key = clampRetention(retention)
  let instance = schedulers.get(key)
  if (!instance) {
    instance = fsrs(
      generatorParameters({ enable_fuzz: true, request_retention: key })
    )
    schedulers.set(key, instance)
  }
  return instance
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const DAYS_PER_MONTH = 30.4375
const DAYS_PER_YEAR = 365.25

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

/** "<1m", "10m", "5h", "3d", "2.1mo", "1.5y". Rounds before choosing the unit so output is monotone. */
export function formatInterval(ms: number): string {
  const span = Number.isFinite(ms) ? Math.max(0, ms) : 0

  const minutes = Math.round(span / MINUTE)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`

  const hours = Math.round(span / HOUR)
  if (hours < 24) return `${hours}h`

  const days = Math.round(span / DAY)
  if (days < 30) return `${days}d`

  const months = Math.round((days / DAYS_PER_MONTH) * 10) / 10
  if (months < 12) return `${trimDecimal(months)}mo`

  return `${trimDecimal(days / DAYS_PER_YEAR)}y`
}

/** A brand-new (never reviewed) card row for a note. */
export function emptyCardRow(
  note: Pick<Note, "id" | "topicId">,
  now: number
): CardRow {
  return cardToRow(createEmptyCard(new Date(now)), {
    cardId: note.id,
    noteId: note.id,
    topicId: note.topicId,
  })
}

export function rowToCard(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    // ts-fsrs treats an absent last_review as "never reviewed".
    last_review: row.lastReview > 0 ? new Date(row.lastReview) : undefined,
  }
}

export function cardToRow(
  card: Card,
  base: Pick<CardRow, "cardId" | "noteId" | "topicId">
): CardRow {
  const due = card.due.getTime()
  const lastReview = card.last_review ? card.last_review.getTime() : 0
  return {
    cardId: base.cardId,
    noteId: base.noteId,
    topicId: base.topicId,
    due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview,
    // Untouched cards are created with due === creation time.
    updatedAt: lastReview > 0 ? lastReview : due,
  }
}

export interface IntervalPreview {
  /** Next interval if the card is failed. */
  again: string
  /** Next interval if the card is passed. */
  good: string
}

export function previewIntervals(
  row: CardRow,
  now: number,
  retention = DEFAULT_RETENTION
): IntervalPreview {
  const preview = schedulerFor(retention).repeat(rowToCard(row), new Date(now))
  const label = (grade: Grade) =>
    formatInterval(preview[grade].card.due.getTime() - now)
  return {
    again: label(Rating.Again),
    good: label(Rating.Good),
  }
}

export function grade(
  row: CardRow,
  rating: Grade,
  now: number,
  durationMs = 0,
  retention = DEFAULT_RETENTION
): { row: CardRow; log: RevlogRow } {
  const { card } = schedulerFor(retention).next(
    rowToCard(row),
    new Date(now),
    rating
  )
  return {
    row: cardToRow(card, row),
    log: {
      id: crypto.randomUUID(),
      cardId: row.cardId,
      reviewedAt: now,
      rating,
      state: row.state,
      durationMs,
    },
  }
}
