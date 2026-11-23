/**
 * Makes a backup file from the database: every table in parts (see
 * `readBackupParts`), written as a gzipped stream, then read back and checked
 * before it is handed over, so a file that was not written whole is caught here
 * and not on the day it is needed.
 */
import {
  backupFileBlob,
  canCompress,
  readBackupFile,
  type BackupFileInfo,
} from "@/lib/backup"

import { readBackupParts } from "./backup-parts"

export interface MadeBackup {
  blob: Blob
  compressed: boolean
  info: BackupFileInfo
  now: number
}

export async function makeBackupFile(now = Date.now()): Promise<MadeBackup> {
  const compressed = canCompress()
  const blob = await backupFileBlob(readBackupParts(null), now, {
    compress: compressed,
  })
  const info = await readBackupFile(blob)
  return { blob, compressed, info, now }
}
