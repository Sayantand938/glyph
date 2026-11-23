import { childrenOf, liveDecks, subtreeIds } from "@/lib/deck-tree"
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

/**
 * Walks `path` from `parentId` (the top when null), reusing live decks and
 * creating the missing ones, and returns the deepest plus how many it made.
 * Names are matched against the database (not a UI snapshot), so a stale
 * screen can't create a duplicate. Runs inside the caller's transaction.
 */
export async function resolveOrCreatePath(
  tx: SqlRunner,
  path: readonly string[],
  now: number,
  parentId: string | null = null
): Promise<{ deck: Deck; created: number }> {
  if (parentId !== null && !(await isLiveDeck(tx, parentId))) {
    throw new Error("That deck no longer exists.")
  }
  const live = liveDecks(await allRows(tx, DECKS))
  let deck: Deck | null = null
  let created = 0

  for (const raw of path) {
    const name = cleanName(raw)
    const key = deckNameKey(name)
    const above: string | null = parentId
    const found: Deck | undefined = live.find(
      (d) => d.parentId === above && deckNameKey(d.name) === key
    )
    if (found) {
      deck = found
    } else {
      deck = {
        id: crypto.randomUUID(),
        parentId: above,
        name,
        updatedAt: now,
        deletedAt: null,
      }
      await addRows(tx, DECKS, [deck])
      live.push(deck)
      created += 1
    }
    parentId = deck.id
  }

  if (!deck) throw new Error("Choose a deck to import into.")
  return { deck, created }
}

/**
 * Makes the deck at the end of a typed path ("WBCS", "Mains", "2018") under
 * `parentId`, creating each missing level on the way. Levels that already exist
 * are reused, but the last one must be new.
 */
export async function createDeckPath(
  path: readonly string[],
  parentId: string | null = null
): Promise<Deck> {
  if (path.length === 0) throw new Error("Name cannot be empty.")
  return db.transaction(async (tx) => {
    const { deck, created } = await resolveOrCreatePath(
      tx,
      path,
      Date.now(),
      parentId
    )
    if (created === 0) {
      throw new Error("A deck with that name already exists here.")
    }
    return deck
  })
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
