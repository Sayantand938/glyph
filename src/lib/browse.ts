/**
 * Browse-screen logic: row building, search, filters, sorting and labels.
 * Pure (no DB, no React, no ts-fsrs); the DB layer fetches the notes and cards.
 */
import { isHidden, isBuried } from "./card-marks"
import { imageTokenRegex } from "./image"
import {
  CARD_LEARNING,
  CARD_NEW,
  CARD_RELEARNING,
  CARD_REVIEW,
  endOfLocalDay,
} from "./queue"

const DAY_MS = 86_400_000

/** The slice of a note the browse list needs. */
export interface BrowseNote {
  id: string
  topicId: string
  sl: number | string
  question: string
  options: readonly string[]
  extra: string
  tags: readonly string[]
}

/** The slice of a card row the browse list needs. */
export interface BrowseCard {
  state: number
  /** ms epoch */
  due: number
  reps: number
  lapses: number
  difficulty: number
  /** Card marks; missing on a row from before they existed. */
  flag?: number
  suspended?: boolean
  buriedUntil?: number
}

export interface BrowseRow {
  /** The note id (the card id is the same). */
  id: string
  topicId: string
  topicName: string
  subjectName: string
  sl: number | string
  /** One line of plain text for the list. */
  preview: string
  /** The note's tags (normalized, sorted). */
  tags: string[]
  /** Lowercased question, options, explanation and tags, for search. */
  search: string
  state: number
  due: number
  reps: number
  lapses: number
  difficulty: number
  /** 0 = no flag, 1-7 = a colour. */
  flag: number
  suspended: boolean
  /** ms epoch; buried while this is in the future. */
  buriedUntil: number
}

const NO_PROGRESS: BrowseCard = {
  state: CARD_NEW,
  due: 0,
  reps: 0,
  lapses: 0,
  difficulty: 0,
  flag: 0,
  suspended: false,
  buriedUntil: 0,
}

/**
 * Question text as one plain line: pictures become "[image]", the lightest
 * Markdown markers go, whitespace is collapsed. Math is left as typed.
 */
export function previewText(text: string): string {
  return text
    .replace(imageTokenRegex(), "[image]")
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

const OPTION_LETTERS = ["A", "B", "C", "D"] as const

/** Pictures cannot travel as text, so a token becomes "[image]" (or "[image: alt]"). */
function withoutImages(text: string): string {
  return text.replace(imageTokenRegex(), (_token, alt: string) =>
    alt ? `[image: ${alt}]` : "[image]"
  )
}

/**
 * One question as pretty JSON, ready to paste into a chatbot:
 * `{ question, options: { A..D }, answer: "B", extra, tags }`. `extra` and
 * `tags` are left out when empty. Math and Markdown stay as typed; image tokens become "[image]".
 */
export function noteAsJson(note: {
  question: string
  options: readonly string[]
  correctIndex: number
  extra: string
  tags?: readonly string[]
}): string {
  const options: Record<string, string> = {}
  note.options.forEach((text, i) => {
    options[OPTION_LETTERS[i] ?? String(i + 1)] = withoutImages(text)
  })
  const data: Record<string, unknown> = {
    question: withoutImages(note.question),
    options,
    answer: OPTION_LETTERS[note.correctIndex] ?? String(note.correctIndex + 1),
  }
  const extra = withoutImages(note.extra).trim()
  if (extra) data.extra = extra
  if (note.tags && note.tags.length > 0) data.tags = [...note.tags]
  return JSON.stringify(data, null, 2)
}

/** A note without a card row (it should not happen) is shown as New. */
export function makeBrowseRow(
  note: BrowseNote,
  card: BrowseCard | undefined,
  topicName: string,
  subjectName: string
): BrowseRow {
  const progress = card ?? NO_PROGRESS
  return {
    id: note.id,
    topicId: note.topicId,
    topicName,
    subjectName,
    sl: note.sl,
    preview: previewText(note.question),
    tags: [...note.tags],
    search: [note.question, ...note.options, note.extra, ...note.tags]
      .join("\n")
      .toLowerCase(),
    state: progress.state,
    due: progress.due,
    reps: progress.reps,
    lapses: progress.lapses,
    difficulty: progress.difficulty,
    flag: progress.flag ?? 0,
    suspended: progress.suspended === true,
    buriedUntil: progress.buriedUntil ?? 0,
  }
}

// --- Filters and search -----------------------------------------------------

export type BrowseFilter =
  | "all"
  | "new"
  | "learning"
  | "review"
  | "due"
  | "lapsed"
  | "flagged"
  | "suspended"
  | "buried"

export const BROWSE_FILTERS: readonly { value: BrowseFilter; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "new", label: "New" },
    { value: "learning", label: "Learning" },
    { value: "review", label: "Review" },
    { value: "due", label: "Due" },
    { value: "lapsed", label: "Lapsed" },
    { value: "flagged", label: "Flagged" },
    { value: "suspended", label: "Suspended" },
    { value: "buried", label: "Buried" },
  ]

function isLearningState(state: number): boolean {
  return state === CARD_LEARNING || state === CARD_RELEARNING
}

/**
 * Same rule as the dashboard's Learning + Due counts and the study queue: a
 * suspended or buried card is not due.
 */
export function isDueRow(
  row: Pick<BrowseRow, "state" | "due"> &
    Partial<Pick<BrowseRow, "suspended" | "buriedUntil">>,
  now: number
): boolean {
  if (isHidden(row, now)) return false
  if (isLearningState(row.state)) return row.due <= now
  return row.state === CARD_REVIEW && row.due <= endOfLocalDay(now)
}

function matchesFilter(
  row: BrowseRow,
  filter: BrowseFilter,
  now: number
): boolean {
  switch (filter) {
    case "all":
      return true
    case "new":
      return row.state === CARD_NEW
    case "learning":
      return isLearningState(row.state)
    case "review":
      return row.state === CARD_REVIEW
    case "due":
      return isDueRow(row, now)
    case "lapsed":
      return row.lapses > 0
    case "flagged":
      return row.flag > 0
    case "suspended":
      return row.suspended
    case "buried":
      return isBuried(row, now)
  }
}

/** Lowercased words of a search box; a row must contain every one. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Rows that match the state filter, contain every search word, carry every
 * tag in `tags` (an exact tag match, not a text search) and, when `flags` is
 * given and not empty, have any one of those flags.
 */
export function filterRows(
  rows: readonly BrowseRow[],
  options: {
    query: string
    filter: BrowseFilter
    tags?: readonly string[]
    flags?: readonly number[]
  },
  now: number
): BrowseRow[] {
  const terms = searchTerms(options.query)
  const tags = options.tags ?? []
  const flags = options.flags ?? []
  return rows.filter(
    (row) =>
      matchesFilter(row, options.filter, now) &&
      tags.every((tag) => row.tags.includes(tag)) &&
      (flags.length === 0 || flags.includes(row.flag)) &&
      terms.every((term) => row.search.includes(term))
  )
}

/** How many rows each filter would show, for the chips. */
export function filterCounts(
  rows: readonly BrowseRow[],
  now: number
): Record<BrowseFilter, number> {
  const counts: Record<BrowseFilter, number> = {
    all: rows.length,
    new: 0,
    learning: 0,
    review: 0,
    due: 0,
    lapsed: 0,
    flagged: 0,
    suspended: 0,
    buried: 0,
  }
  for (const row of rows) {
    if (row.state === CARD_NEW) counts.new += 1
    if (isLearningState(row.state)) counts.learning += 1
    if (row.state === CARD_REVIEW) counts.review += 1
    if (isDueRow(row, now)) counts.due += 1
    if (row.lapses > 0) counts.lapsed += 1
    if (row.flag > 0) counts.flagged += 1
    if (row.suspended) counts.suspended += 1
    if (isBuried(row, now)) counts.buried += 1
  }
  return counts
}

/** How many rows carry each flag (1-7); flags nobody uses are left out. */
export function flagCounts(
  rows: readonly BrowseRow[]
): { flag: number; count: number }[] {
  const counts = new Map<number, number>()
  for (const row of rows) {
    if (row.flag > 0) counts.set(row.flag, (counts.get(row.flag) ?? 0) + 1)
  }
  return [...counts]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => a.flag - b.flag)
}

// --- Sorting ------------------------------------------------------------------

export type BrowseSort =
  | "flag"
  | "number"
  | "question"
  | "topic"
  | "tags"
  | "state"
  | "due"
  | "reps"
  | "lapses"
  | "difficulty"
export type SortDirection = "asc" | "desc"

/** Reps, lapses and difficulty are most useful biggest first. */
export function defaultDirection(sort: BrowseSort): SortDirection {
  return sort === "reps" || sort === "lapses" || sort === "difficulty"
    ? "desc"
    : "asc"
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

function compareNumber(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  return compareText(String(a), String(b))
}

/** New cards have no due date, so they go after every scheduled card. */
function dueKey(row: BrowseRow): number {
  return row.state === CARD_NEW ? Number.POSITIVE_INFINITY : row.due
}

/** Flagged cards first (by colour), unflagged last. */
function flagKey(row: BrowseRow): number {
  return row.flag === 0 ? Number.POSITIVE_INFINITY : row.flag
}

function compareBy(a: BrowseRow, b: BrowseRow, sort: BrowseSort): number {
  switch (sort) {
    case "flag": {
      const x = flagKey(a)
      const y = flagKey(b)
      return x === y ? 0 : x < y ? -1 : 1
    }
    case "number":
      return compareNumber(a.sl, b.sl)
    case "due": {
      const x = dueKey(a)
      const y = dueKey(b)
      return x === y ? 0 : x < y ? -1 : 1
    }
    case "topic":
      return compareText(
        `${a.subjectName} > ${a.topicName}`,
        `${b.subjectName} > ${b.topicName}`
      )
    case "tags":
      return compareText(a.tags.join(" "), b.tags.join(" "))
    case "state":
      return a.state - b.state
    case "reps":
      return a.reps - b.reps
    case "lapses":
      return a.lapses - b.lapses
    case "difficulty":
      return a.difficulty - b.difficulty
    case "question":
      return compareText(a.preview, b.preview)
  }
}

/**
 * A sorted copy. Ties fall back to the source number, then the question text,
 * then the id (always ascending), so the order is stable between renders.
 */
export function sortRows(
  rows: readonly BrowseRow[],
  sort: BrowseSort,
  direction: SortDirection
): BrowseRow[] {
  const sign = direction === "asc" ? 1 : -1
  return [...rows].sort(
    (a, b) =>
      sign * compareBy(a, b, sort) ||
      compareNumber(a.sl, b.sl) ||
      compareText(a.preview, b.preview) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

// --- Labels -------------------------------------------------------------------

export function stateLabel(state: number): string {
  switch (state) {
    case CARD_NEW:
      return "New"
    case CARD_LEARNING:
      return "Learning"
    case CARD_REVIEW:
      return "Review"
    case CARD_RELEARNING:
      return "Relearning"
    default:
      return "Unknown"
  }
}

function startOfLocalDay(time: number): number {
  const day = new Date(time)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/**
 * When a card is next due, in words: "new", "now", "in 10m", "today",
 * "tomorrow", "3d overdue", "in 5d", "in 2mo", "in 1.4y". Days are local
 * calendar days, like the dashboard's due rule.
 */
export function formatDue(
  row: Pick<BrowseRow, "state" | "due">,
  now: number
): string {
  if (row.state === CARD_NEW) return "new"

  if (isLearningState(row.state)) {
    if (row.due <= now) return "now"
    const minutes = Math.ceil((row.due - now) / 60_000)
    if (minutes < 60) return `in ${minutes}m`
    if (minutes < 24 * 60) return `in ${Math.round(minutes / 60)}h`
  }

  const days = Math.round(
    (startOfLocalDay(row.due) - startOfLocalDay(now)) / DAY_MS
  )
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days < 30) return `in ${days}d`
  if (days < 365) return `in ${Math.round(days / 30)}mo`
  return `in ${(days / 365).toFixed(1)}y`
}
