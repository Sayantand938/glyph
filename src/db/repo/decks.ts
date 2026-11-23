import { db } from "../database"
import {
  DECKS,
  IDS,
  NOTES,
  addRows,
  getRow,
  putNotes,
  putRows,
  queryRows,
} from "../tables"
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
  await db.transaction(async (tx) => {
    if (parentId !== null) {
      const parent = await getRow(tx, DECKS, parentId)
      if (!parent || parent.deletedAt !== null) {
        throw new Error("Parent subject not found.")
      }
      if (parent.parentId !== null) {
        throw new Error("Topics cannot contain other decks.")
      }
    }
    await addRows(tx, DECKS, [deck])
  })
  return deck
}

export async function renameDeck(id: string, name: string): Promise<void> {
  const next = cleanName(name)
  await db.transaction(async (tx) => {
    const deck = await getRow(tx, DECKS, id)
    if (!deck) throw new Error("Deck not found.")
    await putRows(tx, DECKS, [{ ...deck, name: next, updatedAt: Date.now() }])
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
  await db.transaction(async (tx) => {
    const deck = await getRow(tx, DECKS, id)
    if (!deck) throw new Error("Deck not found.")

    const children =
      deck.parentId === null
        ? await queryRows(tx, DECKS, "WHERE parentId = ?", [id])
        : []
    const doomed = [deck, ...children].filter((d) => d.deletedAt === null)
    const doomedIds = [deck.id, ...children.map((d) => d.id)]

    await putRows(
      tx,
      DECKS,
      doomed.map((d) => ({ ...d, deletedAt: now, updatedAt: now }))
    )

    const notes = await queryRows(
      tx,
      NOTES,
      `WHERE topicId ${IDS} AND deletedAt IS NULL`,
      [JSON.stringify(doomedIds)]
    )
    await putNotes(
      tx,
      notes.map((n) => ({ ...n, deletedAt: now }))
    )
  })
}
