import { describe, expect, it } from "vitest"

import { mulberry32, seededShuffle } from "./shuffle"

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it("differs by seed", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe("seededShuffle", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7]

  it("returns the same order for the same seed", () => {
    expect(seededShuffle(items, "seed")).toEqual(seededShuffle(items, "seed"))
  })

  it("is a permutation of the input and does not mutate it", () => {
    const input = [...items]
    const out = seededShuffle(input, "x")
    expect(input).toEqual(items)
    expect([...out].sort((a, b) => a - b)).toEqual(items)
  })

  it("produces more than one ordering across seeds", () => {
    const orders = new Set<string>()
    for (let i = 0; i < 50; i++) {
      orders.add(seededShuffle(items, `seed-${i}`).join(","))
    }
    expect(orders.size).toBeGreaterThan(40)
  })

  it("reaches every permutation of 4 options", () => {
    const orders = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      orders.add(seededShuffle([0, 1, 2, 3], `s${i}`).join(""))
    }
    expect(orders.size).toBe(24)
  })

  it("handles empty and single-item arrays", () => {
    expect(seededShuffle([], "s")).toEqual([])
    expect(seededShuffle(["only"], "s")).toEqual(["only"])
  })
})
