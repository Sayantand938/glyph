/**
 * Closed-loop check of refitting (a manual fit each time the reminder is due): does adopting fitted weights change
 * what the learner experiences over two years (recall, workload) compared with
 * staying on the default weights?
 *
 * The run follows the app's own rule: after each simulated day, if
 * `fitReminderDue` says so (1,000 reviews since the last fit), the optimizer is
 * run on the log so far with the current weights as the baseline, and a better
 * fit is used from then on. It is slow (minutes per learner), so it only runs
 * when SIM_CLOSED_LOOP is set; select one learner with `-t "<name>"`.
 *
 *   SIM_CLOSED_LOOP=1 SIM_REPORT=out.txt npx vitest run src/sim/closed-loop.test.ts
 */
import { appendFileSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { State } from "@/db/scheduler"
import { FIT_REMINDER_STEP } from "@/lib/fsrs"
import { noteId } from "@/lib/hash"
import { parseImportText, validateRows } from "@/lib/importer"

import { runAdaptive } from "./refit-driver"
import { simulate, type Scenario, type SimResult } from "./simulate"

const REPORT_FILE = process.env.SIM_REPORT
const DAYS = 730
const YEAR = 365

const file = fileURLToPath(
  new URL("../../sample-data/lorem-1000.json", import.meta.url)
)
const parsed = parseImportText(readFileSync(file, "utf8"))
if (!parsed.ok) throw new Error(parsed.error)
const cardIds = validateRows(parsed.rows).valid.map((row) =>
  noteId("topic", row.question)
)

const base: Scenario = {
  name: "",
  cardIds,
  days: DAYS,
  skill: 1,
  honest: true,
  sessionsPerDay: 1,
  skipProbability: 0.05,
  startJitterHours: 2,
  newPerDay: 30,
  seed: 41,
}

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const pct = (x: number) => `${(100 * x).toFixed(1)}%`

interface Metrics {
  recallY1: number
  recallY2: number
  ratedGoodY2: number
  answersY1: number
  answersY2: number
  /** Answers per active day in the second half of year 2. */
  perDayLate: number
  lapsesPerCard: number
  medianStability: number
  medianInterval: number
}

function metricsOf(result: SimResult): Metrics {
  const reviews = result.events.filter((e) => e.stateBefore === State.Review)
  const y1 = reviews.filter((e) => e.day < YEAR)
  const y2 = reviews.filter((e) => e.day >= YEAR)
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
  const late = result.days.filter((d) => d.day >= 548 && d.answers > 0)
  return {
    recallY1: mean(y1.map((e) => (e.recalled ? 1 : 0))),
    recallY2: mean(y2.map((e) => (e.recalled ? 1 : 0))),
    ratedGoodY2: mean(y2.map((e) => (e.rating === 3 ? 1 : 0))),
    answersY1: result.events.filter((e) => e.day < YEAR).length,
    answersY2: result.events.filter((e) => e.day >= YEAR).length,
    perDayLate: mean(late.map((d) => d.answers)),
    lapsesPerCard: mean(result.rows.map((r) => r.lapses)),
    medianStability: median(result.rows.map((r) => r.stability)),
    medianInterval: median(result.rows.map((r) => r.scheduledDays)),
  }
}

function line(label: string, m: Metrics): string {
  return `${label.padEnd(26)} recall y1 ${pct(m.recallY1)} y2 ${pct(m.recallY2)} | rated Good y2 ${pct(m.ratedGoodY2)} | answers y1 ${m.answersY1} y2 ${m.answersY2} | late answers/day ${m.perDayLate.toFixed(1)} | lapses/card ${m.lapsesPerCard.toFixed(2)} | median stability ${m.medianStability.toFixed(0)}d interval ${m.medianInterval.toFixed(0)}d`
}

function averaged(all: Metrics[]): Metrics {
  const keys = Object.keys(all[0]) as (keyof Metrics)[]
  const out = {} as Metrics
  for (const key of keys) out[key] = mean(all.map((m) => m[key]))
  return out
}

const learners: { name: string; scenario: Scenario }[] = [
  { name: "average, honest", scenario: { ...base } },
  { name: "strong memory (skill 2)", scenario: { ...base, skill: 2 } },
  { name: "weak memory (skill 0.5)", scenario: { ...base, skill: 0.5 } },
  { name: "average, lazy rating", scenario: { ...base, honest: false } },
]

describe.skipIf(!process.env.SIM_CLOSED_LOOP)("closed-loop refit", () => {
  for (const { name, scenario } of learners) {
    it(name, { timeout: 4 * 3_600_000 }, async () => {
      const out: string[] = [`=== ${name}, 1000 cards, ${DAYS} days`]

      const baselineRuns = [41, 42, 43, 44, 45].map((seed) =>
        metricsOf(simulate({ ...scenario, name, seed }))
      )
      out.push(line("default weights (5 seeds)", averaged(baselineRuns)))

      const adaptive: Metrics[] = []
      for (const seed of [41, 42]) {
        const run = await runAdaptive({ ...scenario, name, seed })
        // An interval can shrink on a pass right after the weights change (the
        // new weights predict faster forgetting); that is expected here, anything
        // else is a real violation.
        const shrank = run.result.violations.filter((v) =>
          v.includes("interval shrank")
        )
        expect(
          run.result.violations.filter((v) => !v.includes("interval shrank"))
        ).toEqual([])
        const m = metricsOf(run.result)
        adaptive.push(m)
        out.push(
          line(`auto refit, seed ${seed}`, m) +
            `\n    ${shrank.length} intervals shrank on a pass right after a weight change, ${run.adopted} fits adopted, ${run.seconds.toFixed(0)} s of optimizer time, final weights ${run.weights ? run.weights.map((w) => w.toFixed(2)).join(" ") : "default"}`
        )
        if (seed === 41)
          out.push(
            ...run.attempts
              .filter((a) => a.adopted)
              .slice(0, 6)
              .map(
                (a) =>
                  `    day ${a.day} (${a.reviews} reviews): adopted, held-out logloss ${a.logLossBefore?.toFixed(4)} -> ${a.logLossAfter?.toFixed(4)}`
              )
          )
      }
      out.push(line("refit every 1k (2 seeds)", averaged(adaptive)))
      out.push(`refit step: ${FIT_REMINDER_STEP} reviews\n`)
      if (REPORT_FILE) appendFileSync(REPORT_FILE, out.join("\n") + "\n")
    })
  }
})
