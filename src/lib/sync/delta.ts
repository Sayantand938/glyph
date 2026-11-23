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
 * devices fingerprint their data after merging (`SyncDigests`: per table, the
 * row count and a hash of every row's id and change stamp) and the fingerprints
 * must match. If they do not (a clock set back, data wiped on one side, a row
 * that came from a third device or a restored backup and so carries an old
 * stamp, a picture that never arrived) the sync repeats once as a full sync,
 * which sends everything.
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

/**
 * A fingerprint of one table: how many rows it holds and an order-independent
 * hash of each row's id and change stamp (see the `*Stamp` functions). Two
 * devices that merged each other's data hold the same rows with the same
 * stamps, so the fingerprints match; a row that is missing, extra or changed
 * on one side (even when the row counts agree) makes them differ.
 */
export interface RowDigest {
  count: number
  /** 16 hex digits. */
  hash: string
}

/** The tables a sync compares, in the order a difference is reported. */
export const DIGEST_TABLES = [
  "decks",
  "notes",
  "cards",
  "reviews",
  "settings",
  "images",
] as const

export type DigestTable = (typeof DIGEST_TABLES)[number]

/** One fingerprint per table. `images` covers the pictures live notes use. */
export type SyncDigests = Record<DigestTable, RowDigest>

/** How a table is named to the person when a sync cannot make it match. */
export const DIGEST_LABELS: Record<DigestTable, string> = {
  decks: "subjects and topics",
  notes: "questions",
  cards: "card progress",
  reviews: "review history",
  settings: "settings",
  images: "pictures",
}

/** Two independent 32-bit hashes of a text (the core of cyrb53). */
function hashPair(text: string): [number, number] {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return [h1 >>> 0, h2 >>> 0]
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0")

/**
 * Builds a `RowDigest` from row stamps added in any order. Each stamp's hash is
 * added (mod 2^32, in two lanes) to the running total, so order does not matter
 * and nothing is kept per row: it is cheap for a hundred thousand rows.
 */
export class DigestBuilder {
  private count = 0
  private a = 0
  private b = 0

  add(stamp: string): void {
    const [x, y] = hashPair(stamp)
    this.a = (this.a + x) >>> 0
    this.b = (this.b + y) >>> 0
    this.count += 1
  }

  result(): RowDigest {
    return { count: this.count, hash: hex8(this.a) + hex8(this.b) }
  }
}

/** The digest of these stamps. */
export function digestOf(stamps: Iterable<string>): RowDigest {
  const builder = new DigestBuilder()
  for (const stamp of stamps) builder.add(stamp)
  return builder.result()
}

/**
 * What identifies one row for the digest: its id and the time(s) the merge
 * decides it by. Content is not hashed (a row with the same stamp but other
 * content cannot be healed by sending it again, the merge keeps the local copy),
 * so a digest mismatch always means "sending more can fix this".
 */
export const deckStamp = (d: {
  id: string
  updatedAt: number
  deletedAt: number | null
}) => `${d.id}|${d.updatedAt}|${d.deletedAt ?? ""}`

export const noteStamp = (n: {
  id: string
  contentUpdatedAt: number
  deletedAt: number | null
}) => `${n.id}|${n.contentUpdatedAt}|${n.deletedAt ?? ""}`

export const cardStamp = (c: {
  cardId: string
  lastReview: number
  updatedAt: number
  markedAt: number
}) => `${c.cardId}|${c.lastReview}|${c.updatedAt}|${c.markedAt}`

export const settingStamp = (s: { key: string; updatedAt: number }) =>
  `${s.key}|${s.updatedAt}`

/** Reviews and images are never edited, so their id says it all. */
export const idStamp = (id: string) => id

export function digestsEqual(a: SyncDigests, b: SyncDigests): boolean {
  return differingTables(a, b).length === 0
}

/** The tables whose digests differ, in `DIGEST_TABLES` order. */
export function differingTables(a: SyncDigests, b: SyncDigests): DigestTable[] {
  return DIGEST_TABLES.filter(
    (table) =>
      a[table].count !== b[table].count || a[table].hash !== b[table].hash
  )
}

function parseDigest(value: unknown): RowDigest | null {
  if (typeof value !== "object" || value === null) return null
  const { count, hash } = value as Record<string, unknown>
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    return null
  }
  if (typeof hash !== "string" || !/^[0-9a-f]{16}$/.test(hash)) return null
  return { count, hash }
}

/** Reads digests from a message; null when any table's digest is not valid. */
export function parseDigests(value: unknown): SyncDigests | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  const out: Partial<SyncDigests> = {}
  for (const table of DIGEST_TABLES) {
    const digest = parseDigest(v[table])
    if (!digest) return null
    out[table] = digest
  }
  return out as SyncDigests
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
