import { describe, expect, it } from "vitest"

import {
  DEFAULT_STUDY_OPTIONS,
  parseNewLimit,
  parseStudyOptions,
  sessionSize,
} from "./study-options"

describe("parseNewLimit", () => {
  it("treats empty text as no limit", () => {
    expect(parseNewLimit("")).toBeNull()
    expect(parseNewLimit("   ")).toBeNull()
  })

  it("reads whole numbers as typed, with no upper cap", () => {
    expect(parseNewLimit("0")).toBe(0)
    expect(parseNewLimit(" 25 ")).toBe(25)
    expect(parseNewLimit("99999999")).toBe(99_999_999)
  })

  it("starts with no limit", () => {
    expect(DEFAULT_STUDY_OPTIONS.newLimit).toBeNull()
  })

  it("rejects anything else", () => {
    for (const bad of ["-1", "2.5", "abc", "1e3", "10 20"]) {
      expect(parseNewLimit(bad)).toBeUndefined()
    }
  })
})

describe("parseStudyOptions", () => {
  it("round-trips the defaults", () => {
    expect(parseStudyOptions(DEFAULT_STUDY_OPTIONS)).toEqual(
      DEFAULT_STUDY_OPTIONS
    )
    expect(
      parseStudyOptions({
        due: false,
        learning: true,
        new: true,
        newLimit: null,
      })
    ).toEqual({ due: false, learning: true, new: true, newLimit: null })
  })

  it("rejects malformed values", () => {
    expect(parseStudyOptions(null)).toBeNull()
    expect(parseStudyOptions("x")).toBeNull()
    expect(parseStudyOptions({})).toBeNull()
    expect(
      parseStudyOptions({ due: 1, learning: true, new: true, newLimit: 5 })
    ).toBeNull()
    expect(
      parseStudyOptions({ due: true, learning: true, new: true, newLimit: "5" })
    ).toBeNull()
    expect(
      parseStudyOptions({ due: true, learning: true, new: true, newLimit: -3 })
    ).toBeNull()
    expect(
      parseStudyOptions({ due: true, learning: true, new: true })
    ).toBeNull()
  })
})

describe("sessionSize", () => {
  const counts = { new: 100, learning: 4, due: 20 }

  it("sums the chosen groups, capping the new ones", () => {
    expect(
      sessionSize(counts, {
        due: true,
        learning: true,
        new: true,
        newLimit: 30,
      })
    ).toBe(54)
    expect(
      sessionSize(counts, {
        due: true,
        learning: true,
        new: true,
        newLimit: null,
      })
    ).toBe(124)
    expect(
      sessionSize(counts, {
        due: true,
        learning: false,
        new: false,
        newLimit: 5,
      })
    ).toBe(20)
    expect(
      sessionSize(counts, {
        due: false,
        learning: false,
        new: true,
        newLimit: 0,
      })
    ).toBe(0)
  })
})
