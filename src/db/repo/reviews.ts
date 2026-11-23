import { marksOf } from "@/lib/card-marks"

import { db } from "../database"
import {
  DEFAULT_RETENTION,
  grade,
  type Grade,
  type ReviewAnswer,
  type Weights,
} from "../scheduler"
import type { CardRow, RevlogRow } from "../types"

/**
 * Grades the card and writes the new card row and revlog entry atomically. The
 * card's marks (flag, suspend, bury) are taken from the stored row, not from
 * `cardRow`, so a flag set a moment ago on screen is never overwritten.
 * `answer` says whether the pick was right and how long it took (see
 * `RevlogRow`); without it the log assumes a pass was a right pick.
 */
export async function applyReview(
  cardRow: CardRow,
  rating: Grade,
  durationMs: number,
  retention = DEFAULT_RETENTION,
  weights?: Weights,
  now = Date.now(),
  answer?: ReviewAnswer
): Promise<{ row: CardRow; log: RevlogRow }> {
  const result = grade(
    cardRow,
    rating,
    now,
    durationMs,
    retention,
    weights,
    answer
  )
  const { log } = result
  return db.transaction("rw", [db.cards, db.revlog], async () => {
    const stored = await db.cards.get(cardRow.cardId)
    const row = stored ? { ...result.row, ...marksOf(stored) } : result.row
    await db.cards.put(row)
    await db.revlog.add(log)
    return { row, log }
  })
}

/**
 * Restores the card row from before a review and deletes that review's log.
 * The card's marks stay as they are now (an undo takes back progress, not a
 * flag or suspend made since). Returns false (and changes nothing) if the log
 * is gone or belongs to a different card, so a repeated undo can't clobber
 * later progress.
 */
export async function undoReview(
  logId: string,
  previousCardRow: CardRow
): Promise<boolean> {
  return db.transaction("rw", [db.cards, db.revlog], async () => {
    const log = await db.revlog.get(logId)
    if (!log || log.cardId !== previousCardRow.cardId) return false
    const stored = await db.cards.get(previousCardRow.cardId)
    await db.cards.put(
      stored ? { ...previousCardRow, ...marksOf(stored) } : previousCardRow
    )
    await db.revlog.delete(logId)
    return true
  })
}
