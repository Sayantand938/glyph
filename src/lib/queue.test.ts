import { describe, expect, it } from "vitest"

import { State } from "@/db/scheduler"

import {
  CARD_LEARNING,
  CARD_NEW,
  CARD_RELEARNING,
  CARD_REVIEW,
  addCounts,
  buildQueue,
  countCards,
  endOfLocalDay,
  totalCount,
  type QueueCard,
} from "./queue"

// Local noon, so "later today" and "tomorrow" are unambiguous in any timezone.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

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

describe("endOfLocalDay", () => {
  it("is the last millisecond of the local day", () => {
    expect(endOfLocalDay(NOW)).toBe(
      new Date(2026, 5, 15, 23, 59, 59, 999).getTime()
    )
    expect(endOfLocalDay(endOfLocalDay(NOW))).toBe(endOfLocalDay(NOW))
    expect(endOfLocalDay(endOfLocalDay(NOW) + 1)).toBe(
      new Date(2026, 5, 16, 23, 59, 59, 999).getTime()
    )
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
      card("h", CARD_REVIEW, NOW + DAY),
    ]
    expect(countCards(cards, NOW)).toEqual({ new: 2, learning: 2, due: 2 })
  })

  it("counts a Review card due later today, but not one due tomorrow", () => {
    const today = card("t", CARD_REVIEW, NOW + 5 * HOUR)
    const tomorrow = card("m", CARD_REVIEW, endOfLocalDay(NOW) + 1)
    expect(countCards([today], NOW).due).toBe(1)
    expect(countCards([tomorrow], NOW).due).toBe(0)
  })

  it("keeps Learning cards on the exact time", () => {
    const later = card("l", CARD_LEARNING, NOW + 5 * HOUR)
    expect(countCards([later], NOW).learning).toBe(0)
  })

  it("is zero for no cards", () => {
    expect(countCards([], NOW)).toEqual({ new: 0, learning: 0, due: 0 })
  })
})

describe("count helpers", () => {
  it("adds and totals", () => {
    const sum = addCounts(
      { new: 3, learning: 1, due: 2 },
      { new: 4, learning: 0, due: 5 }
    )
    expect(sum).toEqual({ new: 7, learning: 1, due: 7 })
    expect(totalCount(sum)).toBe(15)
  })
})

describe("buildQueue", () => {
  const cards = [
    card("new1", CARD_NEW, 10),
    card("new2", CARD_NEW, 20),
    card("new3", CARD_NEW, 30),
    card("rev1", CARD_REVIEW, NOW - 100),
    card("rev2", CARD_REVIEW, NOW - 50),
    card("rev-later-today", CARD_REVIEW, NOW + 100),
    card("rev-future", CARD_REVIEW, NOW + DAY),
    card("lrn1", CARD_LEARNING, NOW - 20),
    card("lrn2", CARD_RELEARNING, NOW - 80),
    card("lrn-future", CARD_LEARNING, NOW + 1),
  ]

  it("orders learning, then review, then new; skips cards not due", () => {
    const queue = buildQueue({ cards, now: NOW, seed: "s" })
    expect(queue.slice(0, 2)).toEqual(["lrn2", "lrn1"])
    // Review cards due any time today, not only those already past due.
    expect(queue.slice(2, 5).sort()).toEqual([
      "rev-later-today",
      "rev1",
      "rev2",
    ])
    expect(queue.slice(5).sort()).toEqual(["new1", "new2", "new3"])
    expect(queue).not.toContain("rev-future")
    expect(queue).not.toContain("lrn-future")
  })

  it("includes every new card, however many there are", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      card(`n${i}`, CARD_NEW, i)
    )
    expect(buildQueue({ cards: many, now: NOW, seed: "s" })).toHaveLength(500)
  })

  it("is stable for the same seed and varies with it", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      card(`n${i}`, CARD_NEW, i)
    )
    const a = buildQueue({ cards: many, now: NOW, seed: "x" })
    const b = buildQueue({ cards: many, now: NOW, seed: "x" })
    const c = buildQueue({ cards: many, now: NOW, seed: "y" })
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
    expect(buildQueue({ cards: [], now: NOW, seed: "s" })).toEqual([])
  })
})

describe("suspended and buried cards", () => {
  const hidden = (
    cardId: string,
    state: number,
    due: number,
    extra: Partial<QueueCard>
  ): QueueCard => ({ ...card(cardId, state, due), ...extra })

  const cards = [
    card("new", CARD_NEW, NOW),
    card("rev", CARD_REVIEW, NOW - DAY),
    card("lrn", CARD_LEARNING, NOW - 1),
    hidden("new-susp", CARD_NEW, NOW, { suspended: true }),
    hidden("rev-susp", CARD_REVIEW, NOW - DAY, { suspended: true }),
    hidden("lrn-susp", CARD_LEARNING, NOW - 1, { suspended: true }),
    hidden("new-buried", CARD_NEW, NOW, { buriedUntil: NOW + HOUR }),
    hidden("rev-buried", CARD_REVIEW, NOW - DAY, { buriedUntil: NOW + HOUR }),
  ]

  it("are not counted", () => {
    expect(countCards(cards, NOW)).toEqual({ new: 1, learning: 1, due: 1 })
  })

  it("are not put in the queue", () => {
    const queue = buildQueue({ cards, now: NOW, seed: "s" })
    expect([...queue].sort()).toEqual(["lrn", "new", "rev"])
  })

  it("come back once the burying time has passed", () => {
    const later = NOW + 2 * HOUR
    const counts = countCards(cards, later)
    expect(counts.new).toBe(2)
    expect(counts.due).toBe(2)
    const queue = buildQueue({ cards, now: later, seed: "s" })
    expect(queue).toContain("new-buried")
    expect(queue).toContain("rev-buried")
    expect(queue).not.toContain("new-susp")
  })

  it("leave an all-hidden deck empty", () => {
    const only = [hidden("a", CARD_NEW, NOW, { suspended: true })]
    expect(countCards(only, NOW)).toEqual({ new: 0, learning: 0, due: 0 })
    expect(buildQueue({ cards: only, now: NOW, seed: "s" })).toEqual([])
  })
})
