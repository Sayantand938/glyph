/**
 * Bulk JSON importer: pure logic only (no DB, no React). The DB side lives in
 * `commitImport()` in src/db/repo.ts and re-runs `planImport()` inside its
 * transaction against the stored notes.
 */
import type { Deck, Note } from "@/db/types"
import { normalizeAnswer, type OptionIndex } from "@/lib/answer"
import { noteId, normalizeQuestion } from "@/lib/hash"

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export type Options4 = [string, string, string, string]

/** A row that passed validation, with every field normalized. */
export interface ValidRow {
  /** 1-based position in the file, for messages. */
  row: number
  sl: number | string
  question: string
  options: Options4
  correctIndex: OptionIndex
  extra: string
}

export interface InvalidRow {
  /** 1-based position in the file. */
  row: number
  sl: number | string
  reasons: string[]
}

export interface Validation {
  valid: ValidRow[]
  invalid: InvalidRow[]
}

export type ParseResult =
  { ok: true; rows: unknown[] } | { ok: false; error: string }

export interface ImportPlan {
  toAdd: Note[]
  toUpdate: Note[]
  unchanged: number
  /** Valid rows dropped because a later row in the file had the same question. */
  duplicates: number
}

export interface ImportSummary {
  added: number
  updated: number
  unchanged: number
  invalid: number
  duplicates: number
}

/** A Subject or Topic target: reuse a live deck, or create one by name. */
export type DeckRef =
  { kind: "existing"; id: string } | { kind: "new"; name: string }

/** Parses the raw file text. Never throws; the root must be a JSON array. */
export function parseImportText(text: string): ParseResult {
  let data: unknown
  try {
    // A UTF-8 BOM (common from Windows editors) is not valid JSON whitespace.
    data = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return { ok: false, error: "This file is not valid JSON." }
  }
  if (!Array.isArray(data)) {
    return {
      ok: false,
      error: "The JSON must be an array of questions, e.g. [{ ... }, { ... }].",
    }
  }
  if (data.length === 0) {
    return { ok: false, error: "The file contains no questions." }
  }
  return { ok: true, rows: data }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Strings are trimmed; finite numbers are accepted as text; anything else is empty. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function slOf(value: unknown): number | string {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") return value.trim()
  return ""
}

/** Validates every row. `sl` and `extra` are optional (default ''). */
export function validateRows(rows: readonly unknown[]): Validation {
  const valid: ValidRow[] = []
  const invalid: InvalidRow[] = []

  rows.forEach((raw, i) => {
    const row = i + 1
    if (!isRecord(raw)) {
      invalid.push({ row, sl: "", reasons: ["Row is not an object."] })
      return
    }

    const sl = slOf(raw.sl)
    const reasons: string[] = []

    const question = textOf(raw.questions)
    if (!question) reasons.push('Missing "questions".')

    const options = [raw.op1, raw.op2, raw.op3, raw.op4].map(textOf)
    options.forEach((option, n) => {
      if (!option) reasons.push(`Missing "op${n + 1}".`)
    })

    const answerGiven = textOf(raw.answer) !== ""
    const correctIndex = normalizeAnswer(raw.answer, options)
    if (correctIndex === null) {
      reasons.push(
        answerGiven
          ? `"answer" does not match an option: ${JSON.stringify(textOf(raw.answer))}.`
          : 'Missing "answer".'
      )
    }

    if (reasons.length > 0 || correctIndex === null) {
      invalid.push({ row, sl, reasons })
      return
    }

    valid.push({
      row,
      sl,
      question,
      options: [options[0], options[1], options[2], options[3]],
      correctIndex,
      extra: textOf(raw.extra),
    })
  })

  return { valid, invalid }
}

function sameOptions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/**
 * Decides what an import would do for one topic. Pure: `existing` is the
 * topic's stored notes keyed by id (live or tombstoned).
 *
 *  - Rows are keyed by `noteId(topicId, question)`; within the file the last
 *    row wins and the rest count as `duplicates`.
 *  - A stored note keeps its id and question text; only `sl`, `options`,
 *    `correctIndex` and `extra` are refreshed, and `contentUpdatedAt` is
 *    bumped only if something changed. A tombstoned note is resurrected
 *    (counts as updated and is bumped so it beats the tombstone in a merge).
 *  - Card rows are never part of the plan.
 */
export function planImport(
  rows: readonly ValidRow[],
  topicId: string,
  existing: ReadonlyMap<string, Note>,
  now: number
): ImportPlan {
  const byId = new Map<string, ValidRow>()
  for (const row of rows) {
    // delete + set so "last wins" also moves the row to its last position.
    const id = noteId(topicId, row.question)
    byId.delete(id)
    byId.set(id, row)
  }

  const plan: ImportPlan = {
    toAdd: [],
    toUpdate: [],
    unchanged: 0,
    duplicates: rows.length - byId.size,
  }

  for (const [id, row] of byId) {
    const stored = existing.get(id)
    if (!stored) {
      plan.toAdd.push({
        id,
        topicId,
        sl: row.sl,
        question: row.question,
        options: row.options,
        correctIndex: row.correctIndex,
        extra: row.extra,
        contentUpdatedAt: now,
        deletedAt: null,
      })
      continue
    }

    const changed =
      stored.deletedAt !== null ||
      stored.sl !== row.sl ||
      stored.correctIndex !== row.correctIndex ||
      stored.extra !== row.extra ||
      !sameOptions(stored.options, row.options)

    if (!changed) {
      plan.unchanged += 1
      continue
    }
    plan.toUpdate.push({
      ...stored,
      sl: row.sl,
      options: row.options,
      correctIndex: row.correctIndex,
      extra: row.extra,
      contentUpdatedAt: now,
      deletedAt: null,
    })
  }

  return plan
}

export function summarize(
  plan: ImportPlan,
  invalidCount: number
): ImportSummary {
  return {
    added: plan.toAdd.length,
    updated: plan.toUpdate.length,
    unchanged: plan.unchanged,
    invalid: invalidCount,
    duplicates: plan.duplicates,
  }
}

/** Case-, whitespace- and Unicode-insensitive deck name key. */
export function deckNameKey(name: string): string {
  return normalizeQuestion(name)
}

/**
 * Picks the target deck. A typed name wins over the dropdown selection and
 * reuses a live deck with the same name (case-insensitive, trimmed).
 * `candidates` are the live decks at this level (Subjects, or the chosen
 * Subject's Topics); soft-deleted decks are ignored. Returns null when
 * nothing is chosen.
 */
export function resolveDeckRef(
  candidates: readonly Deck[],
  selectedId: string,
  typedName: string
): DeckRef | null {
  const live = candidates.filter((deck) => deck.deletedAt === null)

  const name = typedName.trim()
  if (name) {
    const key = deckNameKey(name)
    const match = live.find((deck) => deckNameKey(deck.name) === key)
    return match ? { kind: "existing", id: match.id } : { kind: "new", name }
  }

  const selected = live.find((deck) => deck.id === selectedId)
  return selected ? { kind: "existing", id: selected.id } : null
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** "Added 45 new MCQs, updated 3 existing, skipped 2 invalid." */
export function formatSummary(s: ImportSummary): string {
  const parts = [`Added ${count(s.added, "new MCQ")}`]
  if (s.updated > 0) parts.push(`updated ${s.updated} existing`)
  if (s.unchanged > 0) parts.push(`${s.unchanged} unchanged`)
  if (s.duplicates > 0) {
    parts.push(
      `merged ${count(s.duplicates, "duplicate question")} in the file`
    )
  }
  if (s.invalid > 0) parts.push(`skipped ${s.invalid} invalid`)
  return `${parts.join(", ")}.`
}
