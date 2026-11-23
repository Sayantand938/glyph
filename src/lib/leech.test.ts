import { describe, expect, it } from "vitest"

import {
  DEFAULT_LEECH_THRESHOLD,
  LEECH_TAG,
  hasLeechTag,
  isLeechLapse,
  leechNotice,
  leechRule,
  parseLeechAction,
  parseLeechThreshold,
  withLeechTag,
  withoutLeechTag,
} from "./leech"
import { MAX_TAGS_PER_NOTE } from "./tags"

describe("isLeechLapse", () => {
  it("fires when the lapse count reaches the threshold", () => {
    expect(isLeechLapse(7, 8, 8)).toBe(true)
    expect(isLeechLapse(6, 7, 8)).toBe(false)
  })

  it("fires again every half threshold above it", () => {
    const fires = [8, 9, 10, 11, 12, 13, 14, 15, 16].filter((n) =>
      isLeechLapse(n - 1, n, 8)
    )
    expect(fires).toEqual([8, 12, 16])
  })

  it("fires on every lapse past a threshold of 1", () => {
    expect(isLeechLapse(0, 1, 1)).toBe(true)
    expect(isLeechLapse(1, 2, 1)).toBe(true)
  })

  it("never fires when the count did not rise or detection is off", () => {
    expect(isLeechLapse(8, 8, 8)).toBe(false)
    expect(isLeechLapse(9, 8, 8)).toBe(false)
    expect(isLeechLapse(7, 8, 0)).toBe(false)
  })
})

describe("settings values", () => {
  it("accepts whole numbers from 0 to 99", () => {
    expect(parseLeechThreshold(0)).toBe(0)
    expect(parseLeechThreshold(DEFAULT_LEECH_THRESHOLD)).toBe(8)
    expect(parseLeechThreshold(99)).toBe(99)
    expect(parseLeechThreshold(100)).toBeNull()
    expect(parseLeechThreshold(-1)).toBeNull()
    expect(parseLeechThreshold(2.5)).toBeNull()
    expect(parseLeechThreshold("8")).toBeNull()
  })

  it("accepts only the two actions", () => {
    expect(parseLeechAction("tag")).toBe("tag")
    expect(parseLeechAction("suspend")).toBe("suspend")
    expect(parseLeechAction("delete")).toBeNull()
  })

  it("a threshold of 0 is no rule", () => {
    expect(leechRule(0, "tag")).toBeNull()
    expect(leechRule(8, "suspend")).toEqual({ threshold: 8, action: "suspend" })
  })
})

describe("the leech tag", () => {
  it("is added once and keeps the list sorted", () => {
    expect(withLeechTag(["physics", "exam"])).toEqual([
      "exam",
      LEECH_TAG,
      "physics",
    ])
    expect(withLeechTag([LEECH_TAG])).toEqual([LEECH_TAG])
  })

  it("is not added to a note that is already at the tag limit", () => {
    const full = Array.from(
      { length: MAX_TAGS_PER_NOTE },
      (_, i) => `t${String(i).padStart(2, "0")}`
    )
    expect(withLeechTag(full)).toEqual(full)
  })

  it("is removed without touching other tags", () => {
    expect(withoutLeechTag(["a", LEECH_TAG, "b"])).toEqual(["a", "b"])
    expect(hasLeechTag(["a", LEECH_TAG])).toBe(true)
    expect(hasLeechTag(["a"])).toBe(false)
  })
})

describe("leechNotice", () => {
  it("says what happened for each action", () => {
    expect(leechNotice("tag", 8, true)).toBe(
      'Leech: forgotten 8 times. Tagged "leech". Check its wording.'
    )
    expect(leechNotice("suspend", 1, false)).toBe(
      "Leech: forgotten 1 time, so it is suspended. Z undoes it."
    )
  })
})
