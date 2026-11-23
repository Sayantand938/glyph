/**
 * Groups the small parts of a backup file back into bigger merges. Every
 * `importBackup` is one transaction and one commit, and every commit makes the
 * screen's live queries run again; on a database with hundreds of thousands of
 * reviews that is what a part-by-part import spends its time on. Merging in
 * batches of tens of thousands of rows keeps the memory bounded and the number
 * of commits small. Pure.
 */
import type { BackupFile } from "@/db/types"

/** Rows (a picture counts as `IMAGE_WEIGHT` rows) that make a batch. */
export const BATCH_ROWS = 30_000
const IMAGE_WEIGHT = 500

function weight(part: BackupFile): number {
  return (
    part.decks.length +
    part.notes.length +
    part.cards.length +
    part.revlog.length +
    part.settings.length +
    part.images.length * IMAGE_WEIGHT
  )
}

/** All the tables of two backups joined (the later one's envelope wins). */
export function concatBackups(a: BackupFile, b: BackupFile): BackupFile {
  return {
    ...b,
    decks: a.decks.concat(b.decks),
    notes: a.notes.concat(b.notes),
    cards: a.cards.concat(b.cards),
    revlog: a.revlog.concat(b.revlog),
    images: a.images.concat(b.images),
    settings: a.settings.concat(b.settings),
  }
}

export class PartBatcher {
  private batch: BackupFile | null = null
  private rows = 0

  constructor(private readonly limit = BATCH_ROWS) {}

  /**
   * Adds a part. Returns the batch to merge now when adding this part would
   * make it too big (this part then starts the next batch), else null.
   */
  add(part: BackupFile): BackupFile | null {
    const size = weight(part)
    let full: BackupFile | null = null
    if (this.batch && this.rows + size > this.limit) {
      full = this.batch
      this.batch = null
      this.rows = 0
    }
    this.batch = this.batch ? concatBackups(this.batch, part) : part
    this.rows += size
    return full
  }

  /** What is left at the end of the file. */
  flush(): BackupFile | null {
    const rest = this.batch
    this.batch = null
    this.rows = 0
    return rest
  }
}
