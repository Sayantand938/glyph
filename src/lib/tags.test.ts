import { describe, expect, it } from "vitest"

import {
  MAX_TAGS_PER_NOTE,
  MAX_TAG_LENGTH,
  formatTags,
  normalizeTag,
  parseTags,
  sameTags,
  tagCounts,
  tagsError,
} from "./tags"

describe("normalizeTag", () => {
  it("lowercases, trims and drops a leading #", () => {
    expect(normalizeTag("  Physics ")).toBe("physics")
    expect(normalizeTag("#Exam")).toBe("exam")
    expect(normalizeTag("##exam")).toBe("exam")
    expect(normalizeTag("# exam")).toBe("exam")
  })

  it("turns inner whitespace into a dash", () => {
    expect(normalizeTag("organic   chem")).toBe("organic-chem")
  })

  it("keeps a # that is not leading", () => {
    expect(normalizeTag("c#")).toBe("c#")
  })

  it("gives an empty string for blank input", () => {
    expect(normalizeTag("   ")).toBe("")
    expect(normalizeTag("#")).toBe("")
  })
})

describe("parseTags", () => {
  it("splits a string on spaces, commas and semicolons", () => {
    expect(parseTags("b, a  c;d")).toEqual(["a", "b", "c", "d"])
  })

  it("removes duplicates, case-insensitively, and sorts", () => {
    expect(parseTags("Zoo zoo ant #ANT")).toEqual(["ant", "zoo"])
  })

  it("normalizes each array entry on its own", () => {
    expect(parseTags(["Organic Chem", "#Exam", "exam", ""])).toEqual([
      "exam",
      "organic-chem",
    ])
  })

  it("ignores array entries that are not text", () => {
    expect(parseTags(["a", 1, null, { x: 1 }, ["b"], "b"])).toEqual(["a", "b"])
  })

  it("gives an empty list for blank input", () => {
    expect(parseTags("")).toEqual([])
    expect(parseTags(" , ; ")).toEqual([])
    expect(parseTags([])).toEqual([])
  })

  it("is idempotent", () => {
    const once = parseTags("B a #c, b")
    expect(parseTags(once)).toEqual(once)
    expect(parseTags(formatTags(once))).toEqual(once)
  })
})

describe("tagsError", () => {
  it("accepts ordinary tags and none", () => {
    expect(tagsError([])).toBeNull()
    expect(tagsError(["a", "b"])).toBeNull()
    expect(tagsError(["x".repeat(MAX_TAG_LENGTH)])).toBeNull()
  })

  it("rejects a tag that is too long", () => {
    expect(tagsError(["x".repeat(MAX_TAG_LENGTH + 1)])).toMatch(/at most/)
  })

  it("rejects too many tags", () => {
    const many = Array.from(
      { length: MAX_TAGS_PER_NOTE + 1 },
      (_, i) => `t${i}`
    )
    expect(tagsError(many)).toMatch(/at most/)
    expect(tagsError(many.slice(0, MAX_TAGS_PER_NOTE))).toBeNull()
  })
})

describe("sameTags and formatTags", () => {
  it("compares in order", () => {
    expect(sameTags(["a", "b"], ["a", "b"])).toBe(true)
    expect(sameTags(["a"], ["a", "b"])).toBe(false)
    expect(sameTags(["a", "b"], ["b", "a"])).toBe(false)
    expect(sameTags([], [])).toBe(true)
  })

  it("joins with spaces", () => {
    expect(formatTags(["a", "b"])).toBe("a b")
    expect(formatTags([])).toBe("")
  })
})

describe("tagCounts", () => {
  it("counts lists per tag and sorts by name", () => {
    expect(tagCounts([["b", "a"], ["a"], [], ["c", "a"]])).toEqual([
      { tag: "a", count: 3 },
      { tag: "b", count: 1 },
      { tag: "c", count: 1 },
    ])
  })

  it("is empty without tags", () => {
    expect(tagCounts([[], []])).toEqual([])
  })
})
