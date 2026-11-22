import { describe, expect, it } from "vitest"

import { cyrb53, noteId, normalizeQuestion } from "./hash"

describe("cyrb53", () => {
  it("is deterministic and a safe integer", () => {
    const h = cyrb53("hello")
    expect(cyrb53("hello")).toBe(h)
    expect(Number.isSafeInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
  })

  it("differs for different input and seeds", () => {
    expect(cyrb53("hello")).not.toBe(cyrb53("hellp"))
    expect(cyrb53("hello", 1)).not.toBe(cyrb53("hello", 2))
  })

  it("has no collisions across a few thousand distinct strings", () => {
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) seen.add(cyrb53(`question ${i}`))
    expect(seen.size).toBe(5000)
  })
})

describe("normalizeQuestion", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeQuestion("  What   IS\n\tthis? ")).toBe("what is this?")
  })

  it("strips zero-width characters", () => {
    expect(normalizeQuestion("wh\u200Bat\u200C is\u2060 th\uFEFFis")).toBe(
      "what is this"
    )
  })

  it("applies Unicode NFC", () => {
    // "\u00E9" precomposed vs "e" + combining acute.
    expect(normalizeQuestion("caf\u00E9")).toBe(normalizeQuestion("cafe\u0301"))
  })
})

describe("noteId", () => {
  it("is prefixed and base36", () => {
    expect(noteId("t1", "What is 2 + 2?")).toMatch(/^n_[0-9a-z]+$/)
  })

  it("ignores case, spacing, zero-width chars and normalization form", () => {
    const base = noteId("t1", "What is the caf\u00E9?")
    expect(
      noteId(
        "t1",
        "  WHAT   is the CAFE\u0301? ".replace("CAFE\u0301", "caf\u00E9")
      )
    ).toBe(base)
    expect(noteId("t1", "what\u200B is the cafe\u0301?")).toBe(base)
  })

  it("depends on the topic", () => {
    expect(noteId("t1", "Same question")).not.toBe(
      noteId("t2", "Same question")
    )
  })

  it("depends on the question text", () => {
    expect(noteId("t1", "Question A")).not.toBe(noteId("t1", "Question B"))
  })

  it("does not confuse topic/question boundaries", () => {
    expect(noteId("ab", "c")).not.toBe(noteId("a", "bc"))
  })
})
