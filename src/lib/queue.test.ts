import { describe, expect, it } from "vitest"

import { State } from "@/db/scheduler"

import {
  CARD_LEARNING,
  CARD_NEW,
  CARD_RELEARNING,
  CARD_REVIEW,
  addCounts,
  buildQueue,
  capNew,
  countCards,
  countNewIntroduced,
  remainingNew,
  studyDayStart,
  totalCount,
  type QueueCard,
} from "./queue"

const NOW = 1_000_000

function card(
  cardId: string,
  state: number,
  due: number,
  topicId = "t1"
): QueueCard {
  return { cardId, topicId, state, due }
}

describe("state constants", () => {
  it("match the ts-fsrs State enum", () => {
    expect(CARD_NEW).toBe(State.New)
    expect(CARD_LEARNING).toBe(State.Learning)
    expect(CARD_REVIEW).toBe(State.Review)
    expect(CARD_RELEARNING).toBe(State.Relearning)
  })
})

describe("countCards", () => {
  it("counts new, due learning/relearning and due review", () => {
    const cards = [
      card("a", CARD_NEW, NOW + 5000),
      card("b", CARD_NEW, NOW),
      card("c", CARD_LEARNING, NOW - 1),
      card("d", CARD_RELEARNING, NOW),
      card("e", CARD_LEARNING, NOW + 1),
      card("f", CARD_REVIEW, NOW - 10),
      card("g", CARD_REVIEW, NOW + 10),
    ]
    expect(countCards(cards, NOW)).toEqual({ new: 2, learning: 2, due: 1 })
  })

  it("is zero for no cards", () => {
    expect(countCards([], NOW)).toEqual({ new: 0, learning: 0, due: 0 })
  })
})

describe("count helpers", () => {
  it("adds, caps and totals", () => {
    const sum = addCounts(
      { new: 3, learning: 1, due: 2 },
      { new: 4, learning: 0, due: 5 }
    )
    expect(sum).toEqual({ new: 7, learning: 1, due: 7 })
    expect(capNew(sum, 5)).toEqual({ new: 5, learning: 1, due: 7 })
    expect(capNew(sum, 50).new).toBe(7)
    expect(capNew(sum, -3).new).toBe(0)
    expect(totalCount(sum)).toBe(15)
  })
})

describe("studyDayStart", () => {
  it("rolls over at 04:00 local time", () => {
    const at = (d: number, h: number, m = 0) =>
      new Date(2026, 5, d, h, m).getTime()
    expect(studyDayStart(at(10, 4, 0))).toBe(at(10, 4))
    expect(studyDayStart(at(10, 15, 30))).toBe(at(10, 4))
    expect(studyDayStart(at(10, 3, 59))).toBe(at(9, 4))
    expect(studyDayStart(at(10, 0, 5))).toBe(at(9, 4))
  })

  it("handles month boundaries", () => {
    const now = new Date(2026, 6, 1, 2, 0).getTime()
    expect(studyDayStart(now)).toBe(new Date(2026, 5, 30, 4, 0).getTime())
  })
})

describe("countNewIntroduced", () => {
  it("counts distinct cards whose first review was today", () => {
    const today = [{ cardId: "a" }, { cardId: "a" }, { cardId: "b" }]
    expect(countNewIntroduced(today, new Set())).toBe(2)
  })

  it("ignores cards reviewed before today", () => {
    const today = [{ cardId: "a" }, { cardId: "b" }, { cardId: "c" }]
    expect(countNewIntroduced(today, new Set(["a", "c"]))).toBe(1)
  })

  it("is zero without reviews", () => {
    expect(countNewIntroduced([], new Set(["a"]))).toBe(0)
  })
})

describe("remainingNew", () => {
  it("subtracts and never goes negative", () => {
    expect(remainingNew(20, 5)).toBe(15)
    expect(remainingNew(20, 25)).toBe(0)
    expect(remainingNew(0, 0)).toBe(0)
  })
})

describe("buildQueue", () => {
  const cards = [
    card("new1", CARD_NEW, 10),
    card("new2", CARD_NEW, 20),
    card("new3", CARD_NEW, 30),
    card("rev1", CARD_REVIEW, NOW - 100),
    card("rev2", CARD_REVIEW, NOW - 50),
    card("rev-future", CARD_REVIEW, NOW + 100),
    card("lrn1", CARD_LEARNING, NOW - 20),
    card("lrn2", CARD_RELEARNING, NOW - 80),
    card("lrn-future", CARD_LEARNING, NOW + 1),
  ]

  it("orders learning, then review, then new; skips cards not due", () => {
    const queue = buildQueue({ cards, now: NOW, newLimit: 20, seed: "s" })
    expect(queue.slice(0, 2)).toEqual(["lrn2", "lrn1"])
    expect(queue.slice(2, 4).sort()).toEqual(["rev1", "rev2"])
    expect(queue.slice(4).sort()).toEqual(["new1", "new2", "new3"])
    expect(queue).not.toContain("rev-future")
    expect(queue).not.toContain("lrn-future")
  })

  it("limits new cards, taking the oldest first", () => {
    const queue = buildQueue({ cards, now: NOW, newLimit: 2, seed: "s" })
    const news = queue.filter((id) => id.startsWith("new"))
    expect(news.sort()).toEqual(["new1", "new2"])
  })

  it("includes no new cards at limit 0 but keeps reviews", () => {
    const queue = buildQueue({ cards, now: NOW, newLimit: 0, seed: "s" })
    expect(queue.some((id) => id.startsWith("new"))).toBe(false)
    expect(queue).toHaveLength(4)
  })

  it("is stable for the same seed and varies with it", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      card(`n${i}`, CARD_NEW, i)
    )
    const a = buildQueue({ cards: many, now: NOW, newLimit: 40, seed: "x" })
    const b = buildQueue({ cards: many, now: NOW, newLimit: 40, seed: "x" })
    const c = buildQueue({ cards: many, now: NOW, newLimit: 40, seed: "y" })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect([...a].sort()).toEqual([...c].sort())
  })

  it("mixed mode keeps learning first but blends review and new", () => {
    const many = [
      card("l", CARD_LEARNING, NOW - 1),
      ...Array.from({ length: 30 }, (_, i) => card(`r${i}`, CARD_REVIEW, i)),
      ...Array.from({ length: 30 }, (_, i) => card(`n${i}`, CARD_NEW, i)),
    ]
    const queue = buildQueue({
      cards: many,
      now: NOW,
      newLimit: 30,
      seed: "mix",
      mixed: true,
    })
    expect(queue[0]).toBe("l")
    expect(queue).toHaveLength(61)
    const firstHalf = queue.slice(1, 31)
    expect(firstHalf.some((id) => id.startsWith("n"))).toBe(true)
    expect(firstHalf.some((id) => id.startsWith("r"))).toBe(true)
  })

  it("returns an empty queue when nothing is available", () => {
    expect(
      buildQueue({ cards: [], now: NOW, newLimit: 20, seed: "s" })
    ).toEqual([])
  })
})
