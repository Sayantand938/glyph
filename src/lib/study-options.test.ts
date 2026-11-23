import { describe, expect, it } from "vitest"

import {
  DEFAULT_STUDY_OPTIONS,
  parseStudyOptions,
  sessionSize,
} from "./study-options"

describe("parseStudyOptions", () => {
  it("starts with every group on", () => {
    expect(DEFAULT_STUDY_OPTIONS).toEqual({
      due: true,
      learning: true,
      new: true,
    })
  })

  it("round-trips the defaults and other choices", () => {
    expect(parseStudyOptions(DEFAULT_STUDY_OPTIONS)).toEqual(
      DEFAULT_STUDY_OPTIONS
    )
    expect(
      parseStudyOptions({ due: false, learning: true, new: true })
    ).toEqual({ due: false, learning: true, new: true })
  })

  it("ignores a new-card limit saved by an older version", () => {
    expect(
      parseStudyOptions({ due: true, learning: true, new: true, newLimit: 30 })
    ).toEqual({ due: true, learning: true, new: true })
    expect(
      parseStudyOptions({
        due: true,
        learning: true,
        new: true,
        newLimit: null,
      })
    ).toEqual({ due: true, learning: true, new: true })
  })

  it("rejects malformed values", () => {
    expect(parseStudyOptions(null)).toBeNull()
    expect(parseStudyOptions("x")).toBeNull()
    expect(parseStudyOptions({})).toBeNull()
    expect(parseStudyOptions({ due: 1, learning: true, new: true })).toBeNull()
    expect(parseStudyOptions({ due: true, learning: true })).toBeNull()
  })
})

describe("sessionSize", () => {
  const counts = { new: 100, learning: 4, due: 20 }

  it("sums the chosen groups", () => {
    expect(sessionSize(counts, { due: true, learning: true, new: true })).toBe(
      124
    )
    expect(
      sessionSize(counts, { due: true, learning: false, new: false })
    ).toBe(20)
    expect(sessionSize(counts, { due: false, learning: true, new: true })).toBe(
      104
    )
  })

  it("is zero when every group is off", () => {
    expect(
      sessionSize(counts, { due: false, learning: false, new: false })
    ).toBe(0)
  })
})
