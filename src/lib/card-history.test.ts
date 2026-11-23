import { describe, expect, it } from "vitest"

import type { RevlogRow } from "@/db/types"

import { summarizeHistory } from "./card-history"

function log(id: string, over: Partial<RevlogRow> = {}): RevlogRow {
  return {
    id,
    cardId: "c",
    reviewedAt: 1000,
    rating: 3,
    state: 2,
    durationMs: 5000,
    answerMs: 4000,
    correct: true,
    stabilityAfter: 3,
    difficultyAfter: 5,
    scheduledDaysAfter: 3,
    dueAfter: 9999,
    ...over,
  }
}

describe("summarizeHistory", () => {
  it("has empty values for a card that was never reviewed", () => {
    expect(summarizeHistory([])).toEqual({
      entries: [],
      reviews: 0,
      correct: 0,
      correctRate: null,
      guessed: 0,
      avgAnswerMs: null,
      avgCorrectAnswerMs: null,
      totalMs: 0,
      firstAt: null,
      lastAt: null,
    })
  })

  it("counts, averages and finds the first and last review", () => {
    const history = summarizeHistory([
      log("a", { reviewedAt: 100, correct: false, rating: 1, answerMs: 2000 }),
      log("b", { reviewedAt: 300, answerMs: 6000, durationMs: 9000 }),
      log("c", { reviewedAt: 200, answerMs: 4000, durationMs: 5000 }),
    ])
    expect(history.reviews).toBe(3)
    expect(history.correct).toBe(2)
    expect(history.correctRate).toBeCloseTo(2 / 3)
    expect(history.avgAnswerMs).toBeCloseTo(4000)
    expect(history.avgCorrectAnswerMs).toBe(5000)
    expect(history.totalMs).toBe(19000)
    expect(history.firstAt).toBe(100)
    expect(history.lastAt).toBe(300)
  })

  it("lists newest first without changing the input", () => {
    const input = [
      log("a", { reviewedAt: 1 }),
      log("b", { reviewedAt: 3 }),
      log("c", { reviewedAt: 2 }),
    ]
    const ids = summarizeHistory(input).entries.map((e) => e.id)
    expect(ids).toEqual(["b", "c", "a"])
    expect(input.map((e) => e.id)).toEqual(["a", "b", "c"])
  })

  it("counts a right pick rated Again as a correct answer and a guess", () => {
    const history = summarizeHistory([
      log("a", { correct: true, rating: 1 }),
      log("b", { correct: true, rating: 3 }),
    ])
    expect(history.correct).toBe(2)
    expect(history.guessed).toBe(1)
  })

  it("averages the time of right picks only for avgCorrectAnswerMs", () => {
    const history = summarizeHistory([
      log("a", { correct: false, answerMs: 100 }),
      log("b", { correct: true, answerMs: 7000 }),
    ])
    expect(history.avgCorrectAnswerMs).toBe(7000)
    expect(history.avgAnswerMs).toBe(3550)
  })

  it("ignores a negative duration in the total", () => {
    expect(
      summarizeHistory([
        log("a", { durationMs: -5 }),
        log("b", { durationMs: 10 }),
      ]).totalMs
    ).toBe(10)
  })
})
