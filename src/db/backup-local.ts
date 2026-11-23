/**
 * Reads what a backup would meet in this database and works out the merge,
 * without writing anything. `importBackup` (repo) applies the result in the same
 * transaction; `previewBackup` only reports it.
 */
import {
  mergeBackup,
  missingImages,
  type MergeResult,
  type MergeStats,
} from "@/lib/backup"
import { mergeSettings } from "@/lib/settings"

import { db } from "./database"
import type { BackupFile, ImageRow, SettingRow } from "./types"

export type IncomingBackup = Pick<
  BackupFile,
  "decks" | "notes" | "cards" | "revlog"
> &
  Partial<Pick<BackupFile, "images" | "settings">>

export interface MergePlan {
  result: MergeResult
  newImages: NonNullable<IncomingBackup["images"]>
  newSettings: SettingRow[]
}

const present = <T>(rows: (T | undefined)[]): T[] =>
  rows.filter((row): row is T => row !== undefined)

/**
 * Must run inside a transaction that includes decks, notes, cards, revlog,
 * images and settings. Only the local rows the incoming ones can meet (by id)
 * are read, not the whole database: a merge of a few changed rows must not
 * read every review. Decks are few and are read whole. A card is read for every
 * incoming note too, so a moved note can bring its card's topic along.
 */
export async function planMerge(incoming: IncomingBackup): Promise<MergePlan> {
  const noteIds = new Set([
    ...incoming.notes.map((n) => n.id),
    ...incoming.cards.map((c) => c.noteId),
  ])
  const cardIds = new Set([
    ...incoming.cards.map((c) => c.cardId),
    ...incoming.notes.map((n) => n.id),
  ])
  const local = {
    decks: await db.decks.toArray(),
    notes: present(await db.notes.bulkGet([...noteIds])),
    cards: present(await db.cards.bulkGet([...cardIds])),
    revlog: present(await db.revlog.bulkGet(incoming.revlog.map((r) => r.id))),
  }
  const result = mergeBackup(local, incoming)
  const newImages = missingImages(
    await db.images.toCollection().primaryKeys(),
    incoming.images ?? []
  )
  // Settings merge key by key, the newer change winning.
  const { write: newSettings } = mergeSettings(
    await db.settings.toArray(),
    incoming.settings ?? []
  )
  return { result, newImages, newSettings }
}

export const MERGE_TABLES = [
  db.decks,
  db.notes,
  db.cards,
  db.revlog,
  db.images,
  db.settings,
]

export type { ImageRow }

/**
 * What importing this backup would change (the stats `importBackup` would
 * return), without writing. Give it the whole file's rows in one piece: parts
 * previewed one by one cannot see each other (a card whose note is in another
 * part would look dropped).
 */
export async function previewBackup(
  incoming: IncomingBackup
): Promise<MergeStats> {
  return db.transaction("r", MERGE_TABLES, async () => {
    const { result, newImages, newSettings } = await planMerge(incoming)
    return {
      ...result.stats,
      imagesAdded: newImages.length,
      settingsUpdated: newSettings.length,
    }
  })
}
