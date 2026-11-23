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
import { buildQueue } from "@/lib/queue"

import { DAY, report, simulate, type Scenario } from "./simulate"

export interface BrowserSimOptions {
  /** URL of the question file (JSON array in the importer format). */
  dataUrl: string
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

export async function runBrowserSim(options: BrowserSimOptions) {
  const progress = (message: string) => {
    ;(window as unknown as { __simProgress: string }).__simProgress = message
  }
  const days = options.days ?? 730
  const every = options.checkpointEvery ?? 91

  progress("clearing database")
  await Promise.all(db.tables.map((table) => table.clear()))

  progress("importing questions")
  const text = await (await fetch(options.dataUrl)).text()
  const parsed = parseImportText(text)
  if (!parsed.ok) throw new Error(parsed.error)
  const { valid, invalid } = validateRows(parsed.rows)

  const today = new Date()
  const startMs = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - days
  ).getTime()

  const summary = await time(() =>
    commitImport(
      {
        subject: { kind: "new", name: "Lorem" },
        topic: { kind: "new", name: "Ipsum" },
      },
      valid,
      invalid.length,
      startMs
    )
  )
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
      importBackup(back.value.ok ? back.value.backup : file, now)
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
  for (const entry of sim.logs) {
    const day = Math.floor((entry.reviewedAt - startMs) / DAY)
    while (day >= nextCheckpointDay) {
      checkpoints.push(await measure(nextCheckpointDay))
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
  checkpoints.push(await measure(days))

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
  const snap = await readBackupSnapshot()
  const fileText = serializeBackup(
    exportBackup(snap.data, Date.now(), snap.images, snap.settings)
  )
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
  const restore = await time(() => importBackup(reparsed.backup, Date.now()))
  const after = JSON.stringify(
    (await db.cards.toArray())
      .map((c) => ({
        id: c.cardId,
        ...Object.fromEntries(FSRS_FIELDS.map((k) => [k, c[k]])),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  )
  const restored = {
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
