import type { BackupFile, BackupImage } from "@/db/types"

import { BACKUP_APP, BACKUP_SCHEMA_VERSION, type BackupData } from "./types"

/**
 * Builds the backup envelope. Tombstones are included so deletions propagate.
 * `images` should hold only the images that notes use.
 */
export function exportBackup(
  data: BackupData,
  now: number,
  images: BackupImage[] = []
): BackupFile {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    decks: data.decks,
    notes: data.notes,
    cards: data.cards,
    revlog: data.revlog,
    images,
  }
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file)
}

/** "mcq-backup-YYYY-MM-DD.json" using the local date. */
export function backupFilename(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `mcq-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}
