/**
 * The FSRS-6 memory model in plain numbers: replays a card's reviews and
 * predicts each long-term review. It follows ts-fsrs 5.x step by step (same
 * formulas, same short-term rule for reviews within a day), so weights fitted
 * here mean exactly what the scheduler does with them. `src/lib/fsrs.test.ts`
 * replays reviews through both and compares.
 */
import { S_MAX, S_MIN } from "./params"
import type { Sequence } from "./types"

export interface ModelContext {
  w: readonly number[]
  decay: number
  factor: number
  /** Initial difficulty for an Easy first review (the mean-reversion target). */
  d0Easy: number
}

export function makeContext(w: readonly number[]): ModelContext {
  const decay = -w[20]
  return {
    w,
    decay,
    factor: Math.exp(Math.log(0.9) / decay) - 1,
    d0Easy: w[4] - Math.exp(3 * w[5]) + 1,
  }
}

/** Probability of recall `t` days after a review, for stability `s`. */
export function retrievability(ctx: ModelContext, t: number, s: number) {
  return Math.pow(1 + (ctx.factor * t) / s, ctx.decay)
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x))

/** Called for every scored review with the predicted P(correct) and the outcome. */
export type Scorer = (p: number, correct: 0 | 1) => void

/**
 * Replays one card. Reviews after the first that come at least a day later are
 * scored; same-day reviews only move the memory state. Returns the final state.
 */
export function replay(
  ctx: ModelContext,
  seq: Sequence,
  guessFloor: number,
  score?: Scorer
): { stability: number; difficulty: number } {
  const w = ctx.w
  let s = 0
  let d = 0
  seq.steps.forEach(({ rating: g, t }, index) => {
    if (index === 0) {
      s = Math.max(w[g - 1], 0.1)
      d = clamp(w[4] - Math.exp((g - 1) * w[5]) + 1, 1, 10)
      return
    }
    let nextS: number
    if (t === 0) {
      const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]))
      nextS = clamp(s * (g >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX)
    } else {
      const r = retrievability(ctx, t, s)
      score?.(guessFloor + (1 - guessFloor) * r, g > 1 ? 1 : 0)
      if (g === 1) {
        const failed = clamp(
          w[11] *
            Math.pow(d, -w[12]) *
            (Math.pow(s + 1, w[13]) - 1) *
            Math.exp((1 - r) * w[14]),
          S_MIN,
          S_MAX
        )
        nextS = Math.min(Math.max(s / Math.exp(w[17] * w[18]), S_MIN), failed)
      } else {
        const bonus = g === 2 ? w[15] : g === 4 ? w[16] : 1
        nextS = clamp(
          s *
            (1 +
              Math.exp(w[8]) *
                (11 - d) *
                Math.pow(s, -w[9]) *
                (Math.exp((1 - r) * w[10]) - 1) *
                bonus),
          S_MIN,
          S_MAX
        )
      }
    }
    const delta = -w[6] * (g - 3)
    const next = d + (delta * (10 - d)) / 9
    d = clamp(w[7] * ctx.d0Easy + (1 - w[7]) * next, 1, 10)
    s = nextS
  })
  return { stability: s, difficulty: d }
}
