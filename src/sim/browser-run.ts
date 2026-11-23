/**
 * Two-year run against the REAL database (browser only; not a unit test).
 *
 * `simulate` (the pure scheduler run) decides what the learner does; this file
 * replays every review through `applyReview` into IndexedDB, the way the study
 * screen writes them, and measures what a long history does to the queries,
 * backups and sync payload. At the end the stored cards are compared with the
 * simulation's own rows, and the whole thing is restored from its backup file
 * into an emptied database.
 *
 * Use a throwaway origin (e.g. a second dev-server port): it clears every
 * table first. Call from the browser console of a page of that origin:
 *
 *   const { runBrowserSim } = await import("/src/sim/browser-run.ts")
 *   window.__sim = runBrowserSim({ ... })   // progress in window.__simProgress
 */
import { db } from "@/db/database"
import {
  loadBrowseItems,
  loadDashboard,
  loadReviewRecords,
  loadStudyCards,
  readBackupSnapshot,
} from "@/db/queries"
import { applyReview, commitImport, importBackup } from "@/db/repo"
import type { CardRow } from "@/db/types"
import { buildSequences, optimizeWeights } from "@/lib/fsrs"
import { exportBackup, parseBackup, serializeBackup } from "@/lib/backup"
import { parseImportText, validateRows } from "@/lib/importer"
import { leechRule } from "@/lib/leech"
import { Reassembler, splitChunks } from "@/lib/sync"
import { buildQueue } from "@/lib/queue"

import { DAY, report, simulate, type Scenario } from "./simulate"

export interface BrowserSimOptions {
  /** URL of the question file (JSON array in the importer format). */
  dataUrl?: string
  /** Instead of a file: this many generated lorem questions. */
  questions?: number
  /** With `questions`: how many topics (decks) to spread them over. */
  topics?: number
  /** Called with each measurement as it is made (so a crash loses nothing). */
  onCheckpoint?: (checkpoint: Checkpoint) => void
  /**
   * Write the simulation's final card rows and review log straight into the
   * database in large batches instead of replaying every review through
   * `applyReview` (minutes instead of an hour for years of reviews). Only for
   * building a big database to test everything else on; it does not exercise
   * the per-review write path.
   */
  bulk?: boolean
  /** Skip the restore-from-backup step (it needs a lot of memory on a big log). */
  skipRestore?: boolean
  days?: number
  /** Measure after this many simulated days. */
  checkpointEvery?: number
  /** Overrides for the simulated learner. */
  scenario?: Partial<Scenario>
  /** Also time one automatic refit on the full log. */
  refit?: boolean
}

interface Timing {
  ms: number
}

async function time<T>(fn: () => Promise<T>): Promise<{ value: T } & Timing> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

const FSRS_FIELDS: (keyof CardRow)[] = [
  "due",
  "stability",
  "difficulty",
  "scheduledDays",
  "learningSteps",
  "reps",
  "lapses",
  "state",
  "lastReview",
]

/** Fields where two card rows differ (empty when they hold the same progress). */
function diffRows(a: CardRow, b: CardRow): string[] {
  return FSRS_FIELDS.filter((key) => a[key] !== b[key])
}

export interface Checkpoint {
  day: number
  reviewsInLog: number
  cards: number
  dashboardMs: number
  studyCardsMs: number
  queueMs: number
  browseMs: number
  recordsMs: number
  snapshotMs: number
  serializeMs: number
  backupMB: number
  parseMs: number
  noopImportMs: number
  noopWrites: number
  /** Latency of one applyReview in the chunk just written. */
  writeP50: number
  writeP95: number
  writeMax: number
  storageMB: number | null
}

/** Deterministic fake questions in the importer's format. */
function lorem(count: number): unknown[] {
  const words =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud".split(
      " "
    )
  const text = (seed: number, n: number) =>
    Array.from(
      { length: n },
      (_, k) => words[(seed * 7 + k * 13) % words.length]
    ).join(" ")
  return Array.from({ length: count }, (_, i) => ({
    sl: i + 1,
    questions: `Q${i + 1}. ${text(i, 8 + (i % 8))}?`,
    op1: text(i + 1, 2 + (i % 3)),
    op2: text(i + 2, 2 + (i % 4)),
    op3: text(i + 3, 2),
    op4: text(i + 4, 3),
    answer: `op${1 + (i % 4)}`,
    extra: `${text(i + 5, 18)}.`,
  }))
}

export async function runBrowserSim(options: BrowserSimOptions) {
  const progress = (message: string) => {
    ;(window as unknown as { __simProgress: string }).__simProgress = message
  }
  const days = options.days ?? 730
  const every = options.checkpointEvery ?? 91

  progress("clearing database")
  await Promise.all(db.tables.map((table) => table.clear()))

  progress("importing questions")
  let rows: unknown[]
  if (options.questions !== undefined) {
    rows = lorem(options.questions)
  } else {
    const text = await (await fetch(options.dataUrl ?? "")).text()
    const parsed = parseImportText(text)
    if (!parsed.ok) throw new Error(parsed.error)
    rows = parsed.rows
  }
  const { valid, invalid } = validateRows(rows)
  const topicCount = Math.max(1, options.topics ?? 1)

  const today = new Date()
  const startMs = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - days
  ).getTime()

  const summary = await time(async () => {
    const per = Math.ceil(valid.length / topicCount)
    let added = 0
    for (let t = 0; t < topicCount; t += 1) {
      const part = valid.slice(t * per, (t + 1) * per)
      if (part.length === 0) continue
      const result = await commitImport(
        {
          subject: { kind: "new", name: "Lorem" },
          topic: { kind: "new", name: `Ipsum ${t + 1}` },
        },
        part,
        0,
        startMs
      )
      added += result.added
    }
    return { added, invalid: invalid.length }
  })
  const cardIds = (await db.cards.toCollection().primaryKeys()) as string[]
  const topic = (await db.decks.toArray()).find((d) => d.parentId !== null)
  const subject = (await db.decks.toArray()).find((d) => d.parentId === null)
  if (!topic || !subject) throw new Error("deck missing after import")

  progress("simulating")
  const scenario: Scenario = {
    name: "browser two-year",
    cardIds,
    days,
    skill: 1,
    honest: true,
    sessionsPerDay: 1,
    skipProbability: 0.1,
    startJitterHours: 2,
    newPerDay: 30,
    seed: 31,
    vacations: [{ startDay: 200, lengthDays: 21 }],
    ...options.scenario,
    startMs,
  }
  const sim = simulate(scenario)

  const rule = leechRule(8, "tag")
  const checkpoints: Checkpoint[] = []
  const mismatches: string[] = []
  const rowOf = new Map<string, CardRow>()
  for (const row of await db.cards.toArray()) rowOf.set(row.cardId, row)

  let nextCheckpointDay = every
  let chunk: number[] = []

  async function measure(day: number): Promise<Checkpoint> {
    const now = startMs + day * DAY + 12 * 60 * 60 * 1000
    const dash = await time(() => loadDashboard(now))
    const study = await time(() =>
      loadStudyCards({ kind: "subject", id: subject!.id })
    )
    const queue = await time(async () =>
      buildQueue({ cards: study.value, now, seed: "x", mixed: true })
    )
    const browse = await time(() => loadBrowseItems(null))
    const records = await time(() => loadReviewRecords())
    const snap = await time(() => readBackupSnapshot())
    const file = exportBackup(
      snap.value.data,
      now,
      snap.value.images,
      snap.value.settings
    )
    const json = await time(async () => serializeBackup(file))
    const back = await time(async () => parseBackup(json.value))
    if (!back.value.ok) {
      throw new Error(`backup did not parse: ${back.value.error}`)
    }
    const noop = await time(() =>
      importBackup(back.value.ok ? back.value.backup : file)
    )
    const writes =
      noop.value.decksAdded +
      noop.value.decksUpdated +
      noop.value.notesAdded +
      noop.value.notesUpdated +
      noop.value.cardsUpdated +
      noop.value.reviewsAdded +
      noop.value.settingsUpdated
    let storageMB: number | null = null
    try {
      const estimate = await navigator.storage?.estimate?.()
      if (estimate?.usage !== undefined) storageMB = estimate.usage / 1e6
    } catch {
      storageMB = null
    }
    const sorted = [...chunk].sort((a, b) => a - b)
    chunk = []
    return {
      day,
      reviewsInLog: records.value.length,
      cards: study.value.length,
      dashboardMs: dash.ms,
      studyCardsMs: study.ms,
      queueMs: queue.ms,
      browseMs: browse.ms,
      recordsMs: records.ms,
      snapshotMs: snap.ms,
      serializeMs: json.ms,
      backupMB: json.value.length / 1e6,
      parseMs: back.ms,
      noopImportMs: noop.ms,
      noopWrites: writes,
      writeP50: percentile(sorted, 0.5),
      writeP95: percentile(sorted, 0.95),
      writeMax: sorted.length ? sorted[sorted.length - 1] : 0,
      storageMB,
    }
  }
  progress("replaying reviews")
  let done = 0
  if (options.bulk) {
    const topicOf = new Map<string, string>()
    for (const row of rowOf.values()) topicOf.set(row.cardId, row.topicId)
    const finalRows = sim.rows.map((r) => ({
      ...r,
      topicId: topicOf.get(r.cardId) ?? r.topicId,
    }))
    for (let i = 0; i < finalRows.length; i += 5000) {
      await db.cards.bulkPut(finalRows.slice(i, i + 5000))
    }
    for (let i = 0; i < sim.logs.length; i += 10_000) {
      await db.revlog.bulkPut(sim.logs.slice(i, i + 10_000))
      done = Math.min(sim.logs.length, i + 10_000)
      progress(`bulk wrote ${done} / ${sim.logs.length}`)
    }
  }
  for (const entry of options.bulk ? [] : sim.logs) {
    const day = Math.floor((entry.reviewedAt - startMs) / DAY)
    while (day >= nextCheckpointDay) {
      const made = await measure(nextCheckpointDay)
      checkpoints.push(made)
      options.onCheckpoint?.(made)
      nextCheckpointDay += every
    }
    const row = rowOf.get(entry.cardId)
    if (!row) throw new Error(`no card row for ${entry.cardId}`)
    const t0 = performance.now()
    const result = await applyReview(
      row,
      entry.rating as 1 | 3,
      entry.durationMs,
      undefined,
      undefined,
      entry.reviewedAt,
      undefined,
      rule ?? undefined
    )
    chunk.push(performance.now() - t0)
    rowOf.set(entry.cardId, result.row)
    done += 1
    if (done % 1000 === 0) progress(`replayed ${done} / ${sim.logs.length}`)
  }
  const last = await measure(days)
  checkpoints.push(last)
  options.onCheckpoint?.(last)

  progress("verifying")
  // 1. Stored progress equals what the simulation computed.
  const stored = await db.cards.toArray()
  for (const row of stored) {
    const expected = sim.rows.find((r) => r.cardId === row.cardId)
    if (!expected) {
      mismatches.push(`${row.cardId.slice(0, 6)}: not in simulation`)
      continue
    }
    const diff = diffRows(row, expected)
    if (diff.length > 0 && mismatches.length < 20) {
      mismatches.push(`${row.cardId.slice(0, 6)}: ${diff.join(",")}`)
    }
  }
  const logCount = await db.revlog.count()
  const noteCount = await db.notes.count()
  const leechNotes = (await db.notes.toArray()).filter((n) =>
    n.tags.includes("leech")
  ).length
  const lapsedOver8 = stored.filter((c) => c.lapses >= 8).length

  // 2. Restore from the backup file into an emptied database.
  progress("restoring from backup")
  if (options.skipRestore) {
    progress("finished")
    return {
      imported: { ms: summary.ms, ...summary.value },
      violations: sim.violations,
      reviewsWritten: done,
      logCount,
      noteCount,
      leechNotes,
      mismatches,
      checkpoints,
    }
  }
  const snap = await readBackupSnapshot()
  const fileText = serializeBackup(
    exportBackup(snap.data, Date.now(), snap.images, snap.settings)
  )
  // The same bytes as a device sync sends them: chunked, then reassembled, and
  // as a file read back (the import path). Neither may refuse a big backup.
  const wire = await time(async () => {
    const bytes = new TextEncoder().encode(fileText)
    const begun = Reassembler.begin(bytes.length)
    if ("error" in begun) return { ok: false, error: begun.error }
    let last: ReturnType<typeof begun.push> = { status: "more" }
    for (const chunk of splitChunks(bytes)) last = begun.push(chunk)
    let identical = last.status === "done" && last.bytes.length === bytes.length
    if (last.status === "done") {
      for (let i = 0; i < bytes.length && identical; i += 1) {
        if (last.bytes[i] !== bytes[i]) identical = false
      }
    }
    const fileBack = await new Blob([bytes], {
      type: "application/json",
    }).text()
    return { ok: identical && fileBack.length === fileText.length }
  })
  const fileMB = fileText.length / 1e6
  const before = JSON.stringify(
    stored
      .map((c) => ({
        id: c.cardId,
        ...Object.fromEntries(FSRS_FIELDS.map((k) => [k, c[k]])),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  )
  await Promise.all(db.tables.map((table) => table.clear()))
  const reparsed = parseBackup(fileText)
  if (!reparsed.ok) throw new Error(reparsed.error)
  const restore = await time(() => importBackup(reparsed.backup))
  const after = JSON.stringify(
    (await db.cards.toArray())
      .map((c) => ({
        id: c.cardId,
        ...Object.fromEntries(FSRS_FIELDS.map((k) => [k, c[k]])),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  )
  const restored = {
    fileMB: Math.round(fileMB * 10) / 10,
    wire: { ...wire.value, ms: wire.ms },
    ms: restore.ms,
    sameCards: before === after,
    logs: await db.revlog.count(),
    notes: await db.notes.count(),
    cards: await db.cards.count(),
  }

  // 3. One automatic refit on the full log.
  let refit: Record<string, unknown> | null = null
  if (options.refit) {
    progress("refit")
    const records = await loadReviewRecords()
    const t0 = performance.now()
    const fit = await optimizeWeights(buildSequences(records))
    refit = {
      reviews: records.length,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      status: fit.status,
      improved: fit.status === "done" ? fit.improved : null,
    }
  }

  progress("finished")
  return {
    imported: { ms: summary.ms, ...summary.value },
    violations: sim.violations,
    simReport: report(sim),
    reviewsWritten: done,
    logCount,
    noteCount,
    leechNotes,
    cardsWith8Lapses: lapsedOver8,
    mismatches,
    checkpoints,
    restored,
    refit,
  }
}
