import {
  planImport,
  summarize,
  type ImportSummary,
  type ValidRow,
} from "@/lib/importer"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import { CARDS, NOTES, addRows, getRows, putNotes } from "../tables"
import type { Note } from "../types"
import { resolveOrCreatePath } from "./decks"

export interface ImportTarget {
  /**
   * The deck to import into, as names from the top down ("WBCS", "Mains",
   * "2018"). Each name reuses a live deck at that level (ignoring case and
   * spacing) or creates it, so any depth works.
   */
  path: readonly string[]
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
    const { deck: topic } = await resolveOrCreatePath(tx, target.path, now)

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
