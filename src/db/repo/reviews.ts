import { db } from "../database"
import { grade, type Grade } from "../scheduler"
import type { CardRow, RevlogRow } from "../types"

/** Grades the card and writes the new card row and revlog entry atomically. */
export async function applyReview(
  cardRow: CardRow,
  rating: Grade,
  durationMs: number,
  now = Date.now()
): Promise<{ row: CardRow; log: RevlogRow }> {
  const result = grade(cardRow, rating, now, durationMs)
  await db.transaction("rw", [db.cards, db.revlog], async () => {
    await db.cards.put(result.row)
    await db.revlog.add(result.log)
  })
  return result
}

/**
 * Restores the card row from before a review and deletes that review's log.
 * Returns false (and changes nothing) if the log is gone or belongs to a
 * different card, so a repeated undo can't clobber later progress.
 */
export async function undoReview(
  logId: string,
  previousCardRow: CardRow
): Promise<boolean> {
  return db.transaction("rw", [db.cards, db.revlog], async () => {
    const log = await db.revlog.get(logId)
    if (!log || log.cardId !== previousCardRow.cardId) return false
    await db.cards.put(previousCardRow)
    await db.revlog.delete(logId)
    return true
  })
}
