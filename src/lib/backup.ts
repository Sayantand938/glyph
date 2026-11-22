/**
 * Backup export, parsing and merge: pure (no DB, no React). The DB side is
 * `importBackup()` in src/db/repo.ts, which merges then applies the result.
 */
import type { BackupFile, CardRow, Deck, Note, RevlogRow } from "@/db/types"

export const BACKUP_APP = "mcq-srs"
export const BACKUP_SCHEMA_VERSION = 1
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024

/** The four tables, without the file envelope. */
export interface BackupData {
  decks: Deck[]
  notes: Note[]
  cards: CardRow[]
  revlog: RevlogRow[]
}

export type ParseBackupResult =
  { ok: true; backup: BackupFile } | { ok: false; error: string }

export interface MergeStats {
  decksAdded: number
  decksUpdated: number
  notesAdded: number
  notesUpdated: number
  /** Cards written: new from the backup, or replaced by newer progress. */
  cardsUpdated: number
  /** Incoming cards dropped because their note does not exist. */
  cardsDropped: number
  reviewsAdded: number
  /** Notes in the merged result whose topic is not in the merged decks. */
  notesMissingTopic: number
}

export interface MergeResult {
  /** Full merged sets. */
  merged: BackupData
  /** The rows that differ from `local`; the only ones the DB needs to write. */
  write: BackupData
  stats: MergeStats
}

// --- export -----------------------------------------------------------------

/** Builds the backup envelope. Tombstones are included so deletions propagate. */
export function exportBackup(data: BackupData, now: number): BackupFile {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now,
    decks: data.decks,
    notes: data.notes,
    cards: data.cards,
    revlog: data.revlog,
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

// --- parse ------------------------------------------------------------------

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isStr(value: unknown): value is string {
  return typeof value === "string"
}

function isNullableTime(value: unknown): value is number | null {
  return value === null || isNum(value)
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return isNum(value) && Number.isInteger(value) && value >= min && value <= max
}

/** Validators build a clean copy, so unknown fields never reach the database. */
function readDeck(v: unknown): Deck | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "") return null
  if (!(v.parentId === null || isStr(v.parentId))) return null
  if (!isStr(v.name) || !isNum(v.updatedAt) || !isNullableTime(v.deletedAt)) {
    return null
  }
  return {
    id: v.id,
    parentId: v.parentId,
    name: v.name,
    updatedAt: v.updatedAt,
    deletedAt: v.deletedAt,
  }
}

function readNote(v: unknown): Note | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "" || !isStr(v.topicId)) return null
  if (!(isNum(v.sl) || isStr(v.sl))) return null
  if (!isStr(v.question) || !isStr(v.extra)) return null
  const o = v.options
  if (!Array.isArray(o) || o.length !== 4 || !o.every(isStr)) return null
  if (!isIntIn(v.correctIndex, 0, 3)) return null
  if (!isNum(v.contentUpdatedAt) || !isNullableTime(v.deletedAt)) return null
  return {
    id: v.id,
    topicId: v.topicId,
    sl: v.sl,
    question: v.question,
    options: [o[0], o[1], o[2], o[3]],
    correctIndex: v.correctIndex as Note["correctIndex"],
    extra: v.extra,
    contentUpdatedAt: v.contentUpdatedAt,
    deletedAt: v.deletedAt,
  }
}

function readCard(v: unknown): CardRow | null {
  if (!isRec(v)) return null
  if (!isStr(v.cardId) || v.cardId === "") return null
  if (!isStr(v.noteId) || !isStr(v.topicId)) return null
  if (!isIntIn(v.state, 0, 3)) return null
  const nums = [
    v.due,
    v.stability,
    v.difficulty,
    v.elapsedDays,
    v.scheduledDays,
    v.learningSteps,
    v.reps,
    v.lapses,
    v.lastReview,
    v.updatedAt,
  ]
  if (!nums.every(isNum)) return null
  return {
    cardId: v.cardId,
    noteId: v.noteId,
    topicId: v.topicId,
    due: v.due as number,
    stability: v.stability as number,
    difficulty: v.difficulty as number,
    elapsedDays: v.elapsedDays as number,
    scheduledDays: v.scheduledDays as number,
    learningSteps: v.learningSteps as number,
    reps: v.reps as number,
    lapses: v.lapses as number,
    state: v.state,
    lastReview: v.lastReview as number,
    updatedAt: v.updatedAt as number,
  }
}

function readLog(v: unknown): RevlogRow | null {
  if (!isRec(v)) return null
  if (!isStr(v.id) || v.id === "" || !isStr(v.cardId)) return null
  if (!isNum(v.reviewedAt) || !isNum(v.durationMs)) return null
  if (!isIntIn(v.rating, 1, 4) || !isIntIn(v.state, 0, 3)) return null
  return {
    id: v.id,
    cardId: v.cardId,
    reviewedAt: v.reviewedAt,
    rating: v.rating,
    state: v.state,
    durationMs: v.durationMs,
  }
}

function readTable<T>(
  name: string,
  value: unknown,
  read: (row: unknown) => T | null
): { ok: true; rows: T[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `The backup is missing its "${name}" list.` }
  }
  const rows: T[] = []
  for (let i = 0; i < value.length; i++) {
    const row = read(value[i])
    if (row === null) {
      return {
        ok: false,
        error: `The backup is damaged: ${name}[${i}] is not a valid row.`,
      }
    }
    rows.push(row)
  }
  return { ok: true, rows }
}

/** Parses and validates backup file text. Never throws. */
export function parseBackup(text: string): ParseBackupResult {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return { ok: false, error: "This file is not valid JSON." }
  }
  if (!isRec(data) || data.app !== BACKUP_APP) {
    return { ok: false, error: "This is not a Glyph backup file." }
  }

  const version = data.schemaVersion
  if (!isNum(version) || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "The backup has no valid schema version." }
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        "This backup was made by a newer version of Glyph. Update the app and try again.",
    }
  }
  if (!isNum(data.exportedAt)) {
    return { ok: false, error: "The backup has no valid export time." }
  }

  const decks = readTable("decks", data.decks, readDeck)
  if (!decks.ok) return decks
  const notes = readTable("notes", data.notes, readNote)
  if (!notes.ok) return notes
  const cards = readTable("cards", data.cards, readCard)
  if (!cards.ok) return cards
  const revlog = readTable("revlog", data.revlog, readLog)
  if (!revlog.ok) return revlog

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      schemaVersion: version,
      exportedAt: data.exportedAt,
      decks: decks.rows,
      notes: notes.rows,
      cards: cards.rows,
      revlog: revlog.rows,
    },
  }
}

// --- merge ------------------------------------------------------------------

/** Larger `updatedAt` wins; on a tie a tombstone wins, then local. */
function pickDeck(local: Deck, incoming: Deck): Deck {
  if (incoming.updatedAt !== local.updatedAt) {
    return incoming.updatedAt > local.updatedAt ? incoming : local
  }
  return local.deletedAt === null && incoming.deletedAt !== null
    ? incoming
    : local
}

/**
 * Larger `contentUpdatedAt` wins. A tombstone beats a live row only if its
 * `deletedAt` is newer than the live row's `contentUpdatedAt`. Two tombstones:
 * newer content, then newer `deletedAt`. Ties keep local.
 */
function pickNote(local: Note, incoming: Note): Note {
  const localDead = local.deletedAt !== null
  const incomingDead = incoming.deletedAt !== null

  if (localDead !== incomingDead) {
    const [dead, live] = localDead ? [local, incoming] : [incoming, local]
    return (dead.deletedAt as number) > live.contentUpdatedAt ? dead : live
  }
  if (incoming.contentUpdatedAt !== local.contentUpdatedAt) {
    return incoming.contentUpdatedAt > local.contentUpdatedAt ? incoming : local
  }
  if (
    localDead &&
    (incoming.deletedAt as number) > (local.deletedAt as number)
  ) {
    return incoming
  }
  return local
}

/** Larger `lastReview` wins; tie-break on `updatedAt`; ties keep local. */
function pickCard(local: CardRow, incoming: CardRow): CardRow {
  if (incoming.lastReview !== local.lastReview) {
    return incoming.lastReview > local.lastReview ? incoming : local
  }
  return incoming.updatedAt > local.updatedAt ? incoming : local
}

/**
 * Merges an incoming backup into local data. Pure and idempotent: merging the
 * same backup into its own result writes nothing.
 *
 *  - decks: larger `updatedAt`; notes: see `pickNote`; cards: see `pickCard`
 *  - revlog: union by id (entries are immutable, local wins)
 *  - an incoming card whose note is missing from the merged notes is dropped
 *  - each card's `topicId` is repaired to match its winning note
 *  - notes whose topic is missing are written but counted in the stats
 */
export function mergeBackup(
  local: BackupData,
  incoming: BackupData
): MergeResult {
  const stats: MergeStats = {
    decksAdded: 0,
    decksUpdated: 0,
    notesAdded: 0,
    notesUpdated: 0,
    cardsUpdated: 0,
    cardsDropped: 0,
    reviewsAdded: 0,
    notesMissingTopic: 0,
  }

  // decks
  const decks = new Map(local.decks.map((d) => [d.id, d]))
  const writeDecks = new Map<string, Deck>()
  for (const inc of incoming.decks) {
    const cur = decks.get(inc.id)
    if (!cur) {
      stats.decksAdded += 1
      decks.set(inc.id, inc)
      writeDecks.set(inc.id, inc)
      continue
    }
    const winner = pickDeck(cur, inc)
    if (winner !== cur) {
      stats.decksUpdated += 1
      decks.set(inc.id, winner)
      writeDecks.set(inc.id, winner)
    }
  }

  // notes
  const notes = new Map(local.notes.map((n) => [n.id, n]))
  const writeNotes = new Map<string, Note>()
  for (const inc of incoming.notes) {
    const cur = notes.get(inc.id)
    if (!cur) {
      stats.notesAdded += 1
      notes.set(inc.id, inc)
      writeNotes.set(inc.id, inc)
      continue
    }
    const winner = pickNote(cur, inc)
    if (winner !== cur) {
      stats.notesUpdated += 1
      notes.set(inc.id, winner)
      writeNotes.set(inc.id, winner)
    }
  }

  // cards
  const cards = new Map(local.cards.map((c) => [c.cardId, c]))
  const writeCards = new Map<string, CardRow>()
  for (const inc of incoming.cards) {
    if (!notes.has(inc.noteId)) {
      stats.cardsDropped += 1
      continue
    }
    const cur = cards.get(inc.cardId)
    const winner = cur ? pickCard(cur, inc) : inc
    if (winner !== cur) {
      cards.set(inc.cardId, winner)
      writeCards.set(inc.cardId, winner)
    }
  }
  // Keep the denormalized topicId in step with the winning note.
  for (const [cardId, card] of cards) {
    const note = notes.get(card.noteId)
    if (note && note.topicId !== card.topicId) {
      const fixed = { ...card, topicId: note.topicId }
      cards.set(cardId, fixed)
      writeCards.set(cardId, fixed)
    }
  }
  stats.cardsUpdated = writeCards.size

  // revlog
  const revlog = new Map(local.revlog.map((r) => [r.id, r]))
  const writeRevlog: RevlogRow[] = []
  for (const inc of incoming.revlog) {
    if (revlog.has(inc.id)) continue
    revlog.set(inc.id, inc)
    writeRevlog.push(inc)
  }
  stats.reviewsAdded = writeRevlog.length

  for (const note of writeNotes.values()) {
    if (note.deletedAt === null && !decks.has(note.topicId)) {
      stats.notesMissingTopic += 1
    }
  }

  return {
    merged: {
      decks: [...decks.values()],
      notes: [...notes.values()],
      cards: [...cards.values()],
      revlog: [...revlog.values()],
    },
    write: {
      decks: [...writeDecks.values()],
      notes: [...writeNotes.values()],
      cards: [...writeCards.values()],
      revlog: writeRevlog,
    },
    stats,
  }
}

function plural(n: number, singular: string, many = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : many}`
}

/** "Merged: +4 notes, 2 notes updated, +4 cards updated, +20 reviews." */
export function formatMergeSummary(stats: MergeStats): string {
  const parts: string[] = []
  if (stats.decksAdded > 0) parts.push(`+${plural(stats.decksAdded, "deck")}`)
  if (stats.notesAdded > 0) parts.push(`+${plural(stats.notesAdded, "note")}`)
  if (stats.notesUpdated > 0) {
    parts.push(`${plural(stats.notesUpdated, "note")} updated`)
  }
  if (stats.cardsUpdated > 0) {
    parts.push(`+${plural(stats.cardsUpdated, "card")} updated`)
  }
  if (stats.reviewsAdded > 0) {
    parts.push(`+${plural(stats.reviewsAdded, "review")}`)
  }

  let text =
    parts.length > 0 ? `Merged: ${parts.join(", ")}.` : "Nothing new to merge."
  if (stats.cardsDropped > 0) {
    text += ` Skipped ${plural(stats.cardsDropped, "card")} with no matching note.`
  }
  if (stats.notesMissingTopic > 0) {
    text += ` ${plural(stats.notesMissingTopic, "note")} belong to a deck missing from the backup and won't show on the dashboard.`
  }
  return text
}
