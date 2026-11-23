/**
 * A big deck for a heavy learner: 50,000 questions, about 1,000 answers a day.
 * Asks whether that workload is sustainable (does the due backlog stay under the
 * daily budget or grow without end), how fast the deck gets learned, and how big
 * the review log gets (backup size, storage).
 *
 * Slow and memory hungry (millions of simulated answers), so it only runs when
 * SIM_BIG is set; pick one case with `-t "<name>"`.
 *
 *   SIM_BIG=1 SIM_REPORT=out.txt npx vitest run src/sim/big-deck.test.ts -t "fill"
 */
import { appendFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { State } from "@/db/scheduler"

import { runAdaptive } from "./refit-driver"
import { simulate, type Scenario, type SimResult } from "./simulate"

const REPORT_FILE = process.env.SIM_REPORT
const DAYS = Number(process.env.SIM_BIG_DAYS ?? 730)
const CARDS = Number(process.env.SIM_BIG_CARDS ?? 50_000)
const BUDGET = 1000
/** What the learner says: 10-15 seconds a question. */
const SECONDS_PER_ANSWER = 12

const base: Scenario = {
  name: "",
  cardIds: Array.from({ length: CARDS }, (_, i) => `card-${i}`),
  days: DAYS,
  skill: 1,
  honest: true,
  sessionsPerDay: 1,
  skipProbability: 0.05,
  startJitterHours: 2,
  maxAnswersPerDay: BUDGET,
  seed: 51,
}

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const pct = (x: number) => `${(100 * x).toFixed(1)}%`

function summary(result: SimResult): string {
  const { days, events, rows } = result
  const lines: string[] = []
  lines.push(
    "quarter | answers/day | hours/day | days at the limit | backlog at start | new cards seen | recall | mean days overdue"
  )
  let introduced = 0
  for (let q = 0; q * 91 < DAYS; q += 1) {
    const lo = q * 91
    const hi = Math.min(DAYS, (q + 1) * 91)
    const slice = days.filter((d) => d.day >= lo && d.day < hi)
    const active = slice.filter((d) => d.answers > 0)
    introduced += slice.reduce((a, d) => a + d.newSeen, 0)
    const evs = events.filter(
      (e) => e.day >= lo && e.day < hi && e.stateBefore === State.Review
    )
    const answers = mean(active.map((d) => d.answers))
    lines.push(
      `${String(q + 1).padStart(7)} | ${answers.toFixed(0).padStart(11)} | ${((answers * SECONDS_PER_ANSWER) / 3600).toFixed(1).padStart(9)} | ${pct(
        active.filter((d) => d.answers >= BUDGET - 5).length /
          Math.max(1, active.length)
      ).padStart(17)} | ${mean(slice.map((d) => d.backlog))
        .toFixed(0)
        .padStart(
          16
        )} | ${String(introduced).padStart(14)} | ${evs.length ? pct(mean(evs.map((e) => (e.recalled ? 1 : 0)))).padStart(6) : "   n/a"} | ${evs.length ? mean(evs.map((e) => e.elapsedDays - e.scheduledDays)).toFixed(1) : "n/a"}`
    )
  }
  const seen = rows.filter((r) => r.state !== State.New).length
  const due = days[days.length - 1].backlog
  lines.push(
    `cards started: ${seen} of ${rows.length}; reviews in the log: ${result.logs.length} (about ${((result.logs.length * 330) / 1e6).toFixed(0)} MB of backup JSON for the log alone at ~330 bytes each); due at the last day's start: ${due}; violations: ${result.violations.length}`
  )
  return lines.join("\n")
}

const cases: {
  name: string
  scenario: Partial<Scenario>
  /** Run with the automatic refit between days. */
  refit?: boolean
}[] = [
  { name: "fixed 100 new a day", scenario: { newPerDay: 100 } },
  { name: "fixed 200 new a day", scenario: { newPerDay: 200 } },
  {
    name: "fill the day with new cards after reviews",
    scenario: { fillWithNew: true },
  },
  {
    name: "fill, with automatic refit",
    scenario: { fillWithNew: true, seed: 53 },
    refit: true,
  },
  {
    name: "fill, weak memory",
    scenario: { fillWithNew: true, skill: 0.5, seed: 52 },
  },
]

describe.skipIf(!process.env.SIM_BIG)(
  "50,000 cards, 1,000 answers a day",
  () => {
    for (const { name, scenario, refit } of cases) {
      it(name, { timeout: 4 * 3_600_000 }, async () => {
        const t0 = performance.now()
        const full = { ...base, ...scenario, name }
        let extra = ""
        let result: SimResult
        if (refit) {
          const run = await runAdaptive(full)
          result = run.result
          const slow = [...run.attempts].sort(
            (x, y) => y.seconds - x.seconds
          )[0]
          extra = `refit: ${run.attempts.length} attempts, ${run.adopted} adopted, ${run.seconds.toFixed(0)} s of optimizer time in total, slowest ${slow ? `${slow.seconds.toFixed(0)} s at ${slow.reviews} reviews` : "n/a"}; adopted on days ${run.attempts
            .filter((x) => x.adopted)
            .map((x) => x.day)
            .join(", ")}
`
        } else {
          result = simulate(full)
        }
        const seconds = (performance.now() - t0) / 1000
        const text = `=== ${name}: ${CARDS} cards, ${DAYS} days, limit ${BUDGET} answers/day at ${SECONDS_PER_ANSWER}s each (simulated in ${seconds.toFixed(0)}s)
${summary(result)}
${extra}`
        if (REPORT_FILE) appendFileSync(REPORT_FILE, text)
        expect(result.violations).toEqual([])
      })
    }
  }
)
