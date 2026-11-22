import { describe, expect, it } from "vitest"

import { normalizeAnswer } from "./answer"

const OPTIONS = ["Earth", "Jupiter", "Saturn", "Neptune"] as const

describe("normalizeAnswer", () => {
  it("resolves op1..op4 case-insensitively", () => {
    expect(normalizeAnswer("op1", OPTIONS)).toBe(0)
    expect(normalizeAnswer("op4", OPTIONS)).toBe(3)
    expect(normalizeAnswer("OP3", OPTIONS)).toBe(2)
    expect(normalizeAnswer(" Op2 ", OPTIONS)).toBe(1)
  })

  it("resolves numeric 1..4 (number or string) to 0..3", () => {
    expect(normalizeAnswer(2, OPTIONS)).toBe(1)
    expect(normalizeAnswer("1", OPTIONS)).toBe(0)
    expect(normalizeAnswer(4, OPTIONS)).toBe(3)
  })

  it("rejects numbers outside 1..4", () => {
    expect(normalizeAnswer(0, OPTIONS)).toBeNull()
    expect(normalizeAnswer(5, OPTIONS)).toBeNull()
    expect(normalizeAnswer("op5", OPTIONS)).toBeNull()
    expect(normalizeAnswer("op0", OPTIONS)).toBeNull()
  })

  it("resolves letters a..d case-insensitively with surrounding whitespace", () => {
    expect(normalizeAnswer(" B ", OPTIONS)).toBe(1)
    expect(normalizeAnswer("a", OPTIONS)).toBe(0)
    expect(normalizeAnswer("D", OPTIONS)).toBe(3)
    expect(normalizeAnswer("e", OPTIONS)).toBeNull()
  })

  it("matches option text case-insensitively and trimmed", () => {
    expect(normalizeAnswer("JUPITER", OPTIONS)).toBe(1)
    expect(normalizeAnswer("  saturn  ", OPTIONS)).toBe(2)
    expect(normalizeAnswer("jupiter", [" Earth ", " JUPITER ", "x", "y"])).toBe(
      1
    )
  })

  it("takes the first option when the text matches several", () => {
    expect(normalizeAnswer("same", ["other", "Same", "SAME", "same"])).toBe(1)
  })

  it("prefers the keyed forms over option text", () => {
    // "b" is a letter key even though option 3 is literally "b".
    expect(normalizeAnswer("b", ["w", "x", "b", "z"])).toBe(1)
    expect(normalizeAnswer("2", ["w", "x", "2", "z"])).toBe(1)
  })

  it("returns null for empty, nullish and garbage answers", () => {
    expect(normalizeAnswer("", OPTIONS)).toBeNull()
    expect(normalizeAnswer("   ", OPTIONS)).toBeNull()
    expect(normalizeAnswer(null, OPTIONS)).toBeNull()
    expect(normalizeAnswer(undefined, OPTIONS)).toBeNull()
    expect(normalizeAnswer("not an option", OPTIONS)).toBeNull()
    expect(normalizeAnswer({}, OPTIONS)).toBeNull()
    expect(normalizeAnswer([], OPTIONS)).toBeNull()
  })
})
