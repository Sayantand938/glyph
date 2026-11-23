import { marksOf } from "@/lib/card-marks"
import { noteId } from "@/lib/hash"
import type { NoteDraft } from "@/lib/note-edit"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import { CARDS, NOTES, addRows, getRow, putNotes, putRows } from "../tables"
import type { Note } from "../types"
import { isLiveDeck } from "./decks"
import { deleteOrphanImages } from "./images"

/**
 * Saves an edited note. The id is frozen (taken from the stored note) and
 * `deletedAt` is never changed here. Always bumps `contentUpdatedAt`, keeps
 * `cards.topicId` in sync, and with `resetFsrs` swaps in a fresh card under
 * the same cardId. The revlog is never touched. Images that no note uses any
 * more are deleted in the same transaction.
 */
export async function saveNote(
  note: Note,
  { resetFsrs = false }: { resetFsrs?: boolean } = {},
  now = Date.now()
): Promise<Note> {
  return db.transaction(async (tx) => {
    const existing = await getRow(tx, NOTES, note.id)
    if (!existing) throw new Error("Note not found.")

    const saved: Note = {
      ...note,
      id: existing.id,
      deletedAt: existing.deletedAt,
      contentUpdatedAt: now,
    }
    await putNotes(tx, [saved])

    const card = await getRow(tx, CARDS, existing.id)
    if (resetFsrs || !card) {
      // A reset clears progress, not the flag or a suspend.
      await putRows(tx, CARDS, [
        {
          ...emptyCardRow(saved, now),
          ...(card ? marksOf(card) : {}),
        },
      ])
    } else if (card.topicId !== saved.topicId) {
      await putRows(tx, CARDS, [{ ...card, topicId: saved.topicId }])
    }
    // Pictures the edit dropped (or a cancelled paste left behind) go too.
    await deleteOrphanImages(tx)
    return saved
  })
}

/**
 * Adds one question to a deck by hand (the draft is already cleaned). The id
 * is the usual deterministic one (`noteId`), so the same wording in the same
 * deck is the same question: a live one is refused, a deleted one comes back
 * with its old progress (like importing it again). A new question gets a fresh
 * card and the next number after the deck's highest (`sl`).
 */
export async function addNote(
  topicId: string,
  draft: NoteDraft,
  now = Date.now()
): Promise<Note> {
  return db.transaction(async (tx) => {
    if (!(await isLiveDeck(tx, topicId))) {
      throw new Error("That deck no longer exists.")
    }

    const id = noteId(topicId, draft.question)
    const existing = await getRow(tx, NOTES, id)
    if (existing && existing.deletedAt === null) {
      throw new Error("This question is already in this deck.")
    }

    let sl: number | string
    if (existing) {
      sl = existing.sl
    } else {
      const rows = await tx.select(
        "SELECT sl FROM notes WHERE topicId = ? AND deletedAt IS NULL",
        [topicId]
      )
      const numbers = rows.map((row) => Number(row.sl)).filter(Number.isFinite)
      sl = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1
    }

    const note: Note = {
      id,
      topicId,
      sl,
      question: draft.question,
      options: draft.options,
      correctIndex: draft.correctIndex,
      extra: draft.extra,
      tags: draft.tags,
      // Newer than any tombstone or older copy of this note, so it wins a merge.
      contentUpdatedAt: Math.max(
        now,
        (existing?.contentUpdatedAt ?? 0) + 1,
        (existing?.deletedAt ?? 0) + 1
      ),
      deletedAt: null,
    }
    await putNotes(tx, [note])
    if (!(await getRow(tx, CARDS, id))) {
      await addRows(tx, CARDS, [emptyCardRow(note, now)])
    }
    return note
  })
}

/**
 * Soft-deletes one question: tombstones the note (`deletedAt`), the same way a
 * deleted deck's notes are. The card row and review log stay, so a question
 * that is imported again comes back with its progress. `deletedAt` is always
 * newer than `contentUpdatedAt`, so the tombstone beats this note's own older
 * copies in a backup merge. Images are kept (tombstoned notes still count as
 * users). Deleting an already deleted note does nothing.
 */
export async function deleteNote(id: string, now = Date.now()): Promise<void> {
  await db.transaction(async (tx) => {
    const note = await getRow(tx, NOTES, id)
    if (!note) throw new Error("Question not found.")
    if (note.deletedAt !== null) return
    await putNotes(tx, [
      { ...note, deletedAt: Math.max(now, note.contentUpdatedAt + 1) },
    ])
  })
}
