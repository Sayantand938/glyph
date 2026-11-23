/**
 * Names of the copies made just before a file import, so it can be undone.
 * Pure. A copy is a backup file (`snap-<time>.glyph`) plus a small description
 * (`snap-<time>.json`) in the browser's private file system.
 */

/** How many copies are kept. */
export const KEEP_SNAPSHOTS = 3

const NAME = /^snap-(\d{13,})\.(glyph|jsonl|json)$/

export function snapshotFileName(at: number, compressed: boolean): string {
  return `snap-${at}.${compressed ? "glyph" : "jsonl"}`
}

export function snapshotMetaName(at: number): string {
  return `snap-${at}.json`
}

/** The time in a snapshot file name, or null for any other file. */
export function snapshotTime(name: string): number | null {
  const match = NAME.exec(name)
  return match ? Number(match[1]) : null
}

/**
 * The file names to delete so that the `keep` newest copies remain (both files
 * of a copy go together). `protect` is a copy being restored right now: it is
 * never deleted and does not count toward `keep`.
 */
export function snapshotsToDelete(
  names: readonly string[],
  keep = KEEP_SNAPSHOTS,
  protect: number | null = null
): string[] {
  const times = [
    ...new Set(
      names
        .map(snapshotTime)
        .filter((t): t is number => t !== null && t !== protect)
    ),
  ].sort((a, b) => b - a)
  const drop = new Set(times.slice(Math.max(0, keep)))
  return names.filter((name) => {
    const t = snapshotTime(name)
    return t !== null && drop.has(t)
  })
}

/** What is known about a copy, kept next to it. */
export interface SnapshotMeta {
  at: number
  /** The backup file's name inside the private file system. */
  file: string
  bytes: number
  /** What was about to be imported ("my-backup.glyph"), or why the copy was made. */
  reason: string
  notes: number
  reviews: number
  /** Fingerprint of every table when the copy was made (see `SyncDigests`). */
  digests: unknown
}

export function parseSnapshotMeta(text: string): SnapshotMeta | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null) return null
  const m = data as Record<string, unknown>
  if (
    typeof m.at !== "number" ||
    typeof m.file !== "string" ||
    typeof m.bytes !== "number" ||
    typeof m.reason !== "string" ||
    typeof m.notes !== "number" ||
    typeof m.reviews !== "number"
  ) {
    return null
  }
  return {
    at: m.at,
    file: m.file,
    bytes: m.bytes,
    reason: m.reason,
    notes: m.notes,
    reviews: m.reviews,
    digests: m.digests ?? null,
  }
}
