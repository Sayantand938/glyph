import { describe, expect, it } from "vitest"

import {
  REQUEUE_MAX_GAP,
  REQUEUE_MIN_GAP,
  dropCardFrom,
  formatDuration,
  optionOrder,
  requeueAgain,
  requeueGap,
  summarizeSession,
} from "./session"

describe("optionOrder", () => {
  it("is the identity when shuffling is off", () => {
    expect(optionOrder("s", "c", 4, false)).toEqual([0, 1, 2, 3])
  })

  it("is a permutation of 0-3", () => {
    for (let position = 0; position < 30; position++) {
      expect([...optionOrder("s", "c", position, true)].sort()).toEqual([
        0, 1, 2, 3,
      ])
    }
  })

  it("is stable for the same seed, card and position", () => {
    expect(optionOrder("s", "c", 2, true)).toEqual(
      optionOrder("s", "c", 2, true)
    )
  })

  it("differs between positions and between seeds", () => {
    const orders = new Set<string>()
    for (let position = 0; position < 30; position++) {
      orders.add(optionOrder("s", "c", position, true).join())
    }
    expect(orders.size).toBeGreaterThan(1)

    const seeds = new Set<string>()
    for (let i = 0; i < 30; i++) {
      seeds.add(optionOrder(`seed-${i}`, "c", 0, true).join())
    }
    expect(seeds.size).toBeGreaterThan(1)
  })
})

describe("requeueGap", () => {
  it("stays within 3-5 and is deterministic", () => {
    for (let position = 0; position < 100; position++) {
      const gap = requeueGap("s", "c", position)
      expect(gap).toBeGreaterThanOrEqual(REQUEUE_MIN_GAP)
      expect(gap).toBeLessThanOrEqual(REQUEUE_MAX_GAP)
      expect(requeueGap("s", "c", position)).toBe(gap)
    }
  })

  it("uses every value in the range", () => {
    const seen = new Set<number>()
    for (let position = 0; position < 200; position++) {
      seen.add(requeueGap("s", "c", position))
    }
    expect([...seen].sort()).toEqual([3, 4, 5])
  })
})

describe("requeueAgain", () => {
  const queue = ["a", "b", "c", "d", "e", "f", "g"]

  it("inserts a copy `gap` cards after the current one", () => {
    expect(requeueAgain(queue, 0, 3)).toEqual([
      "a",
      "b",
      "c",
      "a",
      "d",
      "e",
      "f",
      "g",
    ])
    expect(requeueAgain(queue, 2, 5)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "c",
    ])
  })

  it("appends when fewer cards remain than the gap", () => {
    expect(requeueAgain(queue, 5, 4)).toEqual([...queue, "f"])
    expect(requeueAgain(queue, 6, 3)).toEqual([...queue, "g"])
    expect(requeueAgain(["x"], 0, 3)).toEqual(["x", "x"])
  })

  it("never inserts at or before the current position", () => {
    expect(requeueAgain(queue, 1, 0)).toEqual([
      "a",
      "b",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ])
  })

  it("does not modify the input and ignores a bad index", () => {
    const copy = [...queue]
    requeueAgain(queue, 0, 3)
    expect(queue).toEqual(copy)
    expect(requeueAgain(queue, 99, 3)).toEqual(queue)
  })
})

describe("dropCardFrom", () => {
  it("removes the current card and its re-queued copies", () => {
    expect(dropCardFrom(["a", "b", "c", "b", "d"], 1, "b")).toEqual([
      "a",
      "c",
      "d",
    ])
  })

  it("keeps copies before the current position", () => {
    expect(dropCardFrom(["b", "a", "b", "c"], 2, "b")).toEqual(["b", "a", "c"])
  })

  it("leaves other cards alone and does not modify the input", () => {
    const queue = ["a", "b", "c"]
    expect(dropCardFrom(queue, 1, "x")).toEqual(["a", "b", "c"])
    dropCardFrom(queue, 0, "a")
    expect(queue).toEqual(["a", "b", "c"])
  })
})

describe("summarizeSession", () => {
  it("handles an empty session", () => {
    expect(summarizeSession([])).toEqual({
      cards: 0,
      answers: 0,
      correct: 0,
      accuracy: 0,
      totalMs: 0,
    })
  })

  it("counts distinct cards, answers, accuracy and time", () => {
    const summary = summarizeSession([
      { cardId: "a", correct: false, durationMs: 4000 },
      { cardId: "b", correct: true, durationMs: 2000 },
      { cardId: "a", correct: true, durationMs: 3000 },
      { cardId: "c", correct: true, durationMs: -5 },
    ])
    expect(summary.cards).toBe(3)
    expect(summary.answers).toBe(4)
    expect(summary.correct).toBe(3)
    expect(summary.accuracy).toBe(0.75)
    expect(summary.totalMs).toBe(9000)
  })
})

describe("formatDuration", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(7000)).toBe("0:07")
    expect(formatDuration(750_000)).toBe("12:30")
    expect(formatDuration(3_723_000)).toBe("1:02:03")
  })

  it("is safe on bad input", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00")
    expect(formatDuration(-1000)).toBe("0:00")
  })
})
