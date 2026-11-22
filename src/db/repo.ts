/** All writes go through here, each in a single Dexie transaction. */
import { mergeBackup, type MergeStats } from "@/lib/backup"
import {
  deckNameKey,
  planImport,
  summarize,
  type DeckRef,
  type ImportSummary,
  type ValidRow,
} from "@/lib/importer"

import { db } from "./database"
import { emptyCardRow, grade, type Grade } from "./scheduler"
import type { BackupFile, CardRow, Deck, Note, RevlogRow } from "./types"

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

/**
 * Merges a parsed backup into the database in one transaction (see
 * `mergeBackup` for the rules) and writes only the rows that changed. A live
 * note that ends up without a card gets a fresh one, so nothing is unstudyable.
 */
export async function importBackup(
  incoming: Pick<BackupFile, "decks" | "notes" | "cards" | "revlog">,
  now = Date.now()
): Promise<MergeStats> {
  return db.transaction(
    "rw",
    [db.decks, db.notes, db.cards, db.revlog],
    async () => {
      const local = {
        decks: await db.decks.toArray(),
        notes: await db.notes.toArray(),
        cards: await db.cards.toArray(),
        revlog: await db.revlog.toArray(),
      }
      const { merged, write, stats } = mergeBackup(local, incoming)

      const haveCard = new Set(merged.cards.map((c) => c.cardId))
      const repaired = merged.notes
        .filter((n) => n.deletedAt === null && !haveCard.has(n.id))
        .map((n) => emptyCardRow(n, now))

      await db.decks.bulkPut(write.decks)
      await db.notes.bulkPut(write.notes)
      await db.cards.bulkPut([...write.cards, ...repaired])
      await db.revlog.bulkPut(write.revlog)
      return stats
    }
  )
}
