import { db } from "../database"
import type { Deck } from "../types"
import { cleanName } from "./clean-name"

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
    const updated = await db.decks.update(id, {
      name: next,
      updatedAt: Date.now(),
    })
    if (updated === 0) throw new Error("Deck not found.")
  })
}

/**
 * Tombstones a deck. Deleting a Subject also tombstones its Topics, and every
 * deck's notes are tombstoned too so no live note points at a deleted topic.
 * `contentUpdatedAt` is left alone: a tombstone wins a merge by its own `deletedAt`.
 */
export async function softDeleteDeck(
  id: string,
  now = Date.now()
): Promise<void> {
  await db.transaction("rw", [db.decks, db.notes], async () => {
    const deck = await db.decks.get(id)
    if (!deck) throw new Error("Deck not found.")

    const children =
      deck.parentId === null
        ? await db.decks.where("parentId").equals(id).toArray()
        : []
    const doomed = [deck, ...children].filter((d) => d.deletedAt === null)
    const doomedIds = [deck.id, ...children.map((d) => d.id)]

    await db.decks.bulkPut(
      doomed.map((d) => ({ ...d, deletedAt: now, updatedAt: now }))
    )

    const notes = await db.notes.where("topicId").anyOf(doomedIds).toArray()
    await db.notes.bulkPut(
      notes
        .filter((n) => n.deletedAt === null)
        .map((n) => ({ ...n, deletedAt: now }))
    )
  })
}
