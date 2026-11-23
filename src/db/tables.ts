/**
 * Row mapping and the small reads and writes every table needs: a row object
 * to its column values and back, `put`, `get by ids`, `delete`. The queries and
 * the repo build on these; everything takes a `SqlRunner`, so the same helper
 * works inside a transaction or on its own.
 */
import type { SqlParam, SqlRow, SqlRunner } from "./sql"
import type {
  CardRow,
  Deck,
  ImageRow,
  Note,
  RevlogRow,
  SettingRow,
} from "./types"

export interface TableSpec<T> {
  name: string
  key: string
  columns: readonly string[]
  toParams(row: T): SqlParam[]
  fromRow(row: SqlRow): T
}

const num = (v: unknown): number => Number(v)
const nullableNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export const DECKS: TableSpec<Deck> = {
  name: "decks",
  key: "id",
  columns: ["id", "parentId", "name", "updatedAt", "deletedAt"],
  toParams: (d) => [d.id, d.parentId, d.name, d.updatedAt, d.deletedAt],
  fromRow: (r) => ({
    id: String(r.id),
    parentId: r.parentId === null ? null : String(r.parentId),
    name: String(r.name),
    updatedAt: num(r.updatedAt),
    deletedAt: nullableNum(r.deletedAt),
  }),
}

export const NOTES: TableSpec<Note> = {
  name: "notes",
  key: "id",
  columns: [
    "id",
    "topicId",
    "sl",
    "question",
    "options",
    "correctIndex",
    "extra",
    "tags",
    "contentUpdatedAt",
    "deletedAt",
  ],
  toParams: (n) => [
    n.id,
    n.topicId,
    JSON.stringify(n.sl),
    n.question,
    JSON.stringify(n.options),
    n.correctIndex,
    n.extra,
    JSON.stringify(n.tags),
    n.contentUpdatedAt,
    n.deletedAt,
  ],
  fromRow: (r) => ({
    id: String(r.id),
    topicId: String(r.topicId),
    sl: JSON.parse(String(r.sl)) as number | string,
    question: String(r.question),
    options: JSON.parse(String(r.options)) as Note["options"],
    correctIndex: num(r.correctIndex) as Note["correctIndex"],
    extra: String(r.extra),
    tags: JSON.parse(String(r.tags)) as string[],
    contentUpdatedAt: num(r.contentUpdatedAt),
    deletedAt: nullableNum(r.deletedAt),
  }),
}

export const CARDS: TableSpec<CardRow> = {
  name: "cards",
  key: "cardId",
  columns: [
    "cardId",
    "noteId",
    "topicId",
    "due",
    "stability",
    "difficulty",
    "elapsedDays",
    "scheduledDays",
    "learningSteps",
    "reps",
    "lapses",
    "state",
    "lastReview",
    "updatedAt",
    "flag",
    "suspended",
    "buriedUntil",
    "markedAt",
  ],
  toParams: (c) => [
    c.cardId,
    c.noteId,
    c.topicId,
    c.due,
    c.stability,
    c.difficulty,
    c.elapsedDays,
    c.scheduledDays,
    c.learningSteps,
    c.reps,
    c.lapses,
    c.state,
    c.lastReview,
    c.updatedAt,
    c.flag,
    c.suspended ? 1 : 0,
    c.buriedUntil,
    c.markedAt,
  ],
  fromRow: (r) => ({
    cardId: String(r.cardId),
    noteId: String(r.noteId),
    topicId: String(r.topicId),
    due: num(r.due),
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    elapsedDays: num(r.elapsedDays),
    scheduledDays: num(r.scheduledDays),
    learningSteps: num(r.learningSteps),
    reps: num(r.reps),
    lapses: num(r.lapses),
    state: num(r.state),
    lastReview: num(r.lastReview),
    updatedAt: num(r.updatedAt),
    flag: num(r.flag),
    suspended: num(r.suspended) !== 0,
    buriedUntil: num(r.buriedUntil),
    markedAt: num(r.markedAt),
  }),
}

export const REVLOG: TableSpec<RevlogRow> = {
  name: "revlog",
  key: "id",
  columns: [
    "id",
    "cardId",
    "reviewedAt",
    "rating",
    "state",
    "durationMs",
    "answerMs",
    "correct",
    "stabilityAfter",
    "difficultyAfter",
    "scheduledDaysAfter",
    "dueAfter",
  ],
  toParams: (l) => [
    l.id,
    l.cardId,
    l.reviewedAt,
    l.rating,
    l.state,
    l.durationMs,
    l.answerMs,
    l.correct ? 1 : 0,
    l.stabilityAfter,
    l.difficultyAfter,
    l.scheduledDaysAfter,
    l.dueAfter,
  ],
  fromRow: (r) => ({
    id: String(r.id),
    cardId: String(r.cardId),
    reviewedAt: num(r.reviewedAt),
    rating: num(r.rating),
    state: num(r.state),
    durationMs: num(r.durationMs),
    answerMs: num(r.answerMs),
    correct: num(r.correct) !== 0,
    stabilityAfter: num(r.stabilityAfter),
    difficultyAfter: num(r.difficultyAfter),
    scheduledDaysAfter: num(r.scheduledDaysAfter),
    dueAfter: num(r.dueAfter),
  }),
}

export const IMAGES: TableSpec<ImageRow> = {
  name: "images",
  key: "id",
  columns: ["id", "mime", "width", "height", "data"],
  toParams: (i) => [i.id, i.mime, i.width, i.height, i.data],
  fromRow: (r) => ({
    id: String(r.id),
    mime: String(r.mime),
    width: num(r.width),
    height: num(r.height),
    data: String(r.data),
  }),
}

export const SETTINGS: TableSpec<SettingRow> = {
  name: "settings",
  key: "key",
  columns: ["key", "value", "updatedAt"],
  toParams: (s) => [s.key, JSON.stringify(s.value), s.updatedAt],
  fromRow: (r) => ({
    key: String(r.key) as SettingRow["key"],
    value: JSON.parse(String(r.value)) as unknown,
    updatedAt: num(r.updatedAt),
  }),
}

export const IDS = "IN (SELECT value FROM json_each(?))"

/** Rows are written 1000 ids at a time when a statement lists ids itself. */
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ")

/** Inserts or replaces rows (Dexie's `put`). */
export async function putRows<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  rows: readonly T[]
): Promise<void> {
  if (rows.length === 0) return
  await tx.executeMany(
    `INSERT OR REPLACE INTO ${spec.name} (${spec.columns.join(", ")}) VALUES (${marks(spec.columns.length)})`,
    rows.map(spec.toParams)
  )
}

/** Inserts rows that must not exist yet (Dexie's `add`); a duplicate id throws. */
export async function addRows<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  rows: readonly T[]
): Promise<void> {
  if (rows.length === 0) return
  await tx.executeMany(
    `INSERT INTO ${spec.name} (${spec.columns.join(", ")}) VALUES (${marks(spec.columns.length)})`,
    rows.map(spec.toParams)
  )
}

/** The rows with these ids, in no particular order; missing ids are skipped. */
export async function getRows<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  ids: readonly string[]
): Promise<T[]> {
  if (ids.length === 0) return []
  const rows = await tx.select(
    `SELECT * FROM ${spec.name} WHERE ${spec.key} ${IDS} ORDER BY ${spec.key}`,
    [JSON.stringify(ids)]
  )
  return rows.map(spec.fromRow)
}

export async function getRow<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  id: string
): Promise<T | undefined> {
  const rows = await tx.select(
    `SELECT * FROM ${spec.name} WHERE ${spec.key} = ?`,
    [id]
  )
  return rows.length > 0 ? spec.fromRow(rows[0]) : undefined
}

/** `SELECT * FROM <table> <suffix>` mapped to rows, e.g. `WHERE parentId = ?`. */
export async function queryRows<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  suffix: string,
  params: readonly SqlParam[] = []
): Promise<T[]> {
  const rows = await tx.select(`SELECT * FROM ${spec.name} ${suffix}`, params)
  return rows.map(spec.fromRow)
}

export async function allRows<T>(
  tx: SqlRunner,
  spec: TableSpec<T>
): Promise<T[]> {
  return (await tx.select(`SELECT * FROM ${spec.name}`)).map(spec.fromRow)
}

export async function allKeys(
  tx: SqlRunner,
  spec: TableSpec<unknown>
): Promise<string[]> {
  const rows = await tx.select(`SELECT ${spec.key} AS k FROM ${spec.name}`)
  return rows.map((r) => String(r.k))
}

export async function countRows(
  tx: SqlRunner,
  spec: TableSpec<unknown>
): Promise<number> {
  const rows = await tx.select(`SELECT COUNT(*) AS n FROM ${spec.name}`)
  return num(rows[0]?.n)
}

export async function deleteRows(
  tx: SqlRunner,
  spec: TableSpec<unknown>,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return
  await tx.execute(`DELETE FROM ${spec.name} WHERE ${spec.key} ${IDS}`, [
    JSON.stringify(ids),
  ])
}

/** Notes are written with their tag index (see `note_tags` in the schema). */
export async function putNotes(
  tx: SqlRunner,
  notes: readonly Note[]
): Promise<void> {
  if (notes.length === 0) return
  await putRows(tx, NOTES, notes)
  await tx.execute(`DELETE FROM note_tags WHERE noteId ${IDS}`, [
    JSON.stringify(notes.map((n) => n.id)),
  ])
  const tagRows = notes.flatMap((n) =>
    n.tags.map((tag): SqlParam[] => [tag, n.id])
  )
  if (tagRows.length > 0) {
    await tx.executeMany(
      "INSERT OR IGNORE INTO note_tags (tag, noteId) VALUES (?, ?)",
      tagRows
    )
  }
}

/** Adds notes that must not exist yet, with their tag index. */
export async function addNotes(
  tx: SqlRunner,
  notes: readonly Note[]
): Promise<void> {
  await addRows(tx, NOTES, notes)
  const tagRows = notes.flatMap((n) =>
    n.tags.map((tag): SqlParam[] => [tag, n.id])
  )
  if (tagRows.length > 0) {
    await tx.executeMany(
      "INSERT OR IGNORE INTO note_tags (tag, noteId) VALUES (?, ?)",
      tagRows
    )
  }
}

/** Empties a table (and the tag index with the notes). */
export async function clearTable(
  tx: SqlRunner,
  spec: TableSpec<unknown>
): Promise<void> {
  await tx.execute(`DELETE FROM ${spec.name}`)
  if (spec === NOTES) await tx.execute("DELETE FROM note_tags")
}

/**
 * Every row of a table in key order, `size` rows at a time (keyset paging, so
 * a big table is never in memory whole and the cost does not grow with the
 * offset).
 */
export async function* tablePages<T>(
  tx: SqlRunner,
  spec: TableSpec<T>,
  size: number
): AsyncGenerator<T[]> {
  let last: string | null = null
  for (;;) {
    const rows: SqlRow[] =
      last === null
        ? await tx.select(
            `SELECT * FROM ${spec.name} ORDER BY ${spec.key} LIMIT ?`,
            [size]
          )
        : await tx.select(
            `SELECT * FROM ${spec.name} WHERE ${spec.key} > ? ORDER BY ${spec.key} LIMIT ?`,
            [last, size]
          )
    if (rows.length === 0) return
    last = String(rows[rows.length - 1][spec.key])
    yield rows.map(spec.fromRow)
    if (rows.length < size) return
  }
}
