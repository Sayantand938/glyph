/** One review in a card's history. */
export interface Step {
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. The app only writes 1 and 3. */
  rating: number
  /** Whole 24-hour periods since the previous review (0 for the first). */
  t: number
}

/** The reviews of one card, from its first review (state New) onward. */
export interface Sequence {
  cardId: string
  steps: Step[]
}

export interface FitMetrics {
  /** Reviews scored (those at least a day after the previous one). */
  n: number
  /** Mean binary cross-entropy of predicted vs actual correct answers. */
  logLoss: number
  /** Calibration error: predicted vs actual correct rate, in probability bins. */
  rmse: number
}
