/**
 * One question's review history, summarized for its History page. Pure: it
 * takes the review log rows of one card and returns the numbers to show.
 */
import type { RevlogRow } from "@/db/types"

export interface CardHistory {
  /** Newest first (ties by id, so the order is stable). */
  entries: RevlogRow[]
  reviews: number
  /** Reviews where the picked option was right. */
  correct: number
  /** 0..1, or null before the first review. */
  correctRate: number | null
  /** Right pick but rated Again: a guess or a slip of memory. */
  guessed: number
  /** Average time to pick an option over all reviews, or null with none. */
  avgAnswerMs: number | null
  /** The same over right picks only, or null with none. */
  avgCorrectAnswerMs: number | null
  /** Total time on this card, explanation reading included. */
  totalMs: number
  /** ms epoch of the first and the latest review, or null with none. */
  firstAt: number | null
  lastAt: number | null
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function summarizeHistory(logs: readonly RevlogRow[]): CardHistory {
  const entries = [...logs].sort(
    (a, b) => b.reviewedAt - a.reviewedAt || a.id.localeCompare(b.id)
  )
  const right = entries.filter((e) => e.correct)
  return {
    entries,
    reviews: entries.length,
    correct: right.length,
    correctRate: entries.length === 0 ? null : right.length / entries.length,
    guessed: right.filter((e) => e.rating === 1).length,
    avgAnswerMs: average(entries.map((e) => e.answerMs)),
    avgCorrectAnswerMs: average(right.map((e) => e.answerMs)),
    totalMs: entries.reduce((sum, e) => sum + Math.max(0, e.durationMs), 0),
    firstAt:
      entries.length === 0 ? null : entries[entries.length - 1].reviewedAt,
    lastAt: entries.length === 0 ? null : entries[0].reviewedAt,
  }
}
