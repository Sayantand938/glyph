/** All writes go through here, each in a single Dexie transaction. */
import { db } from "./database"
import { emptyCardRow, grade, type Grade } from "./scheduler"
import type { CardRow, Deck, Note, RevlogRow } from "./types"

function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Name cannot be empty.")
  return trimmed
}

export async function createDeck(
  name: string,
  parentId: string | null = null
): Promise<Deck> {
  const deck: Deck = {
    id: crypto.randomUUID(),
    parentId,
    name: cleanName(name),
    updatedAt: Date.now(),
    deletedAt: null,
  }
  await db.transaction("rw", db.decks, async () => {
    if (parentId !== null) {
      const parent = await db.decks.get(parentId)
      if (!parent || parent.deletedAt !== null) {
        throw new Error("Parent subject not found.")
      }
      if (parent.parentId !== null) {
        throw new Error("Topics cannot contain other decks.")
      }
    }
    await db.decks.add(deck)
  })
  return deck
}

export async function renameDeck(id: string, name: string): Promise<void> {
  const next = cleanName(name)
  await db.transaction("rw", db.decks, async () => {
    const updated = await db.decks.update(id, { name: next, updatedAt: Date.now() })
    if (updated === 0) throw new Error("Deck not found.")
  })
}

/**
 * Tombstones a deck. Deleting a Subject also tombstones its Topics, and every
 * deck's notes are tombstoned too so no live note points at a deleted topic.
 * `contentUpdatedAt` is left alone: a tombstone wins a merge by its own `deletedAt`.
 */
export async function softDeleteDeck(id: string, now = Date.now()): Promise<void> {
  await db.transaction("rw", [db.decks, db.notes], async () => {
    const deck = await db.decks.get(id)
    if (!deck) throw new Error("Deck not found.")

    const children =
      deck.parentId === null ? await db.decks.where("parentId").equals(id).toArray() : []
    const doomed = [deck, ...children].filter((d) => d.deletedAt === null)
    const doomedIds = [deck.id, ...children.map((d) => d.id)]

    await db.decks.bulkPut(doomed.map((d) => ({ ...d, deletedAt: now, updatedAt: now })))

    const notes = await db.notes.where("topicId").anyOf(doomedIds).toArray()
    await db.notes.bulkPut(
      notes.filter((n) => n.deletedAt === null).map((n) => ({ ...n, deletedAt: now }))
    )
  })
}

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
