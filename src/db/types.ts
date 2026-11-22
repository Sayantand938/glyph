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
  contentUpdatedAt: number
  deletedAt: number | null
}

export interface CardRow {
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
  /** Time from card shown to rating. */
  durationMs: number
}

export interface BackupFile {
  app: "mcq-srs"
  schemaVersion: number
  exportedAt: number
  decks: Deck[]
  notes: Note[]
  cards: CardRow[]
  revlog: RevlogRow[]
}
