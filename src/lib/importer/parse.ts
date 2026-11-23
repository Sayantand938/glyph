import { normalizeAnswer } from "@/lib/answer"
import { parseTags, tagsError } from "@/lib/tags"

import type { InvalidRow, ParseResult, ValidRow, Validation } from "./types"

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

    // Optional. A list of text or one string ("a, b c"); absent means "leave
    // the note's tags as they are", an empty list means "no tags".
    let tags: string[] | undefined
    if (raw.tags !== undefined && raw.tags !== null) {
      if (typeof raw.tags === "string" || Array.isArray(raw.tags)) {
        tags = parseTags(raw.tags)
        const problem = tagsError(tags)
        if (problem) reasons.push(`"tags": ${problem}`)
      } else {
        reasons.push('"tags" must be a list of text, e.g. ["physics", "exam"].')
      }
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
      ...(tags !== undefined && { tags }),
    })
  })

  return { valid, invalid }
}
