import { appendFileSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { noteId } from "@/lib/hash"
import { parseImportText, validateRows } from "@/lib/importer"

import { formatSweep, report, simulate, sweep, type Scenario } from "./simulate"

// Set SIM_REPORT to a file path to append the full report of every scenario.
const REPORT_FILE = process.env.SIM_REPORT

const file = fileURLToPath(
  new URL("../../sample-data/capitals-and-currencies.json", import.meta.url)
)
const parsed = parseImportText(readFileSync(file, "utf8"))
if (!parsed.ok) throw new Error(parsed.error)
const { valid, invalid } = validateRows(parsed.rows)
const cardIds = valid.map((row) => noteId("topic", row.question))

const base: Scenario = {
  name: "",
  cardIds,
  days: 365,
  skill: 1,
  honest: true,
  sessionsPerDay: 1,
  skipProbability: 0,
  startJitterHours: 2,
  seed: 1,
}

describe("sample data", () => {
  it("has 30 valid, distinct questions", () => {
    expect(invalid).toEqual([])
    expect(valid).toHaveLength(30)
    expect(new Set(cardIds).size).toBe(30)
  })
})

const scenarios: Scenario[] = [
  { ...base, name: "average learner, daily, honest" },
  { ...base, name: "average learner, 2 sessions/day", sessionsPerDay: 2 },
  {
    ...base,
    name: "realistic: skips 15% of days, 14-day vacation, lazy rating",
    skipProbability: 0.15,
    vacation: { startDay: 120, lengthDays: 14 },
    honest: false,
    seed: 2,
  },
  { ...base, name: "weak learner (half the memory)", skill: 0.5, seed: 3 },
  { ...base, name: "strong learner (double the memory)", skill: 2, seed: 4 },
  {
    ...base,
    name: "30-day vacation",
    vacation: { startDay: 150, lengthDays: 30 },
    seed: 5,
  },
  {
    ...base,
    name: "300 cards imported at once",
    cardIds: Array.from({ length: 300 }, (_, i) => `card-${i}`),
    seed: 6,
  },
]

describe("one-year scheduling simulation", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = simulate(scenario)
      if (REPORT_FILE) appendFileSync(REPORT_FILE, report(result) + "\n\n")
      expect(result.violations).toEqual([])
      // Every card must reach the Review state soon after it is first shown.
      expect(result.graduatedDay.size).toBe(scenario.cardIds.length)
      expect(Math.max(...result.graduatedDay.values())).toBeLessThanOrEqual(10)
    })
  }
})

describe("retention across many seeds (a single run is noisy)", () => {
  const SEEDS = 30
  const variants: Scenario[] = [
    { ...base, name: "average learner, start time +-2h" },
    {
      ...base,
      name: "average learner, SAME start time daily",
      startJitterHours: 0,
    },
    {
      ...base,
      name: "average learner, lazy rating (guess = Good)",
      honest: false,
    },
    { ...base, name: "weak learner", skill: 0.5 },
    { ...base, name: "strong learner", skill: 2 },
  ]

  for (const scenario of variants) {
    it(scenario.name, () => {
      const stats = sweep(scenario, SEEDS)
      if (REPORT_FILE) {
        appendFileSync(REPORT_FILE, formatSweep(scenario, SEEDS, stats) + "\n")
      }
      expect(stats.recall.mean).toBeGreaterThan(0.7)
      expect(stats.recall.mean).toBeLessThan(0.97)
    })
  }
})
