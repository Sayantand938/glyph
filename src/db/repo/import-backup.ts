import { base64ToBytes } from "@/lib/image"
import { mergeBackup, missingImages, type MergeStats } from "@/lib/backup"
import { mergeSettings } from "@/lib/settings"

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
    Partial<Pick<BackupFile, "images" | "settings">>
): Promise<MergeStats> {
  return db.transaction(
    "rw",
    [db.decks, db.notes, db.cards, db.revlog, db.images, db.settings],
    async () => {
      // Only the local rows the incoming ones can meet (by id), not the whole
      // database: a merge of a few changed rows must not read every review.
      // Decks are few and are read whole. A card is read for every incoming
      // note too, so a moved note can bring its card's topic along.
      const noteIds = new Set([
        ...incoming.notes.map((n) => n.id),
        ...incoming.cards.map((c) => c.noteId),
      ])
      const cardIds = new Set([
        ...incoming.cards.map((c) => c.cardId),
        ...incoming.notes.map((n) => n.id),
      ])
      const present = <T>(rows: (T | undefined)[]): T[] =>
        rows.filter((row): row is T => row !== undefined)
      const local = {
        decks: await db.decks.toArray(),
        notes: present(await db.notes.bulkGet([...noteIds])),
        cards: present(await db.cards.bulkGet([...cardIds])),
        revlog: present(
          await db.revlog.bulkGet(incoming.revlog.map((r) => r.id))
        ),
      }
      const { merged, write, stats } = mergeBackup(local, incoming)

      const haveCard = new Set(merged.cards.map((c) => c.cardId))
      // A stand-in card for a note that has none (its card may arrive in a later
      // part of the same sync). It is stamped with time 0, so a real card, which
      // always has a later `updatedAt`, replaces it; stamped with `now` it would
      // win against the real card of a never-reviewed question and the two
      // devices would end with different creation times (which order new cards).
      const repaired = merged.notes
        .filter((n) => n.deletedAt === null && !haveCard.has(n.id))
        .map((n) => emptyCardRow(n, 0))

      const newImages = missingImages(
        await db.images.toCollection().primaryKeys(),
        incoming.images ?? []
      )

      // Settings merge key by key, the newer change winning.
      const { write: newSettings } = mergeSettings(
        await db.settings.toArray(),
        incoming.settings ?? []
      )

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
    }
  )
}
