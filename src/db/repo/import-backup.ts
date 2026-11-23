import { base64ToBytes } from "@/lib/image"
import type { MergeStats } from "@/lib/backup"

import { MERGE_TABLES, planMerge, type IncomingBackup } from "../backup-local"
import { db } from "../database"
import { emptyCardRow } from "../scheduler"

/**
 * Merges a parsed backup into the database in one transaction (see
 * `mergeBackup` for the rules) and writes only the rows that changed. A live
 * note that ends up without a card gets a fresh one, so nothing is unstudyable.
 * Images are content addressed, so only the ones this device lacks are added.
 */
export async function importBackup(
  incoming: IncomingBackup
): Promise<MergeStats> {
  return db.transaction("rw", MERGE_TABLES, async () => {
    const {
      result: { merged, write, stats },
      newImages,
      newSettings,
    } = await planMerge(incoming)

    const haveCard = new Set(merged.cards.map((c) => c.cardId))
    // A stand-in card for a note that has none (its card may arrive in a later
    // part of the same sync). It is stamped with time 0, so a real card, which
    // always has a later `updatedAt`, replaces it; stamped with `now` it would
    // win against the real card of a never-reviewed question and the two
    // devices would end with different creation times (which order new cards).
    const repaired = merged.notes
      .filter((n) => n.deletedAt === null && !haveCard.has(n.id))
      .map((n) => emptyCardRow(n, 0))

    await db.settings.bulkPut(newSettings)
    await db.decks.bulkPut(write.decks)
    await db.notes.bulkPut(write.notes)
    await db.cards.bulkPut([...write.cards, ...repaired])
    await db.revlog.bulkPut(write.revlog)
    await db.images.bulkPut(
      newImages.map((image) => ({
        id: image.id,
        mime: image.mime,
        width: image.width,
        height: image.height,
        blob: new Blob([base64ToBytes(image.data)], { type: image.mime }),
      }))
    )
    return {
      ...stats,
      imagesAdded: newImages.length,
      settingsUpdated: newSettings.length,
    }
  })
}

/**
 * Empties every table (decks, questions, cards, reviews, pictures, settings).
 * Only for putting a saved copy back (see `restoreSnapshot`): the copy is
 * merged into the empty database right after, which reproduces it exactly.
 */
export async function clearAllData(): Promise<void> {
  await db.transaction("rw", MERGE_TABLES, async () => {
    await Promise.all(MERGE_TABLES.map((table) => table.clear()))
  })
}
