import { childrenOf, subtreeIds } from "@/lib/deck-tree"
import { deckNameKey } from "@/lib/importer"

import { db } from "../database"
import type { SqlRunner } from "../sql"
import {
  DECKS,
  IDS,
  NOTES,
  addRows,
  allRows,
  getRow,
  putNotes,
  putRows,
  queryRows,
} from "../tables"
import type { Deck } from "../types"
import { cleanName } from "./clean-name"

/**
 * Whether `id` is a live deck with every ancestor live too (the same rule as
 * `liveDecks`). A missing parent or a loop counts as not live.
 */
export async function isLiveDeck(tx: SqlRunner, id: string): Promise<boolean> {
  const seen = new Set<string>()
  let current: string | null = id
  while (current !== null) {
    if (seen.has(current)) return false
    seen.add(current)
    const deck: Deck | undefined = await getRow(tx, DECKS, current)
    if (!deck || deck.deletedAt !== null) return false
    current = deck.parentId
  }
  return true
}

/** Makes a deck at the top (`parentId` null) or below another deck, to any depth. */
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
    if (parentId !== null && !(await isLiveDeck(tx, parentId))) {
      throw new Error("That deck no longer exists.")
    }
    const key = deckNameKey(deck.name)
    const clash = (await allRows(tx, DECKS)).some(
      (d) =>
        d.deletedAt === null &&
        d.parentId === parentId &&
        deckNameKey(d.name) === key
    )
    if (clash) throw new Error("A deck with that name already exists here.")
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
 * Tombstones a deck and every deck below it, to any depth, and their notes
 * too, so no live note points at a deleted deck. `contentUpdatedAt` is left
 * alone: a tombstone wins a merge by its own `deletedAt`.
 */
export async function softDeleteDeck(
  id: string,
  now = Date.now()
): Promise<void> {
  await db.transaction(async (tx) => {
    const all = await allRows(tx, DECKS)
    if (!all.some((d) => d.id === id)) throw new Error("Deck not found.")

    const doomedIds = subtreeIds(childrenOf(all), id)
    const inTree = new Set(doomedIds)
    const doomed = all.filter((d) => inTree.has(d.id) && d.deletedAt === null)

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
