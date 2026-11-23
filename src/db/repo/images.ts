import { imageIdsInNotes } from "@/lib/image"

import { db } from "../database"
import type { ImageRow } from "../types"

/**
 * Stores a pasted image. Idempotent: the id is a hash of the bytes, so putting
 * the same picture again just rewrites the same row.
 */
export async function addImage(image: ImageRow): Promise<void> {
  await db.images.put(image)
}

/**
 * Deletes images no note uses (tombstoned notes still count, so a restored
 * note keeps its pictures). Must run inside a transaction that includes
 * `notes` and `images`; `pruneImages` is the standalone version.
 */
export async function deleteOrphanImages(): Promise<number> {
  const used = imageIdsInNotes(await db.notes.toArray())
  const stored = await db.images.toCollection().primaryKeys()
  const orphans = stored.filter((id) => !used.has(id))
  if (orphans.length > 0) await db.images.bulkDelete(orphans)
  return orphans.length
}

/** Removes images that no note refers to, e.g. after a cancelled paste. */
export function pruneImages(): Promise<number> {
  return db.transaction("rw", [db.notes, db.images], deleteOrphanImages)
}
