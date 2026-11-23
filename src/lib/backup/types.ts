import type { BackupFile, CardRow, Deck, Note, RevlogRow } from "@/db/types"

export const BACKUP_APP = "mcq-srs"
/**
 * 2 added `images`; 3 added `tags` on notes; 4 added the card marks (flag,
 * suspended, buriedUntil, markedAt); 5 added the review log's memory state
 * after the review and whether the answer was right; 6 added `settings` (retention,
 * fitted weights, leech rule). Older files are still accepted (no images, untagged
 * notes, unmarked cards, no settings); before 5 their review rows are dropped.
 */
export const BACKUP_SCHEMA_VERSION = 6

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
  /** Images from the backup that this device did not have. Set by the DB layer. */
  imagesAdded: number
  /** Settings taken from the backup because they were newer. Set by the DB layer. */
  settingsUpdated: number
}

export interface MergeResult {
  /** Full merged sets. */
  merged: BackupData
  /** The rows that differ from `local`; the only ones the DB needs to write. */
  write: BackupData
  stats: MergeStats
}
