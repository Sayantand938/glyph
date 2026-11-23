/**
 * The schema, as an ordered list of migrations. The database's `user_version`
 * says how many have run. Never edit a migration after release; add a new one.
 *
 * Timestamps are ms epoch integers. `deletedAt` is NULL for a live row (the
 * Dexie version used null too). A note's tags are kept as JSON on the row and
 * again in `note_tags`, which only exists to find the notes of one tag.
 */
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  parentId TEXT,
  name TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER
);
CREATE INDEX decks_parentId ON decks (parentId);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  topicId TEXT NOT NULL,
  sl TEXT NOT NULL,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  correctIndex INTEGER NOT NULL,
  extra TEXT NOT NULL,
  tags TEXT NOT NULL,
  contentUpdatedAt INTEGER NOT NULL,
  deletedAt INTEGER
);
CREATE INDEX notes_topicId ON notes (topicId);
CREATE INDEX notes_contentUpdatedAt ON notes (contentUpdatedAt);
CREATE INDEX notes_deletedAt ON notes (deletedAt) WHERE deletedAt IS NOT NULL;

CREATE TABLE note_tags (
  tag TEXT NOT NULL,
  noteId TEXT NOT NULL,
  PRIMARY KEY (tag, noteId)
) WITHOUT ROWID;
CREATE INDEX note_tags_noteId ON note_tags (noteId);

CREATE TABLE cards (
  cardId TEXT PRIMARY KEY,
  noteId TEXT NOT NULL,
  topicId TEXT NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsedDays REAL NOT NULL,
  scheduledDays REAL NOT NULL,
  learningSteps INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  state INTEGER NOT NULL,
  lastReview INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  flag INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  buriedUntil INTEGER NOT NULL DEFAULT 0,
  markedAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_noteId ON cards (noteId);
CREATE INDEX cards_topicId ON cards (topicId);
CREATE INDEX cards_updatedAt ON cards (updatedAt);
CREATE INDEX cards_markedAt ON cards (markedAt);

CREATE TABLE revlog (
  id TEXT PRIMARY KEY,
  cardId TEXT NOT NULL,
  reviewedAt INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  durationMs INTEGER NOT NULL,
  answerMs INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  stabilityAfter REAL NOT NULL,
  difficultyAfter REAL NOT NULL,
  scheduledDaysAfter REAL NOT NULL,
  dueAfter INTEGER NOT NULL
);
CREATE INDEX revlog_cardId ON revlog (cardId);
CREATE INDEX revlog_reviewedAt ON revlog (reviewedAt);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
`,
]
