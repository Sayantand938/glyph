/**
 * Two-year study simulation on a 1000-question deck (fake lorem ipsum, see
 * sample-data/lorem-1000.json). Same learner model as year.test.ts; this file
 * asks the long-term questions: does the daily workload settle, does a break
 * leave a backlog that never clears, do numbers stay finite, how big does the
 * review log get, and does the automatic FSRS refit stay affordable on it.
 *
 * Set SIM_REPORT=<file> to append the full reports.
 */
import { appendFileSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { State } from "@/db/scheduler"
import { buildSequences, countScored, optimizeWeights } from "@/lib/fsrs"
import { noteId } from "@/lib/hash"
import { parseImportText, validateRows } from "@/lib/importer"

import {
  report,
  simulate,
  type DaySnapshot,
  type Scenario,
  type SimResult,
} from "./simulate"

const REPORT_FILE = process.env.SIM_REPORT
const DAYS = 730

const file = fileURLToPath(
  new URL("../../sample-data/lorem-1000.json", import.meta.url)
)
const parsed = parseImportText(readFileSync(file, "utf8"))
if (!parsed.ok) throw new Error(parsed.error)
const { valid, invalid } = validateRows(parsed.rows)
const cardIds = valid.map((row) => noteId("topic", row.question))

const base: Scenario = {
  name: "",
  cardIds,
  days: DAYS,
  skill: 1,
  honest: true,
  sessionsPerDay: 1,
  skipProbability: 0,
  startJitterHours: 2,
  newPerDay: 30,
  seed: 11,
}

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

function quarterTable(days: DaySnapshot[]): string {
  const lines = [
    "quarter | answers/day (active) | peak | backlog at start of day",
  ]
  for (let q = 0; q * 91 < DAYS; q += 1) {
    const slice = days.filter((d) => d.day >= q * 91 && d.day < (q + 1) * 91)
    const active = slice.filter((d) => d.answers > 0).map((d) => d.answers)
    lines.push(
      `${String(q + 1).padStart(7)} | ${mean(active).toFixed(1).padStart(20)} | ${String(
        Math.max(0, ...active)
      ).padStart(4)} | ${mean(slice.map((d) => d.backlog)).toFixed(1)}`
    )
  }
  return lines.join("\n")
}

function log(text: string) {
  if (REPORT_FILE) appendFileSync(REPORT_FILE, text + "\n")
}

/** Checks that hold for every scenario over two years. */
function checkLongTerm(result: SimResult) {
  expect(result.violations).toEqual([])
  expect(result.graduatedDay.size).toBe(result.scenario.cardIds.length)
  for (const row of result.rows) {
    expect(Number.isFinite(row.stability)).toBe(true)
    expect(Number.isFinite(row.difficulty)).toBe(true)
    expect(Number.isFinite(row.due)).toBe(true)
    expect(row.stability).toBeGreaterThan(0)
    // ts-fsrs caps an interval at 100 years.
    expect(row.scheduledDays).toBeLessThanOrEqual(36500)
  }
  for (const entry of result.logs) {
    expect(Number.isFinite(entry.stabilityAfter)).toBe(true)
    expect(Number.isFinite(entry.dueAfter)).toBe(true)
  }
  // Unique log ids: the backup merge keys on them.
  expect(new Set(result.logs.map((l) => l.id)).size).toBe(result.logs.length)
}

describe("lorem-1000 data", () => {
  it("has 1000 valid, distinct questions", () => {
    expect(invalid).toEqual([])
    expect(valid).toHaveLength(1000)
    expect(new Set(cardIds).size).toBe(1000)
  })
})

interface Case {
  scenario: Scenario
  /** Extra expectations for this scenario. */
  extra?: (result: SimResult) => void
}

const cases: Case[] = [
  {
    scenario: {
      ...base,
      name: "diligent: 30 new/day, every day, honest rating",
    },
    extra: (r) => {
      // Once everything is learned, the daily load must stay bounded.
      const lastYear = r.days.filter((d) => d.day >= 365).map((d) => d.answers)
      expect(Math.max(...lastYear)).toBeLessThan(600)
    },
  },
  {
    scenario: {
      ...base,
      name: "realistic: 20 new/day, skips 15% of days, two breaks, lazy rating",
      newPerDay: 20,
      skipProbability: 0.15,
      vacations: [
        { startDay: 100, lengthDays: 14 },
        { startDay: 400, lengthDays: 45 },
      ],
      honest: false,
      seed: 12,
    },
  },
  {
    scenario: {
      ...base,
      name: "abandoned for 120 days in year one, then comes back",
      vacation: { startDay: 150, lengthDays: 120 },
      seed: 13,
    },
    extra: (r) => {
      // The backlog after the break must clear, not grow forever.
      const tail = r.days.filter((d) => d.day >= 600).map((d) => d.backlog)
      expect(Math.max(...tail)).toBeLessThan(400)
    },
  },
  {
    scenario: {
      ...base,
      name: "weak learner (half the memory), 30 new/day",
      skill: 0.5,
      seed: 14,
    },
  },
  {
    scenario: {
      ...base,
      name: "no new-card limit: all 1000 on day one",
      newPerDay: undefined,
      seed: 15,
    },
  },
  {
    scenario: {
      ...base,
      name: "two sessions a day, 50 new/day",
      newPerDay: 50,
      sessionsPerDay: 2,
      seed: 16,
    },
  },
]

describe("two-year simulation, 1000 cards", () => {
  for (const { scenario, extra } of cases) {
    it(scenario.name, { timeout: 300_000 }, () => {
      const t0 = performance.now()
      const result = simulate(scenario)
      const ms = performance.now() - t0
      const reviews = result.logs.length
      const states = result.rows.reduce(
        (acc, r) => {
          acc[r.state] += 1
          return acc
        },
        [0, 0, 0, 0]
      )
      log(
        report(result) +
          "\n" +
          quarterTable(result.days) +
          `\nreview log rows: ${reviews} (${(reviews / 1000).toFixed(1)}k), simulated in ${(ms / 1000).toFixed(1)}s, final states N/L/R/RL ${states.join("/")}, mean stability ${mean(result.rows.map((r) => r.stability)).toFixed(0)}d, State.Review=${State.Review}\n`
      )
      checkLongTerm(result)
      extra?.(result)
    })
  }
})

describe("automatic refit on a two-year log", () => {
  it(
    "fits in reasonable time and does not blow up",
    { timeout: 600_000 },
    async () => {
      const result = simulate({ ...base, name: "refit input", seed: 21 })
      const records = result.logs.map(
        ({ cardId, reviewedAt, rating, state }) => ({
          cardId,
          reviewedAt,
          rating,
          state,
        })
      )
      const sequences = buildSequences(records)
      const scored = countScored(sequences)
      const t0 = performance.now()
      const fit = await optimizeWeights(sequences)
      const seconds = (performance.now() - t0) / 1000
      log(
        `refit: ${records.length} reviews, ${scored} scored, ${sequences.length} sequences, ${seconds.toFixed(1)}s, status ${fit.status}${
          fit.status === "done"
            ? `, improved ${fit.improved}, logloss ${fit.before.logLoss.toFixed(4)} -> ${fit.after.logLoss.toFixed(4)}, weights finite ${fit.weights.every(Number.isFinite)}`
            : ""
        }\n`
      )
      expect(fit.status).toBe("done")
      if (fit.status === "done") {
        expect(fit.weights.every(Number.isFinite)).toBe(true)
      }
    }
  )
})
