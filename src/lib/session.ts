/**
 * Study-session helpers: pure (no DB, no React, no ts-fsrs).
 */
import type { OptionIndex } from "./answer"
import { cyrb53 } from "./hash"
import { mulberry32, seededShuffle } from "./shuffle"

const IDENTITY: readonly OptionIndex[] = [0, 1, 2, 3]

export const REQUEUE_MIN_GAP = 3
export const REQUEUE_MAX_GAP = 5

/**
 * Display order of a note's four options: `order[slot]` is the original option
 * index shown in that slot. It depends only on the session seed, the card and
 * the queue position (one "view" of the card), never on the note's text, so it
 * does not change when the answer is revealed or the note is edited. A re-queued
 * card sits at a different position and so gets a new order.
 */
export function optionOrder(
  seed: string,
  cardId: string,
  position: number,
  shuffle: boolean
): OptionIndex[] {
  if (!shuffle) return [...IDENTITY]
  return seededShuffle(IDENTITY, `${seed}:${cardId}:${position}`)
}

/** How many cards later a failed card comes back: 3 to 5, fixed per seed/card/position. */
export function requeueGap(
  seed: string,
  cardId: string,
  position: number
): number {
  const random = mulberry32(cyrb53(`${seed}:gap:${cardId}:${position}`))
  const span = REQUEUE_MAX_GAP - REQUEUE_MIN_GAP + 1
  return REQUEUE_MIN_GAP + Math.floor(random() * span)
}

/**
 * Returns a new queue with a copy of the card at `index` inserted `gap` cards
 * later (or at the end when fewer cards remain). The input is not modified.
 */
export function requeueAgain(
  queue: readonly string[],
  index: number,
  gap: number
): string[] {
  const cardId = queue[index]
  if (cardId === undefined) return [...queue]
  const at = Math.min(index + Math.max(1, Math.floor(gap)), queue.length)
  return [...queue.slice(0, at), cardId, ...queue.slice(at)]
}

/** One answered card view, as far as the summary cares. */
export interface SessionRecord {
  cardId: string
  /** Picked the right option (whatever rating followed). */
  correct: boolean
  durationMs: number
}

export interface SessionSummary {
  /** Distinct cards answered at least once. */
  cards: number
  /** Answers given; larger than `cards` when a card came back. */
  answers: number
  correct: number
  /** 0-1; 0 when nothing was answered. */
  accuracy: number
  totalMs: number
}

export function summarizeSession(
  records: readonly SessionRecord[]
): SessionSummary {
  const correct = records.filter((r) => r.correct).length
  return {
    cards: new Set(records.map((r) => r.cardId)).size,
    answers: records.length,
    correct,
    accuracy: records.length === 0 ? 0 : correct / records.length,
    totalMs: records.reduce((sum, r) => sum + Math.max(0, r.durationMs), 0),
  }
}

/** "0:07", "12:30", "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, "0")
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`
  return `${minutes}:${ss}`
}
