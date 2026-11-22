/**
 * Study-queue and dashboard-count logic: pure (no DB, no React, no ts-fsrs).
 * Cards are passed in as plain objects; the DB layer fetches them.
 */
import { seededShuffle } from "./shuffle"

// Mirrors the ts-fsrs State enum (kept in sync by queue.test.ts).
export const CARD_NEW = 0
export const CARD_LEARNING = 1
export const CARD_REVIEW = 2
export const CARD_RELEARNING = 3

export const DEFAULT_NEW_LIMIT = 20
/** Local hour at which the study "day" rolls over. */
export const DAY_ROLLOVER_HOUR = 4

/** The slice of a card row the queue and the counts need. */
export interface QueueCard {
  cardId: string
  topicId: string
  state: number
  /** ms epoch */
  due: number
}

export interface DeckCounts {
  new: number
  learning: number
  due: number
}

export const ZERO_COUNTS: DeckCounts = { new: 0, learning: 0, due: 0 }

function isLearning(state: number): boolean {
  return state === CARD_LEARNING || state === CARD_RELEARNING
}

/**
 * Raw per-deck counts:
 *  - new: state New
 *  - learning: Learning/Relearning with due <= now
 *  - due: Review with due <= now
 */
export function countCards(
  cards: readonly QueueCard[],
  now: number
): DeckCounts {
  const counts: DeckCounts = { new: 0, learning: 0, due: 0 }
  for (const card of cards) {
    if (card.state === CARD_NEW) counts.new += 1
    else if (isLearning(card.state) && card.due <= now) counts.learning += 1
    else if (card.state === CARD_REVIEW && card.due <= now) counts.due += 1
  }
  return counts
}

export function addCounts(a: DeckCounts, b: DeckCounts): DeckCounts {
  return {
    new: a.new + b.new,
    learning: a.learning + b.learning,
    due: a.due + b.due,
  }
}

/** Caps the New count at what is left of today's limit. */
export function capNew(counts: DeckCounts, remainingNew: number): DeckCounts {
  return { ...counts, new: Math.min(counts.new, Math.max(0, remainingNew)) }
}

export function totalCount(counts: DeckCounts): number {
  return counts.new + counts.learning + counts.due
}

/**
 * Start (ms epoch) of the study day containing `now`. The day rolls over at
 * `rolloverHour` local time, so at 02:00 it is still "yesterday".
 */
export function studyDayStart(
  now: number,
  rolloverHour = DAY_ROLLOVER_HOUR
): number {
  const start = new Date(now)
  start.setHours(rolloverHour, 0, 0, 0)
  if (start.getTime() > now) start.setDate(start.getDate() - 1)
  return start.getTime()
}

/**
 * How many cards were introduced today: distinct cards with a review today
 * whose first-ever review was today. `todayLogs` are the reviews since the
 * day start; `reviewedBefore` holds the cardIds with any review before it.
 */
export function countNewIntroduced(
  todayLogs: readonly { cardId: string }[],
  reviewedBefore: ReadonlySet<string>
): number {
  const introduced = new Set<string>()
  for (const log of todayLogs) {
    if (!reviewedBefore.has(log.cardId)) introduced.add(log.cardId)
  }
  return introduced.size
}

export function remainingNew(limit: number, introducedToday: number): number {
  return Math.max(0, Math.floor(limit) - introducedToday)
}

export interface BuildQueueOptions {
  cards: readonly QueueCard[]
  now: number
  /** New cards still allowed today (already net of those introduced today). */
  newLimit: number
  /** Session seed: the same seed gives the same order. */
  seed: string
  /**
   * false (Topic): learning, then due reviews, then new, each group shuffled.
   * true (Subject): learning first, then reviews and new cards mixed together.
   */
  mixed?: boolean
}

function byDue(a: QueueCard, b: QueueCard): number {
  return (
    a.due - b.due || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)
  )
}

/**
 * Builds the session as a list of cardIds, once at session start.
 * Learning/Relearning cards due now come first (most overdue first), then Review
 * cards due now, then New cards up to `newLimit`. When more New cards exist than
 * the limit allows, the oldest (import order) are taken.
 */
export function buildQueue({
  cards,
  now,
  newLimit,
  seed,
  mixed = false,
}: BuildQueueOptions): string[] {
  const learning: QueueCard[] = []
  const review: QueueCard[] = []
  const fresh: QueueCard[] = []

  for (const card of cards) {
    if (card.state === CARD_NEW) fresh.push(card)
    else if (isLearning(card.state) && card.due <= now) learning.push(card)
    else if (card.state === CARD_REVIEW && card.due <= now) review.push(card)
  }

  const limit = Math.max(0, Math.floor(newLimit))
  const newCards = fresh.sort(byDue).slice(0, limit)
  const ids = (list: readonly QueueCard[]) => list.map((c) => c.cardId)

  const first = ids(learning.sort(byDue))
  if (mixed) {
    return [
      ...first,
      ...seededShuffle([...ids(review.sort(byDue)), ...ids(newCards)], seed),
    ]
  }
  return [
    ...first,
    ...seededShuffle(ids(review.sort(byDue)), `${seed}:review`),
    ...seededShuffle(ids(newCards), `${seed}:new`),
  ]
}
