import type { CardMarks } from "@/lib/card-marks"
import type { SettingRow } from "@/lib/settings"

export type { SettingRow }

export interface Deck {
  id: string
  /** null = Subject, string = Topic */
  parentId: string | null
  name: string
  updatedAt: number
  deletedAt: number | null
}

export interface Note {
  /** Deterministic (see lib/hash.ts); FROZEN after creation. */
  id: string
  topicId: string
  sl: number | string
  question: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  extra: string
  /** Normalized, unique and sorted (see lib/tags.ts). Empty for an untagged note. */
  tags: string[]
  contentUpdatedAt: number
  deletedAt: number | null
}

/**
 * One card per note. Besides the FSRS fields it carries the card marks (flag,
 * suspended, buriedUntil, markedAt; see lib/card-marks.ts), which a review
 * never changes.
 */
export interface CardRow extends CardMarks {
  /** === noteId (strict 1:1) */
  cardId: string
  noteId: string
  /** Denormalized from the note for fast per-topic queries. */
  topicId: string
  /** ms epoch */
  due: number
  stability: number
  difficulty: number
  /** Deprecated in ts-fsrs 5.x (removed in 6) but still part of its Card. */
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  /** ts-fsrs State enum value (0 New, 1 Learning, 2 Review, 3 Relearning). */
  state: number
  /** ms epoch; 0 if never reviewed. */
  lastReview: number
  /** = lastReview, or creation time for untouched cards (used for merge). */
  updatedAt: number
}

export interface RevlogRow {
  /** crypto.randomUUID() */
  id: string
  cardId: string
  reviewedAt: number
  /**
   * ts-fsrs Rating enum value. The app only writes 1 (Again, fail) and 3
   * (Good, pass); 2 (Hard) and 4 (Easy) can exist in older logs and imported
   * backups, and are still accepted.
   */
  rating: number
  /** State BEFORE the review. */
  state: number
  /**
   * Time from card shown to rating. For a right pick this includes the time
   * spent reading the explanation before pressing Pass or Fail.
   */
  durationMs: number
  /** Time from card shown to the option being picked (<= durationMs). */
  answerMs: number
  /**
   * Whether the picked option was the right one. A right pick can still be
   * rated Again (a guess), so this is not the same as `rating`. The picked
   * option itself is deliberately not stored: an index goes stale when the
   * note's options are edited.
   */
  correct: boolean
  /**
   * The card's memory state AFTER the review, so stability, difficulty and
   * interval charts need no replay of the log (which would also change if the
   * FSRS weights change).
   */
  stabilityAfter: number
  difficultyAfter: number
  scheduledDaysAfter: number
  /** ms epoch the card became due after this review. */
  dueAfter: number
}

/**
 * A picture used by note text through `![alt](img:<id>)`. The id is a hash of
 * the bytes (see lib/image/id.ts), so a row never changes once written.
 */
export interface ImageRow {
  id: string
  /** One of IMAGE_MIMES. */
  mime: string
  width: number
  height: number
  blob: Blob
}

/** An image inside a backup file: the bytes as base64. */
export interface BackupImage {
  id: string
  mime: string
  width: number
  height: number
  data: string
}

export interface BackupFile {
  app: "mcq-srs"
  schemaVersion: number
  exportedAt: number
  decks: Deck[]
  notes: Note[]
  cards: CardRow[]
  revlog: RevlogRow[]
  /** Only the images that notes use. Absent in schema version 1 files. */
  images: BackupImage[]
  /** Only the settings this device has changed. Absent before schema version 6. */
  settings: SettingRow[]
}
