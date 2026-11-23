/**
 * Forward-mode automatic differentiation: a value plus its gradient with
 * respect to the 21 weights. Every operation returns a new object (so values
 * can be shared safely); only `accumulate` mutates, on a private accumulator.
 * This lets the model be written once, as plain formulas, with exact gradients
 * and no hand-derived derivatives to get wrong.
 */
export interface Dual {
  v: number
  g: Float64Array
}

export function constant(v: number, n: number): Dual {
  return { v, g: new Float64Array(n) }
}

export function variable(v: number, index: number, n: number): Dual {
  const g = new Float64Array(n)
  g[index] = 1
  return { v, g }
}

export function add(a: Dual, b: Dual): Dual {
  const n = a.g.length
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = a.g[i] + b.g[i]
  return { v: a.v + b.v, g }
}

export function sub(a: Dual, b: Dual): Dual {
  const n = a.g.length
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = a.g[i] - b.g[i]
  return { v: a.v - b.v, g }
}

export function mul(a: Dual, b: Dual): Dual {
  const n = a.g.length
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = a.g[i] * b.v + b.g[i] * a.v
  return { v: a.v * b.v, g }
}

export function div(a: Dual, b: Dual): Dual {
  const n = a.g.length
  const g = new Float64Array(n)
  const inv = 1 / b.v
  for (let i = 0; i < n; i++) g[i] = (a.g[i] - a.v * b.g[i] * inv) * inv
  return { v: a.v * inv, g }
}

/** a + c for a plain number c. */
export function shift(a: Dual, c: number): Dual {
  return { v: a.v + c, g: a.g }
}

/** a * c for a plain number c. */
export function scale(a: Dual, c: number): Dual {
  const n = a.g.length
  const g = new Float64Array(n)
  for (let i = 0; i < n; i++) g[i] = a.g[i] * c
  return { v: a.v * c, g }
}

export function neg(a: Dual): Dual {
  return scale(a, -1)
}

export function exp(a: Dual): Dual {
  const e = Math.exp(a.v)
  return { v: e, g: a.g.map((x) => x * e) }
}

export function log(a: Dual): Dual {
  const inv = 1 / a.v
  return { v: Math.log(a.v), g: a.g.map((x) => x * inv) }
}

/** a ** b for a > 0. */
export function pow(a: Dual, b: Dual): Dual {
  return exp(mul(b, log(a)))
}

export function minOf(a: Dual, b: Dual): Dual {
  return a.v <= b.v ? a : b
}

/** max(a, c) for a plain number c. */
export function maxC(a: Dual, c: number): Dual {
  return a.v >= c ? a : constant(c, a.g.length)
}

/** Clamp to [lo, hi] (plain numbers); the gradient is zero where it clamps. */
export function clampC(a: Dual, lo: number, hi: number): Dual {
  if (a.v < lo) return constant(lo, a.g.length)
  if (a.v > hi) return constant(hi, a.g.length)
  return a
}

/** acc += x, in place. */
export function accumulate(acc: Dual, x: Dual): void {
  acc.v += x.v
  for (let i = 0; i < acc.g.length; i++) acc.g[i] += x.g[i]
}
