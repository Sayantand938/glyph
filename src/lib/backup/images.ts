import type { BackupImage } from "@/db/types"

/**
 * The incoming images this device does not have yet. Images are content
 * addressed (the id is a hash of the bytes), so a stored image never changes
 * and "have it" means "up to date". Duplicates in `incoming` are kept once.
 */
export function missingImages(
  haveIds: Iterable<string>,
  incoming: readonly BackupImage[]
): BackupImage[] {
  const seen = new Set(haveIds)
  const out: BackupImage[] = []
  for (const image of incoming) {
    if (seen.has(image.id)) continue
    seen.add(image.id)
    out.push(image)
  }
  return out
}
