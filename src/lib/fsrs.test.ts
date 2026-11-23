import {
  CLAMP_PARAMETERS,
  createEmptyCard,
  default_w,
  fsrs,
  type Grade,
} from "ts-fsrs"
import { describe, expect, it } from "vitest"

import { emptyCardRow, grade, type Grade as GlyphGrade } from "@/db/scheduler"

import {
  DEFAULT_WEIGHTS,
  MIN_SCORED_REVIEWS,
  WEIGHT_BOUNDS,
  buildSequences,
  countScored,
  elapsedStudyDays,
  evaluate,
  isDefaultWeights,
  optimizeWeights,
  parseWeights,
  toStudyClock,
  type ReviewRecord,
  type Sequence,
} from "./fsrs"
import { constant } from "./fsrs/dual"
import { makeContext, replay, retrievability } from "./fsrs/model"
import { makeGradContext, replayGrad } from "./fsrs/model-grad"
import { GUESS_FLOOR } from "./fsrs/params"
import { mulberry32 } from "./shuffle"

const MIN = 60_000
const DAY = 24 * 60 * MIN

describe("parameters", () => {
  it("match the defaults and bounds ts-fsrs ships", () => {
    expect([...DEFAULT_WEIGHTS]).toEqual([...default_w])
    expect(WEIGHT_BOUNDS.map((b) => [...b])).toEqual(
      CLAMP_PARAMETERS(2, true).map((b) => [...b])
    )
  })

  it("parseWeights accepts 21 finite numbers and clips them", () => {
    expect(parseWeights([...DEFAULT_WEIGHTS])).toEqual([...DEFAULT_WEIGHTS])
    const wild = [...DEFAULT_WEIGHTS]
    wild[8] = 99
    expect(parseWeights(wild)?.[8]).toBe(4.5)
    expect(parseWeights([1, 2, 3])).toBeNull()
    expect(parseWeights("nope")).toBeNull()
    expect(parseWeights([...DEFAULT_WEIGHTS.slice(1), NaN])).toBeNull()
  })

  it("isDefaultWeights is exact", () => {
    expect(isDefaultWeights(DEFAULT_WEIGHTS)).toBe(true)
    const changed = DEFAULT_WEIGHTS.map((w, i) => (i ? w : w + 1))
    expect(isDefaultWeights(changed)).toBe(false)
  })
})

/** A review history as (rating, minutes since the previous review). */
function randomHistory(rnd: () => number, length: number) {
  const gaps = [10, 10, 60 * 24 * 1.3, 60 * 24 * 3, 60 * 24 * 10, 60 * 24 * 40]
  const out: { rating: number; gapMin: number }[] = []
  for (let i = 0; i < length; i++) {
    const r = rnd()
    out.push({
      rating: r < 0.35 ? 1 : r < 0.5 ? 2 : r < 0.9 ? 3 : 4,
      gapMin: i === 0 ? 0 : gaps[Math.floor(rnd() * gaps.length)],
    })
  }
  return out
}

describe("model fidelity to the scheduler", () => {
  /** Reviews a card through Glyph's own scheduler; returns the final row. */
  function throughScheduler(history: ReturnType<typeof randomHistory>) {
    let at = Date.UTC(2026, 0, 1, 9)
    let row = emptyCardRow({ id: "c", topicId: "t" }, at)
    const reviews: ReviewRecord[] = []
    for (const { rating, gapMin } of history) {
      at += gapMin * MIN
      reviews.push({ cardId: "c", reviewedAt: at, rating, state: row.state })
      row = grade(row, rating as GlyphGrade, at).row
    }
    return { row, reviews }
  }

  it("replays two-button histories to the stability and difficulty the scheduler stores", () => {
    const rnd = mulberry32(42)
    for (let trial = 0; trial < 40; trial++) {
      const history = randomHistory(rnd, 4 + Math.floor(rnd() * 9)).map(
        (h) => ({ ...h, rating: h.rating <= 2 ? 1 : 3 })
      )
      const { row, reviews } = throughScheduler(history)
      const [seq] = buildSequences(reviews)
      const { stability, difficulty } = replay(
        makeContext(DEFAULT_WEIGHTS),
        seq,
        GUESS_FLOOR
      )
      expect(stability / row.stability).toBeCloseTo(1, 5)
      expect(difficulty / row.difficulty).toBeCloseTo(1, 5)
    }
  })

  it("also matches ts-fsrs for Hard and Easy and for fitted weights", () => {
    const w = [...DEFAULT_WEIGHTS]
    w[0] = 0.6
    w[2] = 3.1
    w[8] = 1.1
    w[11] = 2.2
    w[20] = 0.3
    const rnd = mulberry32(7)
    const f = fsrs({ enable_fuzz: false, w })
    for (let trial = 0; trial < 30; trial++) {
      let at = Date.UTC(2026, 0, 1, 9)
      let card = createEmptyCard(new Date(toStudyClock(at)))
      const steps: Sequence["steps"] = []
      let previous = at
      for (const { rating, gapMin } of randomHistory(rnd, 8)) {
        at += gapMin * MIN
        card = f.next(card, new Date(toStudyClock(at)), rating as Grade).card
        steps.push({
          rating,
          t: steps.length === 0 ? 0 : elapsedStudyDays(previous, at),
        })
        previous = at
      }
      const { stability } = replay(
        makeContext(w),
        { cardId: "c", steps },
        GUESS_FLOOR
      )
      expect(stability / card.stability).toBeCloseTo(1, 5)
    }
  })

  it("uses fitted weights when the scheduler is given them", () => {
    const fitted = [...DEFAULT_WEIGHTS]
    fitted[2] = 4
    const start = emptyCardRow({ id: "c", topicId: "t" }, Date.UTC(2026, 0, 1))
    const now = Date.UTC(2026, 0, 1, 9)
    const a = grade(start, 3, now).row
    const b = grade(start, 3, now, 0, 0.85, fitted).row
    expect(b.stability).toBeGreaterThan(a.stability)
  })

  it("retrievability is 90% at t = stability", () => {
    expect(retrievability(makeContext(DEFAULT_WEIGHTS), 10, 10)).toBeCloseTo(
      0.9,
      6
    )
  })
})

describe("study days", () => {
  const at = (h: number, m = 0, day = 15) => Date.UTC(2026, 0, day, h, m)
  const utc = () => 0
  const india = () => 330 * MIN
  const california = () => -480 * MIN

  it("counts local calendar days, not 24-hour periods or UTC dates", () => {
    // 23:50 and 00:10 UTC are 20 minutes apart: a day apart in UTC...
    expect(elapsedStudyDays(at(23, 50), at(24, 10), utc)).toBe(1)
    // ...but the same afternoon in California (3:50 pm and 4:10 pm).
    expect(elapsedStudyDays(at(23, 50), at(24, 10), california)).toBe(0)
    // A minute before and after local midnight in India (UTC+5:30).
    expect(elapsedStudyDays(at(18, 29), at(18, 31), india)).toBe(1)
    // 47 hours apart can still be two calendar days.
    expect(elapsedStudyDays(at(0, 30), at(23, 30, 16), utc)).toBe(1)
    expect(elapsedStudyDays(at(23, 30), at(23, 29, 17), utc)).toBe(2)
    // Never negative.
    expect(elapsedStudyDays(at(12, 0, 16), at(12, 0, 15), utc)).toBe(0)
  })

  it("follows the real offset of each timestamp (daylight saving)", () => {
    const offsetOf = (t: number) =>
      t < at(12, 0, 20) ? -480 * MIN : -420 * MIN
    // 7:30 pm the 18th (PST) to 8:30 pm the 20th (PDT): two calendar days.
    expect(elapsedStudyDays(at(3, 30, 19), at(3, 30, 21), offsetOf)).toBe(2)
  })
})

function randomSequences(count: number, seed: number): Sequence[] {
  const rnd = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => ({
    cardId: `c${i}`,
    steps: randomHistory(rnd, 5 + Math.floor(rnd() * 6)).map((h, j) => ({
      rating: h.rating,
      t: j === 0 ? 0 : Math.floor(h.gapMin / (24 * 60)),
    })),
  }))
}

describe("gradient", () => {
  const w = [...DEFAULT_WEIGHTS]
  w[0] = 0.4
  w[8] = 1.5
  w[10] = 0.9
  w[17] = 0.7
  w[20] = 0.25
  const seqs = randomSequences(25, 5)

  function dualLoss(weights: number[]) {
    const ctx = makeGradContext(weights)
    let value = 0
    const grad = new Float64Array(weights.length)
    for (const seq of seqs) {
      replayGrad(ctx, seq, GUESS_FLOOR, (p, y) => {
        const term = y === 1 ? -Math.log(p.v) : -Math.log(1 - p.v)
        const dTerm = y === 1 ? -1 / p.v : 1 / (1 - p.v)
        value += term
        for (let i = 0; i < grad.length; i++) grad[i] += dTerm * p.g[i]
      })
    }
    return { value, grad }
  }

  const plainLoss = (weights: number[]) => {
    const e = evaluate(seqs, weights)
    return e.losses.reduce((a, b) => a + b, 0)
  }

  it("scores the same reviews to the same value as the plain model", () => {
    expect(dualLoss(w).value).toBeCloseTo(plainLoss(w), 8)
  })

  it("matches finite differences for every weight", () => {
    const { grad } = dualLoss(w)
    for (let i = 0; i < w.length; i++) {
      const h = 1e-6 * Math.max(1, Math.abs(w[i]))
      const up = [...w]
      const down = [...w]
      up[i] += h
      down[i] -= h
      const numeric = (plainLoss(up) - plainLoss(down)) / (2 * h)
      expect(Math.abs(grad[i] - numeric)).toBeLessThan(
        1e-4 * (1 + Math.abs(numeric))
      )
    }
    expect(constant(1, 3).g).toHaveLength(3)
  })
})

describe("buildSequences", () => {
  const at = (day: number, minute = 0) =>
    Date.UTC(2026, 0, 1, 9) + day * DAY + minute * MIN
  const utc = () => 0
  const rec = (
    cardId: string,
    reviewedAt: number,
    rating: number,
    state: number
  ) => ({ cardId, reviewedAt, rating, state })

  it("orders reviews and counts calendar days", () => {
    const seqs = buildSequences(
      [
        rec("a", at(3), 3, 2),
        rec("a", at(0), 1, 0),
        rec("a", at(0, 10), 3, 1),
        rec("a", at(1, 23 * 60 + 59), 3, 2),
      ],
      utc
    )
    expect(seqs).toHaveLength(1)
    expect(seqs[0].steps).toEqual([
      { rating: 1, t: 0 },
      { rating: 3, t: 0 },
      { rating: 3, t: 2 },
      { rating: 3, t: 1 },
    ])
  })

  it("starts a new sequence when a card is reset (a New-state review)", () => {
    const seqs = buildSequences(
      [
        rec("a", at(0), 3, 0),
        rec("a", at(5), 3, 2),
        rec("a", at(9), 3, 0),
        rec("a", at(12), 1, 2),
      ],
      utc
    )
    expect(seqs.map((s) => s.steps.length)).toEqual([2, 2])
  })

  it("drops a run whose start is missing, and invalid ratings", () => {
    const seqs = buildSequences(
      [
        rec("a", at(5), 3, 2),
        rec("a", at(9), 3, 2),
        rec("b", at(0), 0, 0),
        rec("b", at(1), 9, 2),
      ],
      utc
    )
    expect(seqs).toEqual([])
  })

  it("counts only reviews a day or more after the previous one", () => {
    const seqs = buildSequences(
      [
        rec("a", at(0), 1, 0),
        rec("a", at(0, 10), 3, 1),
        rec("a", at(2), 3, 2),
        rec("a", at(9), 1, 2),
      ],
      utc
    )
    expect(countScored(seqs)).toBe(2)
  })
})

/**
 * Cards studied under `truth`: the interval before each review varies around
 * what the scheduler would pick, and the answer is correct with the model's own
 * probability (so lucky guesses are in the data, as in a real MCQ app).
 */
function synthesize(
  truth: readonly number[],
  cards: number,
  seed: number
): Sequence[] {
  const rnd = mulberry32(seed)
  const ctx = makeContext(truth)
  const out: Sequence[] = []
  for (let i = 0; i < cards; i++) {
    const steps: Sequence["steps"] = [{ rating: rnd() < 0.3 ? 1 : 3, t: 0 }]
    if (steps[0].rating === 1) steps.push({ rating: 3, t: 0 })
    const rounds = 4 + Math.floor(rnd() * 6)
    for (let k = 0; k < rounds; k++) {
      const { stability } = replay(ctx, { cardId: "x", steps }, GUESS_FLOOR)
      const t = Math.max(1, Math.round(stability * (0.5 + 2 * rnd())))
      const r = retrievability(ctx, t, stability)
      const p = GUESS_FLOOR + (1 - GUESS_FLOOR) * r
      steps.push({ rating: rnd() < p ? 3 : 1, t })
      if (steps[steps.length - 1].rating === 1) steps.push({ rating: 3, t: 0 })
    }
    out.push({ cardId: `c${i}`, steps })
  }
  return out
}

describe("optimizeWeights", () => {
  // A learner whose memory differs a lot from the stock parameters.
  const truth = [...DEFAULT_WEIGHTS]
  truth[0] = 1
  truth[2] = 6
  truth[8] = 2.4
  truth[9] = 0.5
  truth[10] = 1.8
  truth[11] = 3
  truth[20] = 0.4

  it("refuses to fit a tiny history", async () => {
    const result = await optimizeWeights(synthesize(truth, 8, 1))
    expect(result.status).toBe("not-enough-data")
    if (result.status === "not-enough-data") {
      expect(result.needed).toBe(MIN_SCORED_REVIEWS)
    }
  })

  it("learns weights that predict new reviews better than the defaults", async () => {
    const result = await optimizeWeights(synthesize(truth, 500, 11))
    expect(result.status).toBe("done")
    if (result.status !== "done") return
    expect(result.improved).toBe(true)
    expect(result.after.logLoss).toBeLessThan(result.before.logLoss)

    // Initial stabilities stay ordered (Again < Hard < Good < Easy), and every
    // weight stays inside the range ts-fsrs accepts.
    const w = result.weights
    expect(w[0]).toBeLessThan(w[1])
    expect(w[1]).toBeLessThan(w[2])
    expect(w[2]).toBeLessThan(w[3])
    w.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(WEIGHT_BOUNDS[i][0])
      expect(x).toBeLessThanOrEqual(WEIGHT_BOUNDS[i][1])
    })

    // Reviews the fit never saw.
    const fresh = synthesize(truth, 1500, 99)
    const fitted = evaluate(fresh, result.weights)
    const stock = evaluate(fresh, DEFAULT_WEIGHTS)
    const ideal = evaluate(fresh, truth)
    expect(fitted.logLoss).toBeLessThan(stock.logLoss)
    // Most of the way from the defaults to the true weights...
    const gap = stock.logLoss - ideal.logLoss
    expect(stock.logLoss - fitted.logLoss).toBeGreaterThan(0.5 * gap)
    // ...and the predicted rates match what happened much better.
    expect(fitted.rmse).toBeLessThan(0.5 * stock.rmse)
  }, 120_000)

  it("keeps the current weights when the data is what they already predict", async () => {
    const result = await optimizeWeights(synthesize(DEFAULT_WEIGHTS, 300, 21))
    expect(result.status).toBe("done")
    if (result.status !== "done") return
    if (!result.improved) {
      expect(result.weights).toEqual([...DEFAULT_WEIGHTS])
    } else {
      // If it did adopt a fit, it must not be worse on held-out reviews.
      expect(result.after.logLoss).toBeLessThanOrEqual(result.before.logLoss)
    }
  }, 120_000)

  it("can be cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      optimizeWeights(synthesize(truth, 100, 3), { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("reports progress up to 1", async () => {
    const seen: number[] = []
    await optimizeWeights(synthesize(truth, 80, 4), {
      onProgress: (x) => seen.push(x),
      minScored: 100,
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(1)
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0)
  }, 120_000)
})
