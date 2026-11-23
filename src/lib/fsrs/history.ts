import { elapsedStudyDays } from "./days"
import type { Sequence, Step } from "./types"

/** ts-fsrs State.New: the review that starts (or restarts) a card. */
const STATE_NEW = 0

export interface ReviewRecord {
  cardId: string
  reviewedAt: number
  rating: number
  /** State BEFORE the review (0 New, 1 Learning, 2 Review, 3 Relearning). */
  state: number
}

/**
 * Turns the review log into one sequence per run of a card: reviews sorted by
 * time, `t` counted in local calendar days exactly as the scheduler counts
 * elapsed days (see days.ts). A review made in state New starts a new sequence, so a card
 * whose progress was reset is learned afresh. A run that doesn't begin with a
 * New-state review (its start is missing, e.g. from a partial restore) is
 * dropped, because its starting memory is unknown.
 */
export function buildSequences(
  reviews: readonly ReviewRecord[],
  offsetOf?: (timestamp: number) => number
): Sequence[] {
  const byCard = new Map<string, ReviewRecord[]>()
  for (const review of reviews) {
    if (!Number.isInteger(review.rating) || review.rating < 1) continue
    if (review.rating > 4) continue
    const list = byCard.get(review.cardId)
    if (list) list.push(review)
    else byCard.set(review.cardId, [review])
  }

  const sequences: Sequence[] = []
  for (const [cardId, list] of byCard) {
    list.sort((a, b) => a.reviewedAt - b.reviewedAt)
    let steps: Step[] | null = null
    let previousAt = 0
    const flush = () => {
      if (steps && steps.length > 0) sequences.push({ cardId, steps })
      steps = null
    }
    for (const review of list) {
      if (review.state === STATE_NEW) {
        flush()
        steps = [{ rating: review.rating, t: 0 }]
      } else if (steps) {
        steps.push({
          rating: review.rating,
          t: elapsedStudyDays(previousAt, review.reviewedAt, offsetOf),
        })
      }
      previousAt = review.reviewedAt
    }
    flush()
  }
  return sequences
}

/** How many reviews can teach the optimizer something (>= a day after the last). */
export function countScored(sequences: readonly Sequence[]): number {
  let count = 0
  for (const seq of sequences) {
    for (let i = 1; i < seq.steps.length; i++) {
      if (seq.steps[i].t >= 1) count += 1
    }
  }
  return count
}
