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
import type { SqlRunner } from "./sql"
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
} from "./tables"
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

/**
 * Reads through `tx`, so it sees the same snapshot the merge then writes to.
 * Only the local rows the incoming ones can meet (by id)
 * are read, not the whole database: a merge of a few changed rows must not
 * read every review. Decks are few and are read whole. A card is read for every
 * incoming note too, so a moved note can bring its card's topic along.
 */
export async function planMerge(
  tx: SqlRunner,
  incoming: IncomingBackup
): Promise<MergePlan> {
  const noteIds = new Set([
    ...incoming.notes.map((n) => n.id),
    ...incoming.cards.map((c) => c.noteId),
  ])
  const cardIds = new Set([
    ...incoming.cards.map((c) => c.cardId),
    ...incoming.notes.map((n) => n.id),
  ])
  const local = {
    decks: await allRows(tx, DECKS),
    notes: await getRows(tx, NOTES, [...noteIds]),
    cards: await getRows(tx, CARDS, [...cardIds]),
    revlog: await getRows(
      tx,
      REVLOG,
      incoming.revlog.map((r) => r.id)
    ),
  }
  const result = mergeBackup(local, incoming)
  const newImages = missingImages(
    await allKeys(tx, IMAGES),
    incoming.images ?? []
  )
  // Settings merge key by key, the newer change winning.
  const { write: newSettings } = mergeSettings(
    await allRows(tx, SETTINGS),
    incoming.settings ?? []
  )
  return { result, newImages, newSettings }
}

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
  return db.transaction(async (tx) => {
    const { result, newImages, newSettings } = await planMerge(tx, incoming)
    return {
      ...result.stats,
      imagesAdded: newImages.length,
      settingsUpdated: newSettings.length,
    }
  })
}
