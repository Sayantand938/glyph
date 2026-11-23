import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { Note } from "../types"

/**
 * Saves an edited note. The id is frozen (taken from the stored note) and
 * `deletedAt` is never changed here. Always bumps `contentUpdatedAt`, keeps
 * `cards.topicId` in sync, and with `resetFsrs` swaps in a fresh card under
 * the same cardId. The revlog is never touched.
 */
export async function saveNote(
  note: Note,
  { resetFsrs = false }: { resetFsrs?: boolean } = {},
  now = Date.now()
): Promise<Note> {
  return db.transaction("rw", [db.notes, db.cards], async () => {
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
    return saved
  })
}
