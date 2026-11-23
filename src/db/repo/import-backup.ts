import { mergeBackup, type MergeStats } from "@/lib/backup"

import { db } from "../database"
import { emptyCardRow } from "../scheduler"
import type { BackupFile } from "../types"

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
