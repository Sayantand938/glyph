/**
 * Fits the 21 FSRS-6 weights to the user's own review history.
 *
 * Method: maximum a posteriori fitting. The loss is the log loss of "was the
 * answer correct" (see GUESS_FLOOR for the multiple-choice correction) plus a
 * Gaussian prior centred on the default weights, so a small history barely
 * moves them and a large one decides. First the initial stabilities (w0..w3)
 * are fitted one at a time, then all weights together with Adam on mini-batches
 * of cards, with exact gradients from forward-mode autodiff (model-grad.ts).
 *
 * Safety: the fit is done on 80% of the cards and the result is only adopted
 * if it beats the current weights on the other 20% by more than the noise of
 * that comparison (one standard error). Then it is refitted on everything.
 */
import { seededShuffle } from "@/lib/shuffle"

import {
  accumulate,
  clampC,
  constant,
  log,
  neg,
  shift,
  type Dual,
} from "./dual"
import { countScored } from "./history"
import { evaluate } from "./metrics"
import { makeContext, replay } from "./model"
import { makeGradContext, replayGrad } from "./model-grad"
import {
  DEFAULT_WEIGHTS,
  GUESS_FLOOR,
  NUM_WEIGHTS,
  WEIGHT_BOUNDS,
  clipWeights,
} from "./params"
import type { FitMetrics, Sequence } from "./types"

const EPS = 1e-7
/** Fewest long-term reviews worth fitting; below this the defaults stand. */
export const MIN_SCORED_REVIEWS = 300
const MIN_VALIDATION_REVIEWS = 30
const BATCH_SEQUENCES = 128

export interface OptimizeOptions {
  /** The weights in use now; the fit is adopted only if it beats these. */
  baseline?: readonly number[]
  guessFloor?: number
  seed?: string
  minScored?: number
  /** Called with 0..1 as the work proceeds. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export type OptimizeResult =
  | { status: "not-enough-data"; scored: number; needed: number }
  | {
      status: "done"
      /** The weights to use: the fit if `improved`, else the baseline. */
      weights: number[]
      improved: boolean
      scored: number
      cards: number
      /** Baseline vs fit, both on the held-out 20% of cards. */
      before: FitMetrics
      after: FitMetrics
    }

function abortError(): Error {
  const error = new Error("Optimization cancelled")
  error.name = "AbortError"
  return error
}

/** Lets the page paint between slices of work, without a pause per step. */
function makeYielder(signal?: AbortSignal) {
  let last = performance.now()
  return async () => {
    if (signal?.aborted) throw abortError()
    if (performance.now() - last < 30) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    last = performance.now()
    if (signal?.aborted) throw abortError()
  }
}

function hasScored(seq: Sequence): boolean {
  for (let i = 1; i < seq.steps.length; i++) {
    if (seq.steps[i].t >= 1) return true
  }
  return false
}

/** Total log loss of `seqs` (summed, not averaged) under `w`. */
function totalLoss(
  seqs: readonly Sequence[],
  w: readonly number[],
  guessFloor: number
): number {
  const ctx = makeContext(w)
  let sum = 0
  for (const seq of seqs) {
    replay(ctx, seq, guessFloor, (p, y) => {
      const q = Math.min(1 - EPS, Math.max(EPS, p))
      sum += y === 1 ? -Math.log(q) : -Math.log(1 - q)
    })
  }
  return sum
}

const INV_PHI = (Math.sqrt(5) - 1) / 2

/**
 * Fits the stability after a first review with rating `g` (weight g-1): a
 * golden-section search on its logarithm, over the cards that started with that
 * rating, with a soft pull toward the default so a handful of cards can't send
 * it far. Returns the weights unchanged when there are too few such cards.
 */
function fitInitialStability(
  seqs: readonly Sequence[],
  weights: readonly number[],
  g: number,
  guessFloor: number
): { weights: number[]; fitted: boolean } {
  const subset = seqs.filter((s) => s.steps[0].rating === g && hasScored(s))
  const index = g - 1
  if (subset.length < 8) return { weights: [...weights], fitted: false }

  const [lo, hi] = WEIGHT_BOUNDS[index]
  const prior = Math.log(DEFAULT_WEIGHTS[index])
  const cost = (logS: number) => {
    const w = [...weights]
    w[index] = Math.exp(logS)
    return (
      totalLoss(subset, w, guessFloor) + (logS - prior) ** 2 / (2 * 1.5 ** 2)
    )
  }

  let a = Math.log(Math.max(lo, S0_FLOOR))
  let b = Math.log(hi)
  let c = b - (b - a) * INV_PHI
  let d = a + (b - a) * INV_PHI
  let fc = cost(c)
  let fd = cost(d)
  for (let i = 0; i < 30; i++) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - (b - a) * INV_PHI
      fc = cost(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + (b - a) * INV_PHI
      fd = cost(d)
    }
  }
  const result = [...weights]
  result[index] = Math.exp((a + b) / 2)
  return { weights: result, fitted: true }
}

/**
 * Initial stabilities that no card showed evidence for (Hard and Easy, which
 * the two-button app never writes) follow the fitted ones: they keep their
 * default ratio to the nearest fitted neighbour, which also keeps the order
 * Again < Hard < Good < Easy.
 */
function settleUnused(weights: readonly number[], fitted: boolean[]): number[] {
  const w = [...weights]
  const ratio = (i: number) => w[i] / DEFAULT_WEIGHTS[i]
  if (!fitted[1]) {
    const near = [0, 2].filter((i) => fitted[i]).map(ratio)
    if (near.length) {
      const meanLog = near.reduce((a, r) => a + Math.log(r), 0) / near.length
      w[1] = DEFAULT_WEIGHTS[1] * Math.exp(meanLog)
    }
  }
  if (!fitted[3] && fitted[2]) w[3] = DEFAULT_WEIGHTS[3] * ratio(2)
  // Keep the order strictly increasing.
  for (let i = 1; i < 4; i++) w[i] = Math.max(w[i], w[i - 1] * 1.02)
  return clipForFit(w)
}

function pretrain(
  seqs: readonly Sequence[],
  start: readonly number[],
  guessFloor: number
): { weights: number[]; fitted: boolean[] } {
  let w = [...start]
  const fitted = [false, false, false, false]
  for (const g of [1, 3, 2, 4]) {
    const result = fitInitialStability(seqs, w, g, guessFloor)
    w = result.weights
    fitted[g - 1] = result.fitted
  }
  return { weights: settleUnused(w, fitted), fitted }
}

/** ts-fsrs treats any initial stability below this as this (init_stability). */
const S0_FLOOR = 0.1
/** Spread of the prior on ln(w0..w3): about a factor of 4.5 either way. */
const S0_LOG_SIGMA = 1.5

/** Clip to the legal range, and keep initial stabilities where they have an effect. */
function clipForFit(weights: readonly number[]): number[] {
  const w = clipWeights(weights)
  for (let i = 0; i < 4; i++) w[i] = Math.max(w[i], S0_FLOOR)
  return w
}

/** Prior spread per weight: a quarter of its allowed range (w0..w3 are log-scale). */
const PRIOR_SIGMA = WEIGHT_BOUNDS.map(([lo, hi], i) =>
  i < 4 ? S0_LOG_SIGMA : 0.25 * (hi - lo)
)

interface TrainSettings {
  steps: number
  lrMax: number
  lrMin: number
}

async function train(
  seqs: readonly Sequence[],
  start: readonly number[],
  guessFloor: number,
  seed: string,
  settings: TrainSettings,
  tick: (done: number) => Promise<void>
): Promise<number[]> {
  const useful = seqs.filter(hasScored)
  const totalScored = countScored(useful)

  let w = clipForFit(start)
  const m = new Float64Array(NUM_WEIGHTS)
  const v = new Float64Array(NUM_WEIGHTS)
  let order = seededShuffle(useful, `${seed}:0`)
  let cursor = 0
  let epoch = 0

  for (let step = 1; step <= settings.steps; step++) {
    if (cursor >= order.length) {
      epoch += 1
      order = seededShuffle(useful, `${seed}:${epoch}`)
      cursor = 0
    }
    const batch = order.slice(cursor, cursor + BATCH_SEQUENCES)
    cursor += BATCH_SEQUENCES

    const ctx = makeGradContext(w)
    const total: Dual = constant(0, NUM_WEIGHTS)
    let count = 0
    for (const seq of batch) {
      replayGrad(ctx, seq, guessFloor, (p, y) => {
        const q = clampC(p, EPS, 1 - EPS)
        accumulate(total, y === 1 ? neg(log(q)) : neg(log(shift(neg(q), 1))))
        count += 1
      })
    }
    if (count === 0) continue

    const grad = new Float64Array(NUM_WEIGHTS)
    for (let i = 0; i < NUM_WEIGHTS; i++) {
      const sigma = PRIOR_SIGMA[i]
      // Gradient of the negative log prior: Gaussian in w, or in ln(w) for w0..w3.
      const pull =
        i < 4
          ? (Math.log(w[i]) - Math.log(DEFAULT_WEIGHTS[i])) /
            (sigma * sigma * w[i])
          : (w[i] - DEFAULT_WEIGHTS[i]) / (sigma * sigma)
      // Mean loss of the batch + (negative log prior) / (all scored reviews).
      grad[i] = total.g[i] / count + pull / totalScored
    }
    if (!grad.every(Number.isFinite)) return w

    const progress = step / settings.steps
    const lr =
      settings.lrMin +
      0.5 *
        (settings.lrMax - settings.lrMin) *
        (1 + Math.cos(Math.PI * progress))
    const next = [...w]
    for (let i = 0; i < NUM_WEIGHTS; i++) {
      m[i] = 0.9 * m[i] + 0.1 * grad[i]
      v[i] = 0.999 * v[i] + 0.001 * grad[i] * grad[i]
      const mHat = m[i] / (1 - 0.9 ** step)
      const vHat = v[i] / (1 - 0.999 ** step)
      next[i] = w[i] - (lr * mHat) / (Math.sqrt(vHat) + 1e-8)
    }
    w = clipForFit(next)
    await tick(step)
  }
  return w
}

function stepsFor(sequences: number, scale: number): number {
  const perEpoch = Math.ceil(sequences / BATCH_SEQUENCES)
  return Math.round(Math.min(700, Math.max(120, 8 * perEpoch)) * scale)
}

function summary(e: FitMetrics): FitMetrics {
  return { n: e.n, logLoss: e.logLoss, rmse: e.rmse }
}

export async function optimizeWeights(
  sequences: readonly Sequence[],
  options: OptimizeOptions = {}
): Promise<OptimizeResult> {
  const {
    baseline = DEFAULT_WEIGHTS,
    guessFloor = GUESS_FLOOR,
    seed = "glyph-fsrs",
    minScored = MIN_SCORED_REVIEWS,
    onProgress,
    signal,
  } = options

  const scored = countScored(sequences)
  if (scored < minScored) {
    return { status: "not-enough-data", scored, needed: minScored }
  }

  // Work only on cards that have something to learn from, in a fixed order.
  const ordered = [...sequences]
    .filter(hasScored)
    .sort((a, b) => a.cardId.localeCompare(b.cardId))
  const useful = seededShuffle(ordered, seed)
  const validation = useful.filter((_, i) => i % 5 === 0)
  const training = useful.filter((_, i) => i % 5 !== 0)
  if (countScored(validation) < MIN_VALIDATION_REVIEWS) {
    return { status: "not-enough-data", scored, needed: minScored }
  }

  const yielder = makeYielder(signal)
  const firstSteps = stepsFor(training.length, 1)
  const finalSteps = stepsFor(useful.length, 0.5)
  const totalSteps = firstSteps + finalSteps
  let doneBefore = 0
  const tick = async (done: number) => {
    onProgress?.((doneBefore + done) / totalSteps)
    await yielder()
  }

  const start = pretrain(training, DEFAULT_WEIGHTS, guessFloor)
  const candidate = settleUnused(
    await train(
      training,
      start.weights,
      guessFloor,
      seed,
      { steps: firstSteps, lrMax: 0.04, lrMin: 0.004 },
      tick
    ),
    start.fitted
  )

  const base = clipWeights(baseline)
  const before = evaluate(validation, base, guessFloor)
  const after = evaluate(validation, candidate, guessFloor)

  // Paired comparison on the same held-out reviews.
  const n = before.losses.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += before.losses[i] - after.losses[i]
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) {
    variance += (before.losses[i] - after.losses[i] - mean) ** 2
  }
  const standardError = Math.sqrt(variance / Math.max(1, n - 1) / n)
  const improved = mean > 1e-4 && mean > standardError

  if (!improved) {
    onProgress?.(1)
    return {
      status: "done",
      weights: base,
      improved: false,
      scored,
      cards: useful.length,
      before: summary(before),
      after: summary(after),
    }
  }

  doneBefore = firstSteps
  const final = settleUnused(
    await train(
      useful,
      candidate,
      guessFloor,
      `${seed}:final`,
      { steps: finalSteps, lrMax: 0.01, lrMin: 0.001 },
      tick
    ),
    start.fitted
  )
  onProgress?.(1)
  return {
    status: "done",
    weights: final,
    improved: true,
    scored,
    cards: useful.length,
    before: summary(before),
    after: summary(after),
  }
}
