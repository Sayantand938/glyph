/**
 * What "only what changed" means for a sync between two devices. Pure (no DB, no
 * React, no storage).
 *
 * Every row carries the time it last changed (a note's `contentUpdatedAt` or
 * `deletedAt`, a card's `updatedAt` or `markedAt`, a review's `reviewedAt`, a
 * deck's or setting's `updatedAt`). A device remembers, per other device, when
 * their last complete sync started (a "mark"). The next sync sends only rows that
 * changed after that mark, less a safety overlap for clocks that disagree; the
 * merge is idempotent, so a row sent twice costs nothing.
 *
 * A mark is only trusted together with a check at the end of every sync: both
 * devices count their rows after merging and the counts must match. If they do
 * not (a clock set back, data wiped on one side, anything unforeseen) the sync
 * repeats once as a full sync, which sends everything.
 */

/** Rows changed this long before the mark are sent again, in case clocks differ. */
export const SYNC_OVERLAP_MS = 2 * 24 * 60 * 60 * 1000

/** How many rows of each kind make up one part on the wire (and in a zip entry). */
export const PART_ROWS = {
  decks: 5000,
  notes: 2000,
  cards: 5000,
  revlog: 10_000,
  /** Images are base64 blobs, so their parts are small. */
  images: 10,
  settings: 500,
} as const

/** How many rows of each table a device holds; equal on both sides after a sync. */
export interface RowCounts {
  decks: number
  notes: number
  cards: number
  reviews: number
}

export function countsEqual(a: RowCounts, b: RowCounts): boolean {
  return (
    a.decks === b.decks &&
    a.notes === b.notes &&
    a.cards === b.cards &&
    a.reviews === b.reviews
  )
}

/** Reads counts from a message; null when it is not four whole numbers. */
export function parseCounts(value: unknown): RowCounts | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  const keys = ["decks", "notes", "cards", "reviews"] as const
  for (const key of keys) {
    const n = v[key]
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null
  }
  return {
    decks: v.decks as number,
    notes: v.notes as number,
    cards: v.cards as number,
    reviews: v.reviews as number,
  }
}

/**
 * The time to send changes since, or null for "send everything": there is no
 * mark for this device yet, or the mark is not a usable time.
 */
export function deltaSince(mark: number | null | undefined): number | null {
  if (typeof mark !== "number" || !Number.isFinite(mark) || mark <= 0) {
    return null
  }
  return Math.max(0, mark - SYNC_OVERLAP_MS)
}

/** Marks by device id, as kept on this device. */
export type SyncMarks = Record<string, number>

/** Reads stored marks; anything malformed is dropped (that device syncs in full). */
export function parseMarks(text: string | null): SyncMarks {
  if (!text) return {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {}
  }
  const marks: SyncMarks = {}
  for (const [device, at] of Object.entries(data)) {
    if (typeof at === "number" && Number.isFinite(at) && at > 0) {
      marks[device] = at
    }
  }
  return marks
}

/** The marks with `device` set to `at` (never moves a mark backwards). */
export function withMark(
  marks: SyncMarks,
  device: string,
  at: number
): SyncMarks {
  return { ...marks, [device]: Math.max(at, marks[device] ?? 0) }
}

/** Splits a list into runs of at most `size` (at least one item each). */
export function pagesOf<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size))
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += step) {
    pages.push(items.slice(i, i + step))
  }
  return pages
}
