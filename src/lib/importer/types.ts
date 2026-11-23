import type { Note } from "@/db/types"
import type { OptionIndex } from "@/lib/answer"

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
  /** Normalized tags; undefined when the row has no "tags" key (the note's tags are then left alone). */
  tags?: string[]
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
