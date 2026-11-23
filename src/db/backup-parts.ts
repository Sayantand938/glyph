/**
 * Read-only: the data of a backup in small parts, for device sync (and any other
 * format that streams). Each part is a complete `BackupFile` with only some
 * tables filled, so every part goes through the same `parseBackup` validation
 * and `importBackup` merge as a whole file, and merging parts one after another
 * gives the same result as merging the whole backup (the merge is per row and
 * idempotent). Nothing here ever holds more than one part's rows.
 *
 * Order matters to the receiver: decks and settings first, then notes, then
 * cards (a card whose note is missing is dropped by the merge), then reviews,
 * then images.
 *
 * Each part is read in its own short transaction, so a long export never blocks
 * the study session's writes for more than one part.
 */
import { BACKUP_APP, BACKUP_SCHEMA_VERSION } from "@/lib/backup"
import { imageIdsInNotes } from "@/lib/image"
import {
  DigestBuilder,
  PART_ROWS,
  cardStamp,
  deckStamp,
  idStamp,
  noteStamp,
  pagesOf,
  settingStamp,
  type SyncDigests,
} from "@/lib/sync"

import { db } from "./database"
import {
  CARDS,
  DECKS,
  IMAGES,
  NOTES,
  REVLOG,
  SETTINGS,
  allKeys,
  allRows,
  getRows,
  tablePages,
} from "./tables"
import type { BackupFile, BackupImage, ImageRow } from "./types"

type Tables = Pick<
  BackupFile,
  "decks" | "notes" | "cards" | "revlog" | "images" | "settings"
>

function partOf(now: number, tables: Partial<Tables>): BackupFile {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    decks: [],
    notes: [],
    cards: [],
    revlog: [],
    images: [],
    settings: [],
    ...tables,
  }
}

/** A stored picture as a backup carries it (the same fields, base64 data). */
export function imageToBackup(row: ImageRow): BackupImage {
  return {
    id: row.id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    data: row.data,
  }
}

/** Rows per page when the digests walk a table. */
const DIGEST_PAGE = 5000

/**
 * A fingerprint of every table (see `SyncDigests`), equal on two devices after a
 * sync. It reads the stamps of every row, tombstones included, one page at a
 * time (never the whole table in memory); reviews are read by key only. The
 * `images` digest covers the pictures that live notes use and this device
 * holds, so a picture that never arrived shows as a difference.
 */
export async function computeDigests(): Promise<SyncDigests> {
  return db.transaction(async (tx) => {
    const decks = new DigestBuilder()
    const notes = new DigestBuilder()
    const cards = new DigestBuilder()
    const reviews = new DigestBuilder()
    const settings = new DigestBuilder()
    const images = new DigestBuilder()

    for await (const page of tablePages(tx, DECKS, DIGEST_PAGE)) {
      for (const deck of page) decks.add(deckStamp(deck))
    }
    const referenced = new Set<string>()
    for await (const page of tablePages(tx, NOTES, DIGEST_PAGE)) {
      for (const note of page) {
        notes.add(noteStamp(note))
        if (note.deletedAt === null) {
          for (const id of imageIdsInNotes([note])) referenced.add(id)
        }
      }
    }
    for await (const page of tablePages(tx, CARDS, DIGEST_PAGE)) {
      for (const card of page) cards.add(cardStamp(card))
    }
    for (const id of await allKeys(tx, REVLOG)) reviews.add(idStamp(id))
    for (const row of await allRows(tx, SETTINGS)) {
      settings.add(settingStamp(row))
    }
    if (referenced.size > 0) {
      const held = new Set(await allKeys(tx, IMAGES))
      for (const id of referenced) if (held.has(id)) images.add(idStamp(id))
    }

    return {
      decks: decks.result(),
      notes: notes.result(),
      cards: cards.result(),
      reviews: reviews.result(),
      settings: settings.result(),
      images: images.result(),
    }
  })
}

const union = (a: string[], b: string[]): string[] =>
  [...new Set([...a, ...b])].sort()

async function idsWhere(sql: string, params: (string | number)[]) {
  const rows = await db.select(sql, params)
  return rows.map((row) => String(row.k))
}

/**
 * Yields the parts of a backup: every row when `since` is null, otherwise only
 * rows that changed after `since` (see `lib/sync/delta.ts` for what changed
 * means for each table). Empty parts are skipped.
 */
export async function* readBackupParts(
  since: number | null
): AsyncGenerator<BackupFile> {
  const now = Date.now()
  const everything = since === null
  const from = since ?? 0
  const newer = (at: number | null | undefined) =>
    everything || (typeof at === "number" && at > from)

  // Decks and settings are tiny: one part.
  const decks = (await db.transaction((tx) => allRows(tx, DECKS))).filter(
    (d) => newer(d.updatedAt) || newer(d.deletedAt)
  )
  const settings = (await db.transaction((tx) => allRows(tx, SETTINGS))).filter(
    (s) => newer(s.updatedAt)
  )
  if (decks.length > 0 || settings.length > 0) {
    yield partOf(now, { decks, settings })
  }

  // Notes. The ids of images they use are remembered for the delta's images.
  const usedImages = new Set<string>()
  if (everything) {
    let last: string | null = null
    for (;;) {
      const page: BackupFile["notes"] = await db.transaction(async (tx) => {
        const rows =
          last === null
            ? await tx.select("SELECT * FROM notes ORDER BY id LIMIT ?", [
                PART_ROWS.notes,
              ])
            : await tx.select(
                "SELECT * FROM notes WHERE id > ? ORDER BY id LIMIT ?",
                [last, PART_ROWS.notes]
              )
        return rows.map(NOTES.fromRow)
      })
      if (page.length === 0) break
      last = page[page.length - 1].id
      for (const id of imageIdsInNotes(page)) usedImages.add(id)
      yield partOf(now, { notes: page })
    }
  } else {
    const noteIds = union(
      await idsWhere("SELECT id AS k FROM notes WHERE contentUpdatedAt > ?", [
        from,
      ]),
      await idsWhere("SELECT id AS k FROM notes WHERE deletedAt > ?", [from])
    )
    for (const ids of pagesOf(noteIds, PART_ROWS.notes)) {
      const notes = await db.transaction((tx) => getRows(tx, NOTES, ids))
      if (notes.length === 0) continue
      for (const id of imageIdsInNotes(notes)) usedImages.add(id)
      yield partOf(now, { notes })
    }
  }

  // Cards.
  if (everything) {
    let last: string | null = null
    for (;;) {
      const page: BackupFile["cards"] = await db.transaction(async (tx) => {
        const rows =
          last === null
            ? await tx.select("SELECT * FROM cards ORDER BY cardId LIMIT ?", [
                PART_ROWS.cards,
              ])
            : await tx.select(
                "SELECT * FROM cards WHERE cardId > ? ORDER BY cardId LIMIT ?",
                [last, PART_ROWS.cards]
              )
        return rows.map(CARDS.fromRow)
      })
      if (page.length === 0) break
      last = page[page.length - 1].cardId
      yield partOf(now, { cards: page })
    }
  } else {
    const cardIds = union(
      await idsWhere("SELECT cardId AS k FROM cards WHERE updatedAt > ?", [
        from,
      ]),
      await idsWhere("SELECT cardId AS k FROM cards WHERE markedAt > ?", [from])
    )
    for (const ids of pagesOf(cardIds, PART_ROWS.cards)) {
      const cards = await db.transaction((tx) => getRows(tx, CARDS, ids))
      if (cards.length > 0) yield partOf(now, { cards })
    }
  }

  // Reviews (never edited, so "newer" is simply "recorded after").
  if (everything) {
    let last: string | null = null
    for (;;) {
      const page: BackupFile["revlog"] = await db.transaction(async (tx) => {
        const rows =
          last === null
            ? await tx.select("SELECT * FROM revlog ORDER BY id LIMIT ?", [
                PART_ROWS.revlog,
              ])
            : await tx.select(
                "SELECT * FROM revlog WHERE id > ? ORDER BY id LIMIT ?",
                [last, PART_ROWS.revlog]
              )
        return rows.map(REVLOG.fromRow)
      })
      if (page.length === 0) break
      last = page[page.length - 1].id
      yield partOf(now, { revlog: page })
    }
  } else {
    const ids = await idsWhere(
      "SELECT id AS k FROM revlog WHERE reviewedAt > ?",
      [from]
    )
    for (const page of pagesOf(ids, PART_ROWS.revlog)) {
      const revlog = await db.transaction((tx) => getRows(tx, REVLOG, page))
      if (revlog.length > 0) yield partOf(now, { revlog })
    }
  }

  // Images: those the sent notes use (a device that already has one ignores it),
  // or all of them in a full sync.
  const imageIds = everything
    ? await db.transaction((tx) => allKeys(tx, IMAGES))
    : [...usedImages]
  for (const ids of pagesOf(imageIds, PART_ROWS.images)) {
    const rows = await db.transaction((tx) => getRows(tx, IMAGES, ids))
    if (rows.length > 0) yield partOf(now, { images: rows.map(imageToBackup) })
  }
}
