import {
  deckNameKey,
  planImport,
  summarize,
  type DeckRef,
  type ImportSummary,
  type ValidRow,
} from "@/lib/importer"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { Deck, Note } from "../types"
import { cleanName } from "./clean-name"

export interface ImportTarget {
  subject: DeckRef
  topic: DeckRef
}

/**
 * Finds the live deck a ref points at, or creates it. Names are re-matched
 * against the database (case-insensitive, trimmed) so a ref computed from a
 * stale UI snapshot can't create a duplicate. Runs inside the caller's
 * transaction.
 */
async function resolveOrCreateDeck(
  ref: DeckRef,
  parentId: string | null,
  now: number
): Promise<Deck> {
  const live = (await db.decks.toArray()).filter(
    (d) => d.deletedAt === null && d.parentId === parentId
  )

  if (ref.kind === "existing") {
    const deck = live.find((d) => d.id === ref.id)
    if (!deck) {
      throw new Error(
        parentId === null
          ? "The selected subject no longer exists."
          : "The selected topic no longer exists."
      )
    }
    return deck
  }

  const name = cleanName(ref.name)
  const key = deckNameKey(name)
  const match = live.find((d) => deckNameKey(d.name) === key)
  if (match) return match

  const deck: Deck = {
    id: crypto.randomUUID(),
    parentId,
    name,
    updatedAt: now,
    deletedAt: null,
  }
  await db.decks.add(deck)
  return deck
}

/**
 * Commits a validated import in one transaction: creates missing Subject and
 * Topic, re-plans against the stored notes, then bulk-writes. New notes get a
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
  return db.transaction("rw", [db.decks, db.notes, db.cards], async () => {
    const subject = await resolveOrCreateDeck(target.subject, null, now)
    const topic = await resolveOrCreateDeck(target.topic, subject.id, now)

    // Reading by id (not by topic) also finds tombstones for resurrection.
    const probe = planImport(rows, topic.id, new Map(), now)
    const ids = probe.toAdd.map((n) => n.id)
    const stored = await db.notes.bulkGet(ids)
    const existing = new Map<string, Note>()
    for (const note of stored) if (note) existing.set(note.id, note)

    const plan = planImport(rows, topic.id, existing, now)

    await db.notes.bulkPut([...plan.toAdd, ...plan.toUpdate])
    const newCards = plan.toAdd.map((note) => emptyCardRow(note, now))

    const updatedIds = plan.toUpdate.map((n) => n.id)
    const cards = await db.cards.bulkGet(updatedIds)
    plan.toUpdate.forEach((note, i) => {
      if (!cards[i]) newCards.push(emptyCardRow(note, now))
    })
    await db.cards.bulkAdd(newCards)

    return summarize(plan, invalidCount)
  })
}
