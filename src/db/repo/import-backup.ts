import { base64ToBytes } from "@/lib/image"
import { mergeBackup, missingImages, type MergeStats } from "@/lib/backup"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { BackupFile } from "../types"

/**
 * Merges a parsed backup into the database in one transaction (see
 * `mergeBackup` for the rules) and writes only the rows that changed. A live
 * note that ends up without a card gets a fresh one, so nothing is unstudyable.
 * Images are content addressed, so only the ones this device lacks are added.
 */
export async function importBackup(
  incoming: Pick<BackupFile, "decks" | "notes" | "cards" | "revlog"> &
    Partial<Pick<BackupFile, "images">>,
  now = Date.now()
): Promise<MergeStats> {
  return db.transaction(
    "rw",
    [db.decks, db.notes, db.cards, db.revlog, db.images],
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

      const newImages = missingImages(
        await db.images.toCollection().primaryKeys(),
        incoming.images ?? []
      )

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
      return { ...stats, imagesAdded: newImages.length }
    }
  )
}
