import { describe, expect, it } from "vitest"

import {
  cardToRow,
  emptyCardRow,
  formatInterval,
  grade,
  previewIntervals,
  Rating,
  rowToCard,
  State,
} from "./scheduler"

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const note = { id: "n_test", topicId: "t_test" }

describe("emptyCardRow", () => {
  it("is a new, never-reviewed card keyed to the note", () => {
    const row = emptyCardRow(note, NOW)
    expect(row).toMatchObject({
      cardId: "n_test",
      noteId: "n_test",
      topicId: "t_test",
      state: State.New,
      reps: 0,
      lapses: 0,
      lastReview: 0,
      due: NOW,
      updatedAt: NOW,
    })
  })

  it("round-trips through rowToCard/cardToRow losslessly", () => {
    const row = emptyCardRow(note, NOW)
    expect(cardToRow(rowToCard(row), row)).toEqual(row)
  })

  it("maps a never-reviewed card to an absent last_review", () => {
    expect(rowToCard(emptyCardRow(note, NOW)).last_review).toBeUndefined()
  })
})

describe("grade", () => {
  it("moves due forward for Again and Good, with Good later than Again", () => {
    const row = emptyCardRow(note, NOW)
    const again = grade(row, Rating.Again, NOW).row
    const good = grade(row, Rating.Good, NOW).row
    expect(again.due).toBeGreaterThan(NOW)
    expect(good.due).toBeGreaterThan(NOW)
    expect(good.due).toBeGreaterThan(again.due)
  })

  it("records the review on the card row", () => {
    const row = grade(emptyCardRow(note, NOW), Rating.Good, NOW).row
    expect(row.lastReview).toBe(NOW)
    expect(row.updatedAt).toBe(NOW)
    expect(row.reps).toBe(1)
    expect(row.state).not.toBe(State.New)
    expect(row.cardId).toBe("n_test")
  })

  it("writes a log with the state BEFORE the review and the given duration", () => {
    const first = grade(emptyCardRow(note, NOW), Rating.Good, NOW, 1234)
    expect(first.log).toMatchObject({
      cardId: "n_test",
      reviewedAt: NOW,
      rating: Rating.Good,
      state: State.New,
      durationMs: 1234,
    })
    expect(first.log.id).toMatch(/^[0-9a-f-]{36}$/)

    const second = grade(first.row, Rating.Again, NOW + DAY)
    expect(second.log.state).toBe(first.row.state)
  })

  it("does not mutate the input row", () => {
    const row = emptyCardRow(note, NOW)
    const snapshot = { ...row }
    grade(row, Rating.Good, NOW)
    expect(row).toEqual(snapshot)
  })

  it("only accepts the two-grade scale (Again/Good) at compile time", () => {
    const row = emptyCardRow(note, NOW)
    // @ts-expect-error Hard is not a Glyph grade
    void (() => grade(row, Rating.Hard, NOW))
    // @ts-expect-error Easy is not a Glyph grade
    void (() => grade(row, Rating.Easy, NOW))
  })

  it("keeps a reviewed card lossless through a round trip", () => {
    const { row } = grade(emptyCardRow(note, NOW), Rating.Good, NOW)
    expect(cardToRow(rowToCard(row), row)).toEqual(row)
  })
})

describe("previewIntervals", () => {
  it("returns only a fail and a pass label, pass being longer on a new card", () => {
    const p = previewIntervals(emptyCardRow(note, NOW), NOW)
    expect(Object.keys(p).sort()).toEqual(["again", "good"])
    expect(p.again).toBe("1m")
    expect(p.good).toBe("10m")
    for (const label of [p.again, p.good]) {
      expect(label).toMatch(/^(<1m|[\d.]+(m|h|d|mo|y))$/)
    }
  })

  it("gives longer intervals for a mature review card", () => {
    // Pass until the card graduates out of the learning steps.
    let row = emptyCardRow(note, NOW)
    for (let i = 0; i < 3; i++) row = grade(row, Rating.Good, row.due).row
    const p = previewIntervals(row, row.due)
    expect(p.good).toMatch(/d|mo|y/)
  })
})

describe("formatInterval", () => {
  it.each([
    [0, "<1m"],
    [-5000, "<1m"],
    [Number.NaN, "<1m"],
    [20_000, "<1m"],
    [MIN, "1m"],
    [10 * MIN, "10m"],
    [59 * MIN, "59m"],
    [59.6 * MIN, "1h"],
    [5 * HOUR, "5h"],
    [23.6 * HOUR, "1d"],
    [3 * DAY, "3d"],
    [29 * DAY, "29d"],
    [30 * DAY, "1mo"],
    [64 * DAY, "2.1mo"],
    [180 * DAY, "5.9mo"],
    [365 * DAY, "1y"],
    [548 * DAY, "1.5y"],
  ])("formats %s ms as %s", (ms, expected) => {
    expect(formatInterval(ms)).toBe(expected)
  })
})
