import { marksOf } from "@/lib/card-marks"
import {
  isLeechLapse,
  withLeechTag,
  withoutLeechTag,
  type LeechAction,
  type LeechRule,
} from "@/lib/leech"
import { sameTags } from "@/lib/tags"

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
 * What a review did because the card became a leech (see `lib/leech.ts`), kept
 * so the study session can say so and `undoReview` can take it back.
 */
export interface LeechOutcome {
  action: LeechAction
  /** The card's lapse count after the review. */
  lapses: number
  /** The `leech` tag was added to the note (it was not there before). */
  taggedNote: boolean
  /** The card was suspended by this review (it was not before). */
  suspended: boolean
}

/**
 * Grades the card and writes the new card row and revlog entry atomically. The
 * card's marks (flag, suspend, bury) are taken from the stored row, not from
 * `cardRow`, so a flag set a moment ago on screen is never overwritten.
 * `answer` says whether the pick was right and how long it took (see
 * `RevlogRow`); without it the log assumes a pass was a right pick.
 *
 * With a `leech` rule, a review that lapses the card up to the threshold also
 * tags its note `leech` and, for the "suspend" action, suspends the card, in the
 * same transaction. The outcome is returned (null when nothing happened).
 */
export async function applyReview(
  cardRow: CardRow,
  rating: Grade,
  durationMs: number,
  retention = DEFAULT_RETENTION,
  weights?: Weights,
  now = Date.now(),
  answer?: ReviewAnswer,
  leech?: LeechRule
): Promise<{ row: CardRow; log: RevlogRow; leech: LeechOutcome | null }> {
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
  return db.transaction("rw", [db.cards, db.revlog, db.notes], async () => {
    const stored = await db.cards.get(cardRow.cardId)
    let row = stored ? { ...result.row, ...marksOf(stored) } : result.row
    let outcome: LeechOutcome | null = null

    if (leech && isLeechLapse(cardRow.lapses, row.lapses, leech.threshold)) {
      const note = await db.notes.get(row.noteId)
      if (note && note.deletedAt === null) {
        const tags = withLeechTag(note.tags)
        const taggedNote = !sameTags(tags, note.tags)
        if (taggedNote) {
          await db.notes.put({
            ...note,
            tags,
            contentUpdatedAt: Math.max(now, note.contentUpdatedAt + 1),
          })
        }
        const suspended = leech.action === "suspend" && !row.suspended
        if (suspended) {
          row = {
            ...row,
            suspended: true,
            markedAt: Math.max(now, row.markedAt + 1),
          }
        }
        outcome = {
          action: leech.action,
          lapses: row.lapses,
          taggedNote,
          suspended,
        }
      }
    }

    await db.cards.put(row)
    await db.revlog.add(log)
    return { row, log, leech: outcome }
  })
}

/**
 * Restores the card row from before a review and deletes that review's log.
 * The card's marks stay as they are now (an undo takes back progress, not a
 * flag or suspend made since), except what the review itself did as a leech:
 * `leech` says so, and its suspend and `leech` tag are taken back too. Returns
 * false (and changes nothing) if the log is gone or belongs to a different card,
 * so a repeated undo can't clobber later progress.
 */
export async function undoReview(
  logId: string,
  previousCardRow: CardRow,
  leech?: LeechOutcome | null,
  now = Date.now()
): Promise<boolean> {
  return db.transaction("rw", [db.cards, db.revlog, db.notes], async () => {
    const log = await db.revlog.get(logId)
    if (!log || log.cardId !== previousCardRow.cardId) return false
    const stored = await db.cards.get(previousCardRow.cardId)
    let marks = stored ? marksOf(stored) : null
    if (leech?.suspended && marks?.suspended) {
      marks = {
        ...marks,
        suspended: false,
        markedAt: Math.max(now, marks.markedAt + 1),
      }
    }
    await db.cards.put(
      marks ? { ...previousCardRow, ...marks } : previousCardRow
    )
    await db.revlog.delete(logId)

    if (leech?.taggedNote) {
      const note = await db.notes.get(previousCardRow.noteId)
      if (note && note.deletedAt === null) {
        await db.notes.put({
          ...note,
          tags: withoutLeechTag(note.tags),
          contentUpdatedAt: Math.max(now, note.contentUpdatedAt + 1),
        })
      }
    }
    return true
  })
}
