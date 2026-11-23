/**
 * Year-long study simulation. Drives the real scheduler (`grade`), queue
 * builder and re-queue helpers the way the study screen does, but with a
 * simulated learner instead of a person and no DB or React.
 *
 * The learner's memory is a separate, deliberately different model from FSRS
 * (exponential forgetting with a per-card half-life), so the scheduler is
 * tested against something it does not already assume.
 */
import {
  DEFAULT_RETENTION,
  Rating,
  State,
  emptyCardRow,
  grade,
  type Grade,
  type Weights,
} from "@/db/scheduler"
import type { CardRow, RevlogRow } from "@/db/types"
import { buildQueue, countCards } from "@/lib/queue"
import { requeueAgain, requeueGap } from "@/lib/session"
import { mulberry32 } from "@/lib/shuffle"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Chance of picking the right option of four when the answer is not known. */
const GUESS_CHANCE = 0.25
/** Safety valve: one card shown this often in one session is a scheduler bug. */
const MAX_VIEWS_PER_SESSION = 40

export interface Scenario {
  name: string
  /** One id per card; the scheduler only needs them to be unique. */
  cardIds: string[]
  days: number
  /** Multiplies the learner's memory half-life (0.5 weak, 1 average, 2 strong). */
  skill: number
  /** true: rates Again after a lucky guess. false: always presses Good when right. */
  honest: boolean
  sessionsPerDay: number
  /** Chance of skipping a whole day. */
  skipProbability: number
  vacation?: { startDay: number; lengthDays: number }
  /** More than one break (same meaning as `vacation`). */
  vacations?: { startDay: number; lengthDays: number }[]
  /**
   * New cards introduced per day (the study options page's "Max new cards").
   * Applied to the day's first session; omitted = no limit, as before.
   */
  newPerDay?: number
  /** ms epoch of the first day (local midnight); default 2026-01-01. */
  startMs?: number
  /**
   * The learner stops after this many answers in a day (their own time limit;
   * the app has none). Whatever is left stays due. Omitted = answers everything.
   */
  maxAnswersPerDay?: number
  /**
   * The learner sets the day's new-card limit to what is left of
   * `maxAnswersPerDay` after the due reviews (as the study options page lets
   * them do), at most `newPerDay` when that is also given.
   */
  fillWithNew?: boolean
  /** Session start varies by up to this many hours either side of 09:00. */
  startJitterHours: number
  seed: number
}

interface Memory {
  known: boolean
  halfLifeDays: number
  lastSeen: number
  /** 0 easy .. 1 hard. */
  difficulty: number
}

export interface ReviewEvent {
  day: number
  cardId: string
  stateBefore: number
  rating: Grade
  /** The learner truly remembered (not a guess). */
  recalled: boolean
  /** Probability of recall at the moment of the review. */
  pRecall: number
  elapsedDays: number
  scheduledDays: number
}

export interface DaySnapshot {
  day: number
  answers: number
  newSeen: number
  /** Cards already due when the day's first session started. */
  backlog: number
  /** Cards in State New / Learning / Review / Relearning at day end. */
  states: [number, number, number, number]
}

export interface SimResult {
  scenario: Scenario
  events: ReviewEvent[]
  logs: RevlogRow[]
  rows: CardRow[]
  days: DaySnapshot[]
  /** First day each card reached the Review state. */
  graduatedDay: Map<string, number>
  /** Learning cards that became due during a session but were not shown in it. */
  learningLeftBehind: number
  violations: string[]
}

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite)
}

/** Checks one review against rules any correct scheduler must satisfy. */
function checkReview(
  before: CardRow,
  rating: Grade,
  after: CardRow,
  now: number,
  out: string[]
) {
  const tag = `${before.cardId.slice(0, 6)} ${State[before.state]}+${Rating[rating]}`
  const fail = (what: string) => {
    if (out.length < 25) out.push(`${tag}: ${what}`)
  }

  if (
    !finite(
      after.due,
      after.stability,
      after.difficulty,
      after.scheduledDays,
      after.elapsedDays
    )
  ) {
    fail("non-finite number in row")
    return
  }
  if (after.due < now) fail("due is in the past")
  if (after.stability <= 0) fail("stability <= 0")
  if (after.difficulty < 1 || after.difficulty > 10) {
    fail(`difficulty ${after.difficulty} outside 1..10`)
  }
  if (after.reps !== before.reps + 1) fail("reps did not increase by 1")
  const lapse = rating === Rating.Again && before.state === State.Review
  if (after.lapses !== before.lapses + (lapse ? 1 : 0)) {
    fail("lapses changed wrongly")
  }
  if (after.state === State.New) fail("state is still New after a review")

  if (rating === Rating.Again) {
    if (after.state !== State.Learning && after.state !== State.Relearning) {
      fail("Again did not go to Learning/Relearning")
    }
    if (after.due - now > DAY) fail("Again scheduled more than a day away")
  } else if (before.state === State.Review && after.state !== State.Review) {
    fail("Good on a Review card left the Review state")
  }

  if (before.state === State.Review && rating === Rating.Good) {
    if (after.stability < before.stability * 0.999) {
      fail("stability fell after a pass")
    }
    // ts-fsrs fuzzes intervals (about +-1 day near 5 days), so allow that slack.
    if (after.scheduledDays < before.scheduledDays * 0.85 - 1) {
      fail(
        `interval shrank on a pass (${before.scheduledDays} -> ${after.scheduledDays})`
      )
    }
  }
}

/** The FSRS weights the scheduler uses; a driver may change `current` between days. */
export interface WeightsRef {
  current: Weights | undefined
}

/** What a day-by-day driver sees after each simulated day. */
export interface DayInfo {
  day: number
  /** The review log so far (live; do not modify). */
  logs: readonly RevlogRow[]
}

/**
 * Runs one scenario for `scenario.days` days, yielding after each day so a driver
 * can act in between (refit the weights, say). Deterministic for a given seed.
 */
function* simulateSteps(
  scenario: Scenario,
  weights: WeightsRef
): Generator<DayInfo, SimResult> {
  const rnd = mulberry32(scenario.seed)
  // Local midnight: the queue's "due today" rule uses the local calendar day.
  const start = scenario.startMs ?? new Date(2026, 0, 1).getTime()

  const rows = new Map<string, CardRow>()
  const memory = new Map<string, Memory>()
  for (const id of scenario.cardIds) {
    rows.set(id, emptyCardRow({ id, topicId: "topic" }, start))
    memory.set(id, {
      known: false,
      halfLifeDays: 0,
      lastSeen: start,
      difficulty: rnd(),
    })
  }

  const events: ReviewEvent[] = []
  const logs: RevlogRow[] = []
  const days: DaySnapshot[] = []
  const graduatedDay = new Map<string, number>()
  const violations: string[] = []
  let learningLeftBehind = 0

  const baseHalfLife = (m: Memory) =>
    scenario.skill * 6 * (1 - 0.5 * m.difficulty)

  function recallProbability(m: Memory, now: number): number {
    if (!m.known) return 0
    const elapsed = Math.max(0, (now - m.lastSeen) / DAY)
    return Math.pow(2, -elapsed / m.halfLifeDays)
  }

  /** Seeing the answer (right or wrong) updates the learner's memory. */
  function expose(m: Memory, now: number, recalled: boolean, p: number) {
    const elapsed = (now - m.lastSeen) / DAY
    if (!m.known) m.halfLifeDays = baseHalfLife(m)
    else if (recalled) {
      // Massed repetition helps little; spaced, effortful recall helps most.
      const gain =
        elapsed < 0.5 ? 1.1 : 1 + (1.8 - 0.8 * m.difficulty) * (1.5 - p)
      m.halfLifeDays = Math.min(3650, m.halfLifeDays * gain)
    } else {
      m.halfLifeDays = Math.max(m.halfLifeDays * 0.4, baseHalfLife(m) * 0.7)
    }
    m.known = true
    m.lastSeen = now
  }

  /** The rows as the queue and the counts see them. */
  function queueCards() {
    return [...rows.values()].map((r) => ({
      cardId: r.cardId,
      topicId: r.topicId,
      state: r.state,
      due: r.due,
      stability: r.stability,
    }))
  }

  function runSession(
    day: number,
    now: number,
    seed: string,
    newLimit: number | null,
    answerBudget: number
  ): number {
    let queue = buildQueue({
      cards: queueCards(),
      now,
      seed,
      mixed: true,
      newLimit,
    })
    const views = new Map<string, number>()
    let index = 0
    let answers = 0
    let newSeen = 0

    while (index < queue.length && answers < answerBudget) {
      const id = queue[index]
      const row = rows.get(id)
      const mem = memory.get(id)
      if (!row || !mem) throw new Error(`unknown card ${id}`)
      const seen = (views.get(id) ?? 0) + 1
      views.set(id, seen)
      if (seen > MAX_VIEWS_PER_SESSION) {
        violations.push(`${id.slice(0, 6)} shown ${seen} times in one session`)
        index += 1
        continue
      }

      const p = recallProbability(mem, now)
      const recalled = rnd() < p
      const correct = recalled || rnd() < GUESS_CHANCE
      const rating: Grade =
        correct && (recalled || !scenario.honest) ? Rating.Good : Rating.Again
      const durationMs = 6000 + Math.floor(rnd() * 6000) + (correct ? 0 : 4000)

      if (row.state === State.New) newSeen += 1
      events.push({
        day,
        cardId: id,
        stateBefore: row.state,
        rating,
        recalled,
        pRecall: p,
        elapsedDays: row.lastReview > 0 ? (now - row.lastReview) / DAY : 0,
        scheduledDays: row.scheduledDays,
      })

      expose(mem, now, recalled, p)
      const result = grade(
        row,
        rating,
        now,
        durationMs,
        DEFAULT_RETENTION,
        weights.current
      )
      checkReview(row, rating, result.row, now, violations)
      // Good must never schedule sooner than Again for the same card and moment.
      const worst = grade(
        row,
        Rating.Again,
        now,
        durationMs,
        DEFAULT_RETENTION,
        weights.current
      ).row
      if (rating === Rating.Good && result.row.due < worst.due) {
        violations.push(`${id.slice(0, 6)}: Good due earlier than Again`)
      }
      rows.set(id, result.row)
      logs.push(result.log)
      if (result.row.state === State.Review && !graduatedDay.has(id)) {
        graduatedDay.set(id, day)
      }

      answers += 1
      now += durationMs
      if (rating === Rating.Again) {
        const gap = requeueGap(seed, id, index)
        queue = requeueAgain(queue, index, gap)
      }
      index += 1
    }

    for (const r of rows.values()) {
      if (
        (r.state === State.Learning || r.state === State.Relearning) &&
        r.due <= now
      ) {
        learningLeftBehind += 1
      }
    }

    daySession.answers += answers
    daySession.newSeen += newSeen
    return now
  }

  let daySession: DaySnapshot = {
    day: 0,
    answers: 0,
    newSeen: 0,
    backlog: 0,
    states: [0, 0, 0, 0],
  }

  for (let day = 0; day < scenario.days; day += 1) {
    daySession = {
      day,
      answers: 0,
      newSeen: 0,
      backlog: 0,
      states: [0, 0, 0, 0],
    }
    const onVacation = [
      ...(scenario.vacation ? [scenario.vacation] : []),
      ...(scenario.vacations ?? []),
    ].some((v) => day >= v.startDay && day < v.startDay + v.lengthDays)
    const skipped = onVacation || rnd() < scenario.skipProbability

    if (!skipped) {
      let counts = { new: 0, learning: 0, due: 0 }
      for (let s = 0; s < scenario.sessionsPerDay; s += 1) {
        const jitter = (rnd() * 2 - 1) * scenario.startJitterHours * HOUR
        const now = start + day * DAY + (9 + s * 10) * HOUR + jitter
        if (s === 0) {
          counts = countCards(queueCards(), now)
          daySession.backlog = counts.learning + counts.due
        }
        const cap = scenario.maxAnswersPerDay ?? Infinity
        let newLimit =
          scenario.newPerDay === undefined
            ? null
            : s === 0
              ? scenario.newPerDay
              : 0
        if (scenario.fillWithNew && s === 0) {
          // Wrong answers come back, so a due card costs a little over one answer.
          const expected = Math.ceil((counts.learning + counts.due) * 1.3)
          const room = Math.max(0, cap - expected)
          newLimit = Math.min(room, scenario.newPerDay ?? room)
        }
        runSession(
          day,
          now,
          `sim:${scenario.seed}:${day}:${s}`,
          newLimit,
          Math.max(0, cap - daySession.answers)
        )
      }
    }

    for (const r of rows.values()) daySession.states[r.state] += 1
    days.push(daySession)
    yield { day, logs }
  }

  return {
    scenario,
    events,
    logs,
    rows: [...rows.values()],
    days,
    graduatedDay,
    learningLeftBehind,
    violations,
  }
}

/** Runs one scenario with fixed weights (the defaults unless `weights` says otherwise). */
export function simulate(
  scenario: Scenario,
  weights: WeightsRef = { current: undefined }
): SimResult {
  const steps = simulateSteps(scenario, weights)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

/**
 * Like `simulate`, but `afterDay` runs between days and may change
 * `weights.current`, as the automatic refit does in the app.
 */
export async function simulateAdaptive(
  scenario: Scenario,
  weights: WeightsRef,
  afterDay: (info: DayInfo) => Promise<void>
): Promise<SimResult> {
  const steps = simulateSteps(scenario, weights)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
    await afterDay(next.value)
  }
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((a, b) => a + b, 0) / values.length
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`

/** Plain-text report for one run. */
export function report(result: SimResult): string {
  const { scenario, events, rows, days } = result
  const n = scenario.cardIds.length
  const lines: string[] = []
  lines.push(
    `=== ${scenario.name}  (${n} cards, ${scenario.days} days, skill ${scenario.skill}, ${scenario.honest ? "honest" : "lazy"} rating, ${scenario.sessionsPerDay} session/day)`
  )

  const reviewEvents = events.filter((e) => e.stateBefore === State.Review)
  lines.push(
    `total answers ${events.length} (${(events.length / n).toFixed(1)} per card per year); Review-state answers ${reviewEvents.length}`
  )
  lines.push(
    `Review-state retention: truly recalled ${pct(mean(reviewEvents.map((e) => (e.recalled ? 1 : 0))))}, mean modelled p ${pct(mean(reviewEvents.map((e) => e.pRecall)))}, rated Good ${pct(mean(reviewEvents.map((e) => (e.rating === Rating.Good ? 1 : 0))))}  (target 85%)`
  )

  lines.push(
    "month | answers/day | new | backlog | recall% | mean-interval(d) | N/L/R/RL at end"
  )
  for (let m = 0; m * 30 < scenario.days; m += 1) {
    const slice = days.filter((d) => d.day >= m * 30 && d.day < (m + 1) * 30)
    const active = slice.filter((d) => d.answers > 0)
    const evs = reviewEvents.filter(
      (e) => e.day >= m * 30 && e.day < (m + 1) * 30
    )
    const last = slice[slice.length - 1]
    lines.push(
      `${String(m + 1).padStart(5)} | ${mean(active.map((d) => d.answers))
        .toFixed(1)
        .padStart(
          11
        )} | ${String(slice.reduce((a, d) => a + d.newSeen, 0)).padStart(3)} | ${mean(
        slice.map((d) => d.backlog)
      )
        .toFixed(1)
        .padStart(
          7
        )} | ${evs.length ? pct(mean(evs.map((e) => (e.recalled ? 1 : 0)))).padStart(7) : "    n/a"} | ${
        evs.length
          ? mean(evs.map((e) => e.scheduledDays))
              .toFixed(1)
              .padStart(16)
          : "             n/a"
      } | ${last.states.join("/")}`
    )
  }

  const buckets: [string, number, number][] = [
    ["<=1d", 0, 1],
    ["1-3d", 1, 3],
    ["3-7d", 3, 7],
    ["7-21d", 7, 21],
    ["21-60d", 21, 60],
    ["60-180d", 60, 180],
    [">180d", 180, Infinity],
  ]
  lines.push("calibration by scheduled interval (Review-state answers):")
  for (const [label, lo, hi] of buckets) {
    const evs = reviewEvents.filter(
      (e) => e.scheduledDays > lo && e.scheduledDays <= hi
    )
    if (evs.length === 0) continue
    lines.push(
      `  ${label.padEnd(8)} n=${String(evs.length).padStart(4)}  recalled ${pct(mean(evs.map((e) => (e.recalled ? 1 : 0))))}  mean p ${pct(mean(evs.map((e) => e.pRecall)))}  mean overdue ${mean(evs.map((e) => e.elapsedDays - e.scheduledDays)).toFixed(1)}d`
    )
  }

  const grads = [...result.graduatedDay.values()]
  lines.push(
    `graduated to Review: ${grads.length}/${n}; day reached (median ${percentile(grads, 0.5)}, p90 ${percentile(grads, 0.9)}, max ${grads.length ? Math.max(...grads) : "-"})`
  )
  const intervals = rows.map((r) => r.scheduledDays)
  lines.push(
    `final intervals (d): min ${Math.min(...intervals).toFixed(1)}, median ${percentile(intervals, 0.5).toFixed(1)}, max ${Math.max(...intervals).toFixed(1)}`
  )
  const lapses = rows.map((r) => r.lapses)
  lines.push(
    `lapses per card: mean ${mean(lapses).toFixed(2)}, max ${Math.max(...lapses)}; cards with >=4 lapses: ${lapses.filter((l) => l >= 4).length}`
  )
  const perDay = days.map((d) => d.answers)
  lines.push(
    `answers/day: mean ${mean(perDay).toFixed(1)}, p95 ${percentile(perDay, 0.95)}, max ${Math.max(...perDay)}; learning cards left unseen at session end: ${result.learningLeftBehind}`
  )
  lines.push(
    `invariant violations: ${result.violations.length}${result.violations.length ? "\n  " + result.violations.slice(0, 8).join("\n  ") : ""}`
  )
  return lines.join("\n")
}

export interface Summary {
  /** Share of Review-state answers where the learner truly remembered. */
  recall: number
  /** Share rated Good (higher than `recall` when guesses are rated Good). */
  ratedGood: number
  /** Mean days between the due moment and the actual review (Review state). */
  overdueDays: number
  answersPerCardYear: number
  lapsesPerCard: number
}

export function summarize(result: SimResult): Summary {
  const n = result.scenario.cardIds.length
  const reviews = result.events.filter((e) => e.stateBefore === State.Review)
  return {
    recall: mean(reviews.map((e) => (e.recalled ? 1 : 0))),
    ratedGood: mean(reviews.map((e) => (e.rating === Rating.Good ? 1 : 0))),
    overdueDays: mean(reviews.map((e) => e.elapsedDays - e.scheduledDays)),
    answersPerCardYear:
      (result.events.length / n) * (365 / result.scenario.days),
    lapsesPerCard: mean(result.rows.map((r) => r.lapses)),
  }
}

function sd(values: readonly number[]): number {
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

/** Runs the scenario over many seeds; returns the mean and spread of each metric. */
export function sweep(scenario: Scenario, seeds: number) {
  const all = Array.from({ length: seeds }, (_, i) =>
    summarize(simulate({ ...scenario, seed: 1000 + i }))
  )
  const keys: (keyof Summary)[] = [
    "recall",
    "ratedGood",
    "overdueDays",
    "answersPerCardYear",
    "lapsesPerCard",
  ]
  const out = {} as Record<keyof Summary, { mean: number; sd: number }>
  for (const key of keys) {
    const values = all.map((s) => s[key])
    out[key] = { mean: mean(values), sd: sd(values) }
  }
  return out
}

export function formatSweep(
  scenario: Scenario,
  seeds: number,
  stats: ReturnType<typeof sweep>
): string {
  const f = (k: keyof Summary, digits = 2) =>
    `${stats[k].mean.toFixed(digits)} +-${stats[k].sd.toFixed(digits)}`
  return `${scenario.name.padEnd(54)} recall ${pct(stats.recall.mean)} +-${pct(stats.recall.sd)} | overdue ${f("overdueDays")}d | answers/card/yr ${f("answersPerCardYear", 1)} | lapses/card ${f("lapsesPerCard")}  (${seeds} seeds)`
}
