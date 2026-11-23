import { liveDecks } from "@/lib/deck-tree"
import {
  deckNameKey,
  planImport,
  summarize,
  type ImportSummary,
  type ValidRow,
} from "@/lib/importer"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { SqlRunner } from "../sql"
import {
  CARDS,
  DECKS,
  NOTES,
  addRows,
  allRows,
  getRows,
  putNotes,
} from "../tables"
import type { Deck, Note } from "../types"
import { cleanName } from "./clean-name"

export interface ImportTarget {
  /**
   * The deck to import into, as names from the top down ("WBCS", "Mains",
   * "2018"). Each name reuses a live deck at that level (ignoring case and
   * spacing) or creates it, so any depth works.
   */
  path: readonly string[]
}

/**
 * Walks `path` from the top, reusing live decks and creating the missing ones,
 * and returns the deepest. Names are matched against the database (not a UI
 * snapshot), so a stale screen can't create a duplicate. Runs inside the
 * caller's transaction.
 */
async function resolveOrCreatePath(
  tx: SqlRunner,
  path: readonly string[],
  now: number
): Promise<Deck> {
  const live = liveDecks(await allRows(tx, DECKS))
  let parentId: string | null = null
  let deck: Deck | null = null

  for (const raw of path) {
    const name = cleanName(raw)
    const key = deckNameKey(name)
    const found: Deck | undefined = live.find(
      (d) => d.parentId === parentId && deckNameKey(d.name) === key
    )
    if (found) {
      deck = found
    } else {
      deck = {
        id: crypto.randomUUID(),
        parentId,
        name,
        updatedAt: now,
        deletedAt: null,
      }
      await addRows(tx, DECKS, [deck])
      live.push(deck)
    }
    parentId = deck.id
  }

  if (!deck) throw new Error("Choose a deck to import into.")
  return deck
}

/**
 * Commits a validated import in one transaction: creates the missing decks on
 * the path, re-plans against the stored notes, then bulk-writes. New notes get a
 * fresh card; existing notes are updated in place and their card rows are
 * never touched (a missing card is the one exception: it is created fresh so a
 * note can't be left without one).
 */
export async function commitImport(
  target: ImportTarget,
  rows: readonly ValidRow[],
  invalidCount: number,
  now = Date.now()
): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    const topic = await resolveOrCreatePath(tx, target.path, now)

    // Reading by id (not by topic) also finds tombstones for resurrection.
    const probe = planImport(rows, topic.id, new Map(), now)
    const ids = probe.toAdd.map((n) => n.id)
    const existing = new Map<string, Note>()
    for (const note of await getRows(tx, NOTES, ids)) {
      existing.set(note.id, note)
    }

    const plan = planImport(rows, topic.id, existing, now)

    await putNotes(tx, [...plan.toAdd, ...plan.toUpdate])
    const newCards = plan.toAdd.map((note) => emptyCardRow(note, now))

    const updatedIds = plan.toUpdate.map((n) => n.id)
    const haveCard = new Set(
      (await getRows(tx, CARDS, updatedIds)).map((c) => c.cardId)
    )
    for (const note of plan.toUpdate) {
      if (!haveCard.has(note.id)) newCards.push(emptyCardRow(note, now))
    }
    await addRows(tx, CARDS, newCards)

    return summarize(plan, invalidCount)
  })
}
