import type { Note } from "@/db/types"
import { noteId } from "@/lib/hash"
import { sameTags } from "@/lib/tags"

import type { ImportPlan, ImportSummary, ValidRow } from "./types"

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
 *    `correctIndex` and `extra` are refreshed (and `tags`, but only when the
 *    row has a "tags" key), and `contentUpdatedAt` is bumped only if
 *    something changed. A tombstoned note is resurrected
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
        tags: row.tags ?? [],
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
      (row.tags !== undefined && !sameTags(stored.tags, row.tags)) ||
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
      tags: row.tags ?? stored.tags,
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
