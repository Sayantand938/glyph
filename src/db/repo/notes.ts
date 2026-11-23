import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { Note } from "../types"
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
  return db.transaction("rw", [db.notes, db.cards, db.images], async () => {
    const existing = await db.notes.get(note.id)
    if (!existing) throw new Error("Note not found.")

    const saved: Note = {
      ...note,
      id: existing.id,
      deletedAt: existing.deletedAt,
      contentUpdatedAt: now,
    }
    await db.notes.put(saved)

    const card = await db.cards.get(existing.id)
    if (resetFsrs || !card) {
      await db.cards.put(emptyCardRow(saved, now))
    } else if (card.topicId !== saved.topicId) {
      await db.cards.update(card.cardId, { topicId: saved.topicId })
    }
    // Pictures the edit dropped (or a cancelled paste left behind) go too.
    await deleteOrphanImages()
    return saved
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
  await db.transaction("rw", db.notes, async () => {
    const note = await db.notes.get(id)
    if (!note) throw new Error("Question not found.")
    if (note.deletedAt !== null) return
    await db.notes.put({
      ...note,
      deletedAt: Math.max(now, note.contentUpdatedAt + 1),
    })
  })
}
