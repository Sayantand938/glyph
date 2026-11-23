import { describe, expect, it } from "vitest"

import {
  cleanDraft,
  draftChangesNote,
  validateDraft,
  type NoteDraft,
} from "./note-edit"

const base: NoteDraft = {
  question: "Capital of France?",
  options: ["Paris", "Rome", "Madrid", "Berlin"],
  correctIndex: 0,
  extra: "Paris has been the capital since 987.",
  tags: ["europe"],
}

describe("validateDraft", () => {
  it("accepts a complete draft, with or without extra", () => {
    expect(validateDraft(base).valid).toBe(true)
    expect(validateDraft({ ...base, extra: "" }).valid).toBe(true)
  })

  it("flags an empty or whitespace-only question", () => {
    const result = validateDraft({ ...base, question: "  \n " })
    expect(result.valid).toBe(false)
    expect(result.errors.question).not.toBeNull()
  })

  it("flags each empty option separately", () => {
    const result = validateDraft({
      ...base,
      options: ["Paris", "", "Madrid", "   "],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.options.map((e) => e !== null)).toEqual([
      false,
      true,
      false,
      true,
    ])
    expect(result.errors.question).toBeNull()
  })
})

describe("validateDraft: tags", () => {
  it("accepts no tags", () => {
    expect(validateDraft({ ...base, tags: [] }).valid).toBe(true)
  })

  it("flags a tag that is too long", () => {
    const result = validateDraft({ ...base, tags: ["x".repeat(100)] })
    expect(result.valid).toBe(false)
    expect(result.errors.tags).not.toBeNull()
    expect(result.errors.question).toBeNull()
  })
})

describe("cleanDraft", () => {
  it("trims every text field", () => {
    expect(
      cleanDraft({
        question: " Q ",
        options: [" a", "b ", " c ", "d"],
        correctIndex: 2,
        extra: "  e\n",
        tags: ["x"],
      })
    ).toEqual({
      question: "Q",
      options: ["a", "b", "c", "d"],
      correctIndex: 2,
      extra: "e",
      tags: ["x"],
    })
  })
})

describe("draftChangesNote", () => {
  it("is false for an identical draft, even with stray whitespace", () => {
    expect(draftChangesNote(base, base)).toBe(false)
    expect(
      draftChangesNote(base, { ...base, question: " Capital of France? " })
    ).toBe(false)
  })

  it("detects a change to each field", () => {
    expect(
      draftChangesNote(base, { ...base, question: "Capital of Spain?" })
    ).toBe(true)
    expect(draftChangesNote(base, { ...base, correctIndex: 1 })).toBe(true)
    expect(draftChangesNote(base, { ...base, extra: "" })).toBe(true)
    expect(
      draftChangesNote(base, { ...base, tags: ["europe", "capitals"] })
    ).toBe(true)
    expect(draftChangesNote(base, { ...base, tags: [] })).toBe(true)
    expect(
      draftChangesNote(base, {
        ...base,
        options: ["Paris", "Rome", "Madrid", "Bonn"],
      })
    ).toBe(true)
  })
})
