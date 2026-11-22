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

export function totalCount(counts: DeckCounts): number {
  return counts.new + counts.learning + counts.due
}

export interface BuildQueueOptions {
  cards: readonly QueueCard[]
  now: number
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
 * cards due now, then all New cards (there is no daily new-card limit).
 */
export function buildQueue({
  cards,
  now,
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

  const newCards = fresh.sort(byDue)
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
