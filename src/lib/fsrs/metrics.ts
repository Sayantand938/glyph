import { makeContext, replay } from "./model"
import { GUESS_FLOOR } from "./params"
import type { FitMetrics, Sequence } from "./types"

const BINS = 15
const EPS = 1e-7

export interface Evaluation extends FitMetrics {
  /** Loss of each scored review, in a fixed order (for paired comparisons). */
  losses: Float64Array
}

/** Scores every long-term review of `sequences` under `weights`. */
export function evaluate(
  sequences: readonly Sequence[],
  weights: readonly number[],
  guessFloor = GUESS_FLOOR
): Evaluation {
  const ctx = makeContext(weights)
  const losses: number[] = []
  const binN = new Float64Array(BINS)
  const binP = new Float64Array(BINS)
  const binY = new Float64Array(BINS)
  const lo = guessFloor

  for (const seq of sequences) {
    replay(ctx, seq, guessFloor, (p, y) => {
      const q = Math.min(1 - EPS, Math.max(EPS, p))
      losses.push(y === 1 ? -Math.log(q) : -Math.log(1 - q))
      const bin = Math.min(
        BINS - 1,
        Math.max(0, Math.floor(((p - lo) / (1 - lo)) * BINS))
      )
      binN[bin] += 1
      binP[bin] += p
      binY[bin] += y
    })
  }

  const n = losses.length
  let sum = 0
  for (const x of losses) sum += x
  let squared = 0
  for (let b = 0; b < BINS; b++) {
    if (binN[b] === 0) continue
    squared += binN[b] * (binP[b] / binN[b] - binY[b] / binN[b]) ** 2
  }
  return {
    n,
    logLoss: n ? sum / n : 0,
    rmse: n ? Math.sqrt(squared / n) : 0,
    losses: Float64Array.from(losses),
  }
}
