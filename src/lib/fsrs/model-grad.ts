/**
 * The same model as model.ts, written with `Dual` numbers so each scored
 * review also carries its gradient with respect to the 21 weights. Kept next
 * to model.ts on purpose: the test suite checks the two agree and that the
 * gradient matches finite differences.
 */
import {
  add,
  clampC,
  constant,
  div,
  exp,
  maxC,
  minOf,
  mul,
  neg,
  pow,
  scale,
  shift,
  sub,
  variable,
  type Dual,
} from "./dual"
import { NUM_WEIGHTS, S_MAX, S_MIN } from "./params"
import type { Sequence } from "./types"

export interface GradContext {
  w: Dual[]
  decay: Dual
  factor: Dual
  d0Easy: Dual
}

export function makeGradContext(weights: readonly number[]): GradContext {
  const n = NUM_WEIGHTS
  const w = weights.map((v, i) => variable(v, i, n))
  const decay = neg(w[20])
  // factor = 0.9^(1 / decay) - 1
  const factor = shift(exp(div(constant(Math.log(0.9), n), decay)), -1)
  const d0Easy = shift(sub(w[4], exp(scale(w[5], 3))), 1)
  return { w, decay, factor, d0Easy }
}

/** Called for every scored review with the predicted P(correct) and the outcome. */
export type GradScorer = (p: Dual, correct: 0 | 1) => void

export function replayGrad(
  ctx: GradContext,
  seq: Sequence,
  guessFloor: number,
  score: GradScorer
): void {
  const { w } = ctx
  const n = NUM_WEIGHTS
  let s: Dual = constant(0, n)
  let d: Dual = constant(0, n)
  seq.steps.forEach(({ rating: g, t }, index) => {
    if (index === 0) {
      s = maxC(w[g - 1], 0.1)
      d = clampC(shift(sub(w[4], exp(scale(w[5], g - 1))), 1), 1, 10)
      return
    }
    let nextS: Dual
    if (t === 0) {
      let sinc = mul(pow(s, neg(w[19])), exp(mul(w[17], shift(w[18], g - 3))))
      if (g >= 2) sinc = maxC(sinc, 1)
      nextS = clampC(mul(s, sinc), S_MIN, S_MAX)
    } else {
      // r = (1 + factor * t / s) ^ decay
      const r = pow(shift(scale(div(ctx.factor, s), t), 1), ctx.decay)
      score(shift(scale(r, 1 - guessFloor), guessFloor), g > 1 ? 1 : 0)
      const oneMinusR = shift(neg(r), 1)
      if (g === 1) {
        const failed = clampC(
          mul(
            mul(
              mul(w[11], pow(d, neg(w[12]))),
              shift(pow(shift(s, 1), w[13]), -1)
            ),
            exp(mul(oneMinusR, w[14]))
          ),
          S_MIN,
          S_MAX
        )
        const floor = maxC(div(s, exp(mul(w[17], w[18]))), S_MIN)
        nextS = minOf(floor, failed)
      } else {
        let gain = mul(
          mul(mul(exp(w[8]), shift(neg(d), 11)), pow(s, neg(w[9]))),
          shift(exp(mul(oneMinusR, w[10])), -1)
        )
        if (g === 2) gain = mul(gain, w[15])
        else if (g === 4) gain = mul(gain, w[16])
        nextS = clampC(mul(s, shift(gain, 1)), S_MIN, S_MAX)
      }
    }
    // d' = w7 * d0Easy + (1 - w7) * (d + delta * (10 - d) / 9)
    const delta = scale(w[6], -(g - 3))
    const next = add(d, scale(mul(delta, shift(neg(d), 10)), 1 / 9))
    d = clampC(
      add(mul(w[7], ctx.d0Easy), mul(shift(neg(w[7]), 1), next)),
      1,
      10
    )
    s = nextS
  })
}
