import { describe, expect, it } from "vitest"

import {
  FLAG_COUNT,
  FLAG_NAMES,
  FLAG_VALUES,
  NO_MARKS,
  flagFromKeyCode,
  flagName,
  isBuried,
  isFlag,
  isHidden,
  marksOf,
  newerMarks,
  nextDayStart,
  sameMarks,
  toggleFlag,
} from "./card-marks"

// Local noon, so "later today" and "tomorrow" are unambiguous in any timezone.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime()

describe("flags", () => {
  it("has seven named colours", () => {
    expect(FLAG_COUNT).toBe(7)
    expect(FLAG_NAMES).toHaveLength(7)
    expect(FLAG_VALUES).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(flagName(1)).toBe("Red")
    expect(flagName(7)).toBe("Purple")
    expect(flagName(0)).toBe("No flag")
    expect(flagName(8)).toBe("No flag")
  })

  it("accepts only the integers 0 to 7", () => {
    for (const ok of [0, 1, 7]) expect(isFlag(ok)).toBe(true)
    for (const bad of [-1, 8, 1.5, NaN, "1", null, undefined]) {
      expect(isFlag(bad)).toBe(false)
    }
  })

  it("toggles: the same flag clears, another replaces", () => {
    expect(toggleFlag(0, 3)).toBe(3)
    expect(toggleFlag(3, 3)).toBe(0)
    expect(toggleFlag(3, 5)).toBe(5)
  })

  it("reads Ctrl+1..7 from the key code, not the typed character", () => {
    expect(flagFromKeyCode("Digit1")).toBe(1)
    expect(flagFromKeyCode("Digit7")).toBe(7)
    expect(flagFromKeyCode("Numpad4")).toBe(4)
    expect(flagFromKeyCode("Digit0")).toBeNull()
    expect(flagFromKeyCode("Digit8")).toBeNull()
    expect(flagFromKeyCode("KeyA")).toBeNull()
  })
})

describe("marksOf", () => {
  it("treats missing or malformed fields as unmarked", () => {
    expect(marksOf({})).toEqual(NO_MARKS)
    expect(
      marksOf({
        flag: 99,
        suspended: "yes" as unknown as boolean,
        buriedUntil: NaN,
        markedAt: Infinity,
      })
    ).toEqual(NO_MARKS)
  })

  it("keeps good values and ignores every other field", () => {
    const marks = marksOf({
      flag: 2,
      suspended: true,
      buriedUntil: 50,
      markedAt: 9,
      ...({ reps: 4 } as object),
    })
    expect(marks).toEqual({
      flag: 2,
      suspended: true,
      buriedUntil: 50,
      markedAt: 9,
    })
  })

  it("compares marks, with missing fields equal to unmarked", () => {
    expect(sameMarks({}, NO_MARKS)).toBe(true)
    expect(sameMarks({ flag: 1 }, { flag: 2 })).toBe(false)
    expect(sameMarks({ markedAt: 1 }, { markedAt: 2 })).toBe(false)
  })
})

describe("hidden cards", () => {
  it("is buried only while buriedUntil is still ahead", () => {
    expect(isBuried({ buriedUntil: NOW + 1 }, NOW)).toBe(true)
    expect(isBuried({ buriedUntil: NOW }, NOW)).toBe(false)
    expect(isBuried({ buriedUntil: 0 }, NOW)).toBe(false)
    expect(isBuried({}, NOW)).toBe(false)
  })

  it("hides suspended and buried cards, not flagged ones", () => {
    expect(isHidden({ suspended: true }, NOW)).toBe(true)
    expect(isHidden({ buriedUntil: NOW + 1000 }, NOW)).toBe(true)
    expect(isHidden({ buriedUntil: NOW - 1000 }, NOW)).toBe(false)
    expect(isHidden({ flag: 3 }, NOW)).toBe(false)
    expect(isHidden({}, NOW)).toBe(false)
  })

  it("brings a buried card back at the start of the next local day", () => {
    const next = nextDayStart(NOW)
    expect(next).toBe(new Date(2026, 5, 16, 0, 0, 0, 0).getTime())
    expect(isHidden({ buriedUntil: next }, NOW)).toBe(true)
    expect(isHidden({ buriedUntil: next }, next - 1)).toBe(true)
    expect(isHidden({ buriedUntil: next }, next)).toBe(false)
    // At 23:59 the same day it is only a minute away.
    const late = new Date(2026, 5, 15, 23, 59, 0).getTime()
    expect(nextDayStart(late) - late).toBe(60_000)
  })
})

describe("newerMarks", () => {
  const older = { flag: 1, suspended: false, buriedUntil: 0, markedAt: 10 }
  const newer = { flag: 2, suspended: true, buriedUntil: 0, markedAt: 20 }

  it("takes the marks changed last, from either side", () => {
    expect(newerMarks(older, newer, older)).toEqual(newer)
    expect(newerMarks(newer, older, older)).toEqual(newer)
  })

  it("falls back to the given copy on a tie", () => {
    const tie = { ...newer, flag: 5 }
    expect(newerMarks(newer, tie, tie)).toEqual(tie)
    expect(newerMarks(newer, tie, newer)).toEqual(newer)
  })
})
