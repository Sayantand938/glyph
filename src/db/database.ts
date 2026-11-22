import Dexie, { type Table } from "dexie"

import { seedIfEmpty } from "./seed"
import type { CardRow, Deck, Note, RevlogRow } from "./types"

export class GlyphDB extends Dexie {
  decks!: Table<Deck, string>
  notes!: Table<Note, string>
  cards!: Table<CardRow, string>
  revlog!: Table<RevlogRow, string>

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
