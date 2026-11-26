/**
 * Study-queue and dashboard-count logic: pure (no DB, no React, no ts-fsrs).
 * Cards are passed in as plain objects; the DB layer fetches them.
 */
import { isHidden } from "./card-marks"
import { seededShuffle } from "./shuffle"

// Mirrors the ts-fsrs State enum (kept in sync by queue.test.ts).
export const CARD_NEW = 0
export const CARD_LEARNING = 1
export const CARD_REVIEW = 2
export const CARD_RELEARNING = 3

/** The slice of a card row the counts need. */
export interface CountCard {
  cardId: string
  topicId: string
  state: number
  /** ms epoch */
  due: number
  /** Suspended cards are left out of the queue and the counts. */
  suspended?: boolean
  /** ms epoch; a card is buried (left out) while this is still in the future. */
  buriedUntil?: number
}

/** What the queue needs: a counted card plus its FSRS stability. */
export interface QueueCard extends CountCard {
  /** FSRS memory stability in days: how long the memory lasts. Orders due reviews. */
  stability: number
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

/** Last millisecond of the local calendar day that contains `now`. */
export function endOfLocalDay(now: number): number {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

/**
 * Raw per-deck counts:
 *  - new: state New
 *  - learning: Learning/Relearning with due <= now (minutes-scale steps)
 *  - due: Review with due any time today (<= end of the local day)
 *
 * Review cards are day-granular on purpose. FSRS stamps a due moment (say
 * 14:03 tomorrow), and a session started at 09:00 would otherwise skip that
 * card and show it a day late. Simulated over a year, this cut lapses by
 * about 14% and the average lateness from 0.6 days to about 0.
 *
 * Suspended and buried cards are not counted at all.
 */
export function countCards(
  cards: readonly CountCard[],
  now: number
): DeckCounts {
  const counts: DeckCounts = { new: 0, learning: 0, due: 0 }
  const endOfDay = endOfLocalDay(now)
  for (const card of cards) {
    if (isHidden(card, now)) continue
    if (card.state === CARD_NEW) counts.new += 1
    else if (isLearning(card.state) && card.due <= now) counts.learning += 1
    else if (card.state === CARD_REVIEW && card.due <= endOfDay) counts.due += 1
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
  /** Which kinds of card to include; all of them when omitted. */
  include?: Partial<QueueGroups>
  /**
   * At most this many new cards, the oldest first (null or omitted = all of
   * them). Cards of the other groups are never limited.
   */
  newLimit?: number | null
}

/** The three kinds of card a session can draw from. */
export interface QueueGroups {
  due: boolean
  learning: boolean
  new: boolean
}

/** How many new cards `newLimit` lets through, out of `available`. */
export function limitNew(available: number, newLimit?: number | null): number {
  if (newLimit === null || newLimit === undefined) return available
  return Math.max(0, Math.min(available, Math.floor(newLimit)))
}

function byDue(a: QueueCard, b: QueueCard): number {
  return (
    a.due - b.due || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)
  )
}

/** Least stable first (the weakest memories), then oldest due, then id. */
function byStability(a: QueueCard, b: QueueCard): number {
  return a.stability - b.stability || byDue(a, b)
}

/**
 * The `limit` oldest cards, in due order. A bounded max-heap instead of a full
 * sort: a fresh 150k-card deck with a 200-new-cards-a-day limit takes
 * O(n log limit) instead of O(n log n), and the result is identical to
 * `[...cards].sort(byDue).slice(0, limit)`.
 */
function takeOldest(
  cards: readonly QueueCard[],
  limit: number
): QueueCard[] {
  if (limit >= cards.length) return [...cards].sort(byDue)
  if (limit <= 0) return []
  const heap: QueueCard[] = []

  const siftUp = (start: number) => {
    let i = start
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (byDue(heap[i], heap[parent]) <= 0) break
      ;[heap[i], heap[parent]] = [heap[parent], heap[i]]
      i = parent
    }
  }
  const siftDown = (start: number) => {
    let i = start
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let largest = i
      if (left < heap.length && byDue(heap[left], heap[largest]) > 0) {
        largest = left
      }
      if (right < heap.length && byDue(heap[right], heap[largest]) > 0) {
        largest = right
      }
      if (largest === i) break
      ;[heap[i], heap[largest]] = [heap[largest], heap[i]]
      i = largest
    }
  }

  for (const card of cards) {
    if (heap.length < limit) {
      heap.push(card)
      siftUp(heap.length - 1)
    } else if (byDue(card, heap[0]) < 0) {
      heap[0] = card
      siftDown(0)
    }
  }
  return heap.sort(byDue)
}

/**
 * Spreads `extra` through `base` at seeded random positions, keeping the
 * relative order of both lists.
 */
function interleave(
  base: readonly string[],
  extra: readonly string[],
  seed: string
): string[] {
  const mask = seededShuffle(
    [...base.map(() => false), ...extra.map(() => true)],
    seed
  )
  let b = 0
  let e = 0
  return mask.map((isExtra) => (isExtra ? extra[e++] : base[b++]))
}

/**
 * Builds the session as a list of cardIds, once at session start.
 * Learning/Relearning cards due now come first (most overdue first), then Review
 * cards due today (least stable first, so the memories closest to fading are
 * asked first), then New cards (shuffled; all of them unless `newLimit` is
 * set). In a mixed session the new cards are spread through the reviews, which
 * keep their stability order. `include` leaves a whole group out, like Anki's
 * custom study. Suspended and buried cards are skipped.
 */
/** The three id lists a queue is assembled from, each already in session order. */
export interface QueueIds {
  /** Learning/Relearning due now, most overdue first. */
  learning: readonly string[]
  /** Review cards due today, least stable first. */
  review: readonly string[]
  /** New cards, oldest due first and already cut to `newLimit`. */
  fresh: readonly string[]
}

/**
 * Turns ordered id lists into the session's queue: learning first, then reviews
 * (stability order), then new cards (shuffled), or new cards spread through the
 * reviews in a mixed session. Pure, so the DB layer can let SQL do the filtering
 * and sorting on a huge deck while the order still comes from one place.
 */
export function assembleQueue(ids: QueueIds, seed: string, mixed = false): string[] {
  const reviews = [...ids.review]
  const news = seededShuffle([...ids.fresh], `${seed}:new`)
  if (mixed) return [...ids.learning, ...interleave(reviews, news, seed)]
  return [...ids.learning, ...reviews, ...news]
}

export function buildQueue({
  cards,
  now,
  seed,
  mixed = false,
  include,
  newLimit,
}: BuildQueueOptions): string[] {
  const wanted: QueueGroups = {
    due: include?.due ?? true,
    learning: include?.learning ?? true,
    new: include?.new ?? true,
  }
  const learning: QueueCard[] = []
  const review: QueueCard[] = []
  const fresh: QueueCard[] = []
  const endOfDay = endOfLocalDay(now)

  for (const card of cards) {
    if (isHidden(card, now)) continue
    if (card.state === CARD_NEW) {
      if (wanted.new) fresh.push(card)
    } else if (isLearning(card.state) && card.due <= now) {
      if (wanted.learning) learning.push(card)
    } else if (card.state === CARD_REVIEW && card.due <= endOfDay) {
      if (wanted.due) review.push(card)
    }
  }

  // Oldest first, so a limit takes the cards that have waited longest and the
  // rest follow on later days.
  const newCards = takeOldest(fresh, limitNew(fresh.length, newLimit))
  const ids = (list: readonly QueueCard[]) => list.map((c) => c.cardId)

  return assembleQueue(
    {
      learning: ids(learning.sort(byDue)),
      review: ids(review.sort(byStability)),
      fresh: ids(newCards),
    },
    seed,
    mixed
  )
}
