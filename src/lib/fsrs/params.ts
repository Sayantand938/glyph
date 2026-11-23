/**
 * FSRS-6 parameters, copied from ts-fsrs 5.x so this directory stays free of
 * that dependency (`src/lib/fsrs.test.ts` checks they still agree with it).
 */

export const NUM_WEIGHTS = 21

export const DEFAULT_WEIGHTS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 1e-3, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
])

/** [min, max] per weight (the clamp ts-fsrs applies when it loads them). */
export const WEIGHT_BOUNDS: readonly (readonly [number, number])[] =
  Object.freeze([
    [1e-3, 100],
    [1e-3, 100],
    [1e-3, 100],
    [1e-3, 100],
    [1, 10],
    [1e-3, 4],
    [1e-3, 4],
    [1e-3, 0.75],
    [0, 4.5],
    [0, 0.8],
    [1e-3, 3.5],
    [1e-3, 5],
    [1e-3, 0.25],
    [1e-3, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, 2],
    [0, 2],
    [0.01, 0.8],
    [0.1, 0.8],
  ])

export const S_MIN = 1e-3
export const S_MAX = 36500

/**
 * Chance of picking the right option of four by luck. A correct answer in a
 * multiple-choice app is "remembered OR guessed", so the optimizer models the
 * chance of a correct answer as floor + (1 - floor) * R, where R is the real
 * chance of remembering. That keeps lucky guesses from flattening the fitted
 * forgetting curve. Anki has no such floor because a flashcard can't be guessed.
 */
export const GUESS_FLOOR = 0.25

export function clipWeights(weights: readonly number[]): number[] {
  return WEIGHT_BOUNDS.map(([lo, hi], i) =>
    Math.min(hi, Math.max(lo, weights[i]))
  )
}

/** Reads stored weights: 21 finite numbers (clipped to range), else null. */
export function parseWeights(stored: unknown): number[] | null {
  if (!Array.isArray(stored) || stored.length !== NUM_WEIGHTS) return null
  if (!stored.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return null
  }
  return clipWeights(stored as number[])
}

export function isDefaultWeights(weights: readonly number[]): boolean {
  return weights.every((w, i) => w === DEFAULT_WEIGHTS[i])
}
