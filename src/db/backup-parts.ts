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
 */
import { BACKUP_APP, BACKUP_SCHEMA_VERSION } from "@/lib/backup"
import { bytesToBase64, imageIdsInNotes } from "@/lib/image"
import { PART_ROWS, pagesOf, type RowCounts } from "@/lib/sync"

import { db } from "./database"
import type {
  BackupFile,
  BackupImage,
  CardRow,
  ImageRow,
  Note,
  RevlogRow,
} from "./types"

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

export async function imageToBackup(row: ImageRow): Promise<BackupImage> {
  return {
    id: row.id,
    mime: row.mime,
    width: row.width,
    height: row.height,
    data: bytesToBase64(new Uint8Array(await row.blob.arrayBuffer())),
  }
}

/** How many rows each table holds; equal on two devices after a sync. */
export async function countRows(): Promise<RowCounts> {
  return db.transaction(
    "r",
    [db.decks, db.notes, db.cards, db.revlog],
    async () => ({
      decks: await db.decks.count(),
      notes: await db.notes.count(),
      cards: await db.cards.count(),
      reviews: await db.revlog.count(),
    })
  )
}

const union = (a: string[], b: string[]): string[] =>
  [...new Set([...a, ...b])].sort()

function compact<T>(rows: (T | undefined)[]): T[] {
  return rows.filter((row): row is T => row !== undefined)
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
  const decks = (await db.decks.toArray()).filter(
    (d) => newer(d.updatedAt) || newer(d.deletedAt)
  )
  const settings = (await db.settings.toArray()).filter((s) =>
    newer(s.updatedAt)
  )
  if (decks.length > 0 || settings.length > 0) {
    yield partOf(now, { decks, settings })
  }

  // Notes. The ids of images they use are remembered for the delta's images.
  const usedImages = new Set<string>()
  const noteIds = everything
    ? null
    : union(
        (await db.notes
          .where("contentUpdatedAt")
          .above(from)
          .primaryKeys()) as string[],
        (await db.notes
          .where("deletedAt")
          .above(from)
          .primaryKeys()) as string[]
      )
  const takeNotes = async (notes: Note[]) => {
    for (const id of imageIdsInNotes(notes)) usedImages.add(id)
    return notes
  }
  if (noteIds === null) {
    let last: string | undefined
    for (;;) {
      const query =
        last === undefined
          ? db.notes.orderBy(":id")
          : db.notes.where(":id").above(last)
      const notes = await query.limit(PART_ROWS.notes).toArray()
      if (notes.length === 0) break
      last = notes[notes.length - 1].id
      yield partOf(now, { notes: await takeNotes(notes) })
    }
  } else {
    for (const ids of pagesOf(noteIds, PART_ROWS.notes)) {
      const notes = compact(await db.notes.bulkGet(ids))
      if (notes.length > 0) yield partOf(now, { notes: await takeNotes(notes) })
    }
  }

  // Cards.
  const cardIds = everything
    ? null
    : union(
        (await db.cards
          .where("updatedAt")
          .above(from)
          .primaryKeys()) as string[],
        (await db.cards.where("markedAt").above(from).primaryKeys()) as string[]
      )
  if (cardIds === null) {
    let last: string | undefined
    for (;;) {
      const query =
        last === undefined
          ? db.cards.orderBy(":id")
          : db.cards.where(":id").above(last)
      const cards: CardRow[] = await query.limit(PART_ROWS.cards).toArray()
      if (cards.length === 0) break
      last = cards[cards.length - 1].cardId
      yield partOf(now, { cards })
    }
  } else {
    for (const ids of pagesOf(cardIds, PART_ROWS.cards)) {
      const cards = compact(await db.cards.bulkGet(ids))
      if (cards.length > 0) yield partOf(now, { cards })
    }
  }

  // Reviews (never edited, so "newer" is simply "recorded after").
  if (everything) {
    let last: string | undefined
    for (;;) {
      const query =
        last === undefined
          ? db.revlog.orderBy(":id")
          : db.revlog.where(":id").above(last)
      const revlog: RevlogRow[] = await query.limit(PART_ROWS.revlog).toArray()
      if (revlog.length === 0) break
      last = revlog[revlog.length - 1].id
      yield partOf(now, { revlog })
    }
  } else {
    const ids = (await db.revlog
      .where("reviewedAt")
      .above(from)
      .primaryKeys()) as string[]
    for (const page of pagesOf(ids, PART_ROWS.revlog)) {
      const revlog = compact(await db.revlog.bulkGet(page))
      if (revlog.length > 0) yield partOf(now, { revlog })
    }
  }

  // Images: those the sent notes use (a device that already has one ignores it),
  // or all of them in a full sync.
  const imageIds = everything
    ? ((await db.images.toCollection().primaryKeys()) as string[])
    : [...usedImages]
  for (const ids of pagesOf(imageIds, PART_ROWS.images)) {
    const rows = compact(await db.images.bulkGet(ids))
    if (rows.length === 0) continue
    yield partOf(now, { images: await Promise.all(rows.map(imageToBackup)) })
  }
}
