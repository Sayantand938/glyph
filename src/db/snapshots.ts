/**
 * Copies of the whole database taken just before a file import, kept in the
 * browser's origin-private file system (not visible as files, not part of a
 * backup or a sync) so an import can be undone. Browser only.
 *
 * A copy is a backup file (the same checked stream a manual export writes) and
 * a small JSON description with the fingerprint of every table, so that after
 * putting a copy back the result can be proven identical to what it was.
 */
import {
  KEEP_SNAPSHOTS,
  parseSnapshotMeta,
  readBackupFile,
  snapshotFileName,
  snapshotMetaName,
  snapshotsToDelete,
  type SnapshotMeta,
} from "@/lib/backup"
import { digestsEqual, parseDigests } from "@/lib/sync"

import { makeBackupFile } from "./backup-file"
import { computeDigests } from "./backup-parts"
import { importBackupFile } from "./import-file"
import { clearAllData } from "./repo"

const DIR = "import-snapshots"

type Directory = FileSystemDirectoryHandle

/** The private file system can hold a copy (not every browser can write it). */
export function snapshotsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  )
}

async function directory(): Promise<Directory> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIR, { create: true })
}

async function names(dir: Directory): Promise<string[]> {
  const out: string[] = []
  // `keys()` is in every browser that has the private file system, but not in
  // TypeScript's DOM types yet.
  const keys = (dir as unknown as { keys(): AsyncIterable<string> }).keys()
  for await (const name of keys) out.push(name)
  return out
}

async function write(dir: Directory, name: string, data: Blob | string) {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

async function prune(dir: Directory, protect: number | null): Promise<void> {
  for (const name of snapshotsToDelete(
    await names(dir),
    KEEP_SNAPSHOTS,
    protect
  )) {
    try {
      await dir.removeEntry(name)
    } catch {
      // Could not delete an old copy: leave it for next time.
    }
  }
}

/**
 * Saves a copy of the current data. `reason` says why ("before importing
 * x.glyph"). `protect` is a copy that must survive the clean-up.
 */
export async function saveSnapshot(
  reason: string,
  protect: number | null = null
): Promise<SnapshotMeta> {
  const dir = await directory()
  const made = await makeBackupFile()
  const digests = await computeDigests()
  const file = snapshotFileName(made.now, made.compressed)
  await write(dir, file, made.blob)
  const meta: SnapshotMeta = {
    at: made.now,
    file,
    bytes: made.blob.size,
    reason,
    notes: made.info.rows.notes,
    reviews: made.info.rows.revlog,
    digests,
  }
  await write(dir, snapshotMetaName(made.now), JSON.stringify(meta))
  await prune(dir, protect)
  return meta
}

/** The saved copies, newest first. */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  if (!snapshotsSupported()) return []
  try {
    const dir = await directory()
    const metas: SnapshotMeta[] = []
    for (const name of await names(dir)) {
      if (!name.endsWith(".json")) continue
      const file = await (await dir.getFileHandle(name)).getFile()
      const meta = parseSnapshotMeta(await file.text())
      if (meta) metas.push(meta)
    }
    return metas.sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export async function deleteSnapshot(meta: SnapshotMeta): Promise<void> {
  const dir = await directory()
  for (const name of [meta.file, snapshotMetaName(meta.at)]) {
    try {
      await dir.removeEntry(name)
    } catch {
      // Already gone.
    }
  }
}

export interface RestoreResult {
  notes: number
  reviews: number
  /** True when the fingerprints of every table equal those taken with the copy. */
  verified: boolean
  /** The copy of the data as it was just before the restore (to undo it). */
  undoneBy: SnapshotMeta
}

/**
 * Puts a saved copy back, replacing everything on this device. First the file
 * is checked whole (nothing is touched if it is damaged), then the current data
 * is saved as a new copy (so the restore itself can be undone), then the tables
 * are emptied and the copy merged into them. Finally the fingerprints are
 * compared with those taken when the copy was made.
 */
export async function restoreSnapshot(
  meta: SnapshotMeta
): Promise<RestoreResult> {
  const dir = await directory()
  const file = await (await dir.getFileHandle(meta.file)).getFile()
  await readBackupFile(file)

  const undoneBy = await saveSnapshot(
    "before putting back an older copy",
    meta.at
  )
  await clearAllData()
  const { info } = await importBackupFile(file)

  const expected = parseDigests(meta.digests)
  const verified =
    expected !== null && digestsEqual(await computeDigests(), expected)
  return {
    notes: info.rows.notes,
    reviews: info.rows.revlog,
    verified,
    undoneBy,
  }
}
