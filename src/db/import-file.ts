/**
 * Merges a backup file into the database: the file is read part by part (never
 * whole), the parts are regrouped into batches of tens of thousands of rows, and
 * each batch is one `importBackup` transaction. The merge is per row and
 * idempotent, so stopping half-way (a closed tab, a full disk) leaves a
 * consistent database and running the same import again finishes it.
 */
import {
  PartBatcher,
  addMergeStats,
  emptyMergeStats,
  readBackupFile,
  type BackupFileInfo,
  type MergeStats,
  type ReadOptions,
} from "@/lib/backup"

import { importBackup } from "./repo"

export async function importBackupFile(
  file: Blob,
  options: ReadOptions = {}
): Promise<{ stats: MergeStats; info: BackupFileInfo }> {
  let stats = emptyMergeStats()
  const batcher = new PartBatcher()
  const info = await readBackupFile(
    file,
    async (part) => {
      const full = batcher.add(part)
      if (full) stats = addMergeStats(stats, await importBackup(full))
    },
    options
  )
  const rest = batcher.flush()
  if (rest) stats = addMergeStats(stats, await importBackup(rest))
  return { stats, info }
}
