import Dexie, { type Table } from "dexie"

import { marksOf, type CardMarks } from "@/lib/card-marks"

import { emptyCardRow } from "./scheduler"
import { seedIfEmpty } from "./seed"
import type {
  CardRow,
  Deck,
  ImageRow,
  Note,
  RevlogRow,
  SettingRow,
} from "./types"

export class GlyphDB extends Dexie {
  decks!: Table<Deck, string>
  notes!: Table<Note, string>
  cards!: Table<CardRow, string>
  revlog!: Table<RevlogRow, string>
  images!: Table<ImageRow, string>
  settings!: Table<SettingRow, string>

  constructor() {
    super("glyph")
    // Never edit version 1 after release; add db.version(n).upgrade() instead.
    this.version(1).stores({
      decks: "id, parentId, deletedAt",
      notes: "id, topicId, deletedAt",
      cards:
        "cardId, noteId, topicId, state, due, [topicId+state], [topicId+due]",
      revlog: "id, cardId, reviewedAt",
    })
    // Images pasted into notes; only adds a table, existing rows are untouched.
    this.version(2).stores({ images: "id" })
    // Tags on notes: `*tags` indexes each tag of a note (multi-entry), so the
    // notes with one tag are an index lookup. Notes from before get `tags: []`.
    this.version(3)
      .stores({ notes: "id, topicId, deletedAt, *tags" })
      .upgrade((tx) =>
        tx
          .table("notes")
          .toCollection()
          .modify((note: { tags?: string[] }) => {
            if (!Array.isArray(note.tags)) note.tags = []
          })
      )
    // Card marks (flag, suspend, bury): plain fields on the card row, filtered in
    // JS, so there is no new index. Cards from before are unmarked.
    this.version(4)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("cards")
          .toCollection()
          .modify((card: Partial<CardMarks>) => {
            Object.assign(card, marksOf(card))
          })
      )
    // Review log with complete rows (right/wrong, time to pick, state after).
    // Old rows can't be completed, so the log is cleared and every card goes
    // back to New (marks kept); questions, decks and tags are untouched.
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table("revlog").clear()
        const now = Date.now()
        await tx
          .table("cards")
          .toCollection()
          .modify((card: CardRow) => {
            Object.assign(
              card,
              emptyCardRow({ id: card.noteId, topicId: card.topicId }, now),
              marksOf(card),
              { cardId: card.cardId }
            )
          })
      })
    // Settings that sync with the data (retention, fitted weights, leech rule):
    // one row per key, so a backup can carry them. Only adds a table.
    this.version(6).stores({ settings: "key" })
  }
}

/** Safe to import during SSR: Dexie only touches IndexedDB when first queried. */
export const db = new GlyphDB()

let ready: Promise<void> | null = null

/**
 * Client-only startup: request persistent storage, then seed an empty database.
 * Idempotent; every caller shares one promise. A failure is not cached so a
 * later call can retry.
 */
export function initDatabase(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    try {
      await navigator.storage?.persist?.()
    } catch {
      // Result is ignored; persistence is best-effort.
    }
    await seedIfEmpty(db)
  })().catch((error: unknown) => {
    ready = null
    throw error
  })
  return ready
}
