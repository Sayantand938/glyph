import { imageIdsInNotes } from "@/lib/image"

import { db } from "../database"
import type { SqlRunner } from "../sql"
import {
  IMAGES,
  NOTES,
  allKeys,
  deleteRows,
  putRows,
  queryRows,
} from "../tables"
import type { ImageRow } from "../types"

/**
 * Stores a pasted image. Idempotent: the id is a hash of the bytes, so putting
 * the same picture again just rewrites the same row.
 */
export async function addImage(image: ImageRow): Promise<void> {
  await db.transaction((tx) => putRows(tx, IMAGES, [image]))
}

/**
 * Deletes images no note uses (tombstoned notes still count, so a restored
 * note keeps its pictures). Run it inside the transaction of the write that
 * may have orphaned a picture; `pruneImages` is the standalone version.
 */
export async function deleteOrphanImages(tx: SqlRunner): Promise<number> {
  // Only notes that mention a picture can use one.
  const notes = await queryRows(
    tx,
    NOTES,
    "WHERE question LIKE '%img:%' OR options LIKE '%img:%' OR extra LIKE '%img:%'"
  )
  const used = imageIdsInNotes(notes)
  const orphans = (await allKeys(tx, IMAGES)).filter((id) => !used.has(id))
  await deleteRows(tx, IMAGES, orphans)
  return orphans.length
}

/** Removes images that no note refers to, e.g. after a cancelled paste. */
export function pruneImages(): Promise<number> {
  return db.transaction(deleteOrphanImages)
}
