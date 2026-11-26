/**
 * Performance probe for the dashboard/study read path on a large deck.
 * Builds a file DB with N cards (one deck), then times the reads the app makes
 * when the dashboard ticks or a session starts.
 *
 *   npx tsx mcp/bench.ts 150000
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { openDatabase } from "@/db/database"
import { loadDashboard, loadStudyCards, loadStudyQueueIds } from "@/db/queries"
import type { SqlBackend, SqlParam, SqlRow } from "@/db/sql"
import { assembleQueue, buildQueue, countCards } from "@/lib/queue"

const bind = (params: readonly SqlParam[]): SQLInputValue[] =>
  params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))

const CARDS = Number(process.argv[2] ?? 150_000)
const dir = mkdtempSync(join(tmpdir(), "glyph-bench-"))
const path = join(dir, "glyph.db")

const sqlite = new DatabaseSync(path)
const backend: SqlBackend = {
  select: async (sql: string, params: readonly SqlParam[] = []) =>
    sqlite.prepare(sql).all(...bind(params)) as SqlRow[],
  execute: async (sql: string, params: readonly SqlParam[] = []) =>
    Number(sqlite.prepare(sql).run(...bind(params)).changes),
  executeMany: async (sql: string, rows: readonly (readonly SqlParam[])[]) => {
    const stmt = sqlite.prepare(sql)
    let n = 0
    for (const row of rows) n += Number(stmt.run(...bind(row)).changes)
    return n
  },
  script: async (sql: string) => {
    sqlite.exec(sql)
  },
}

const time = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const t0 = performance.now()
  const value = await fn()
  console.log(`${label}: ${(performance.now() - t0).toFixed(0)} ms`)
  return value
}

await openDatabase(backend)
const { db } = await import("@/db/database")

const deckId = "bench-deck"
const now = Date.now()
await db.transaction(async (tx) => {
  await tx.execute(
    "INSERT INTO decks (id, parentId, name, updatedAt, deletedAt) VALUES (?, NULL, ?, ?, NULL)",
    [deckId, "Bench", now]
  )
  // 1/3 new, 1/3 learning due now, 1/3 review due today.
  const note = sqlite.prepare(
    `INSERT INTO notes (id, topicId, sl, question, options, correctIndex, extra, tags, contentUpdatedAt, deletedAt)
     VALUES (?, ?, ?, ?, ?, 0, '', '[]', ?, NULL)`
  )
  const card = sqlite.prepare(
    `INSERT INTO cards (cardId, noteId, topicId, due, stability, difficulty, elapsedDays, scheduledDays,
      learningSteps, reps, lapses, state, lastReview, updatedAt, flag, suspended, buriedUntil, markedAt)
     VALUES (?, ?, ?, ?, ?, 5, 0, 3, 1, 3, 0, ?, ?, ?, 0, 0, 0, 0)`
  )
  for (let i = 0; i < CARDS; i++) {
    const id = `bench-${i}`
    note.run(id, deckId, i + 1, `Question number ${i}?`, JSON.stringify(["a", "b", "c", "d"]), now)
    const state = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2
    card.run(id, id, deckId, now, 10 + (i % 100), state, now, now)
  }
})

for (let i = 0; i < 2; i++) {
  const dash = await time(`loadDashboard (${CARDS} cards)`, () => loadDashboard(now))
  console.log("  counts:", dash.counts.get(deckId))
  const cards = await time("loadStudyCards", () => loadStudyCards({ kind: "deck", id: deckId }))
  console.log("  rows:", cards.length)
  const counts = await time("countCards", () => countCards(cards, now))
  console.log("  counts:", counts)
  const queue = await time("buildQueue", () =>
    buildQueue({ cards, now, seed: "bench", newLimit: 200, mixed: true })
  )
  console.log("  queue:", queue.length)
  const ids = await time("loadStudyQueueIds (SQL)", () =>
    loadStudyQueueIds({ kind: "deck", id: deckId }, now, { newLimit: null })
  )
  console.log("  ids:", {
    learning: ids.learning.length,
    review: ids.review.length,
    fresh: ids.fresh.length,
  })
  const assembled = await time("assembleQueue", () =>
    assembleQueue(ids, "bench", true)
  )
  console.log("  assembled:", assembled.length)
}

rmSync(dir, { recursive: true, force: true })
