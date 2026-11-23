import { describe, expect, it } from "vitest"

import type { Note } from "@/db/types"

import {
  formatSummary,
  parseImportText,
  planImport,
  summarize,
  validateRows,
  type ValidRow,
} from "./importer"

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sl: 1,
    questions: "What is 2 + 2?",
    op1: "3",
    op2: "4",
    op3: "5",
    op4: "6",
    answer: "op2",
    extra: "Basic maths.",
    ...overrides,
  }
}

function valid(rows: unknown[]): ValidRow[] {
  return validateRows(rows).valid
}

function toMap(notes: Note[]): Map<string, Note> {
  return new Map(notes.map((n) => [n.id, n]))
}

const TOPIC = "t1"
const T0 = 1_000
const T1 = 2_000

describe("parseImportText", () => {
  it("parses an array", () => {
    const result = parseImportText(JSON.stringify([row()]))
    expect(result).toEqual({ ok: true, rows: [row()] })
  })

  it("tolerates a UTF-8 BOM", () => {
    expect(parseImportText("\uFEFF[{}]").ok).toBe(true)
  })

  it("rejects invalid JSON without throwing", () => {
    const result = parseImportText("{ nope")
    expect(result.ok).toBe(false)
  })

  it("rejects a non-array root", () => {
    const result = parseImportText(JSON.stringify({ questions: [] }))
    expect(result).toMatchObject({ ok: false })
  })

  it("rejects an empty array", () => {
    expect(parseImportText("[]")).toMatchObject({ ok: false })
  })
})

describe("validateRows", () => {
  it("accepts a complete row and normalizes it", () => {
    const { valid, invalid } = validateRows([
      row({ questions: "  Q?  ", op1: " a ", answer: " B " }),
    ])
    expect(invalid).toEqual([])
    expect(valid).toEqual([
      {
        row: 1,
        sl: 1,
        question: "Q?",
        options: ["a", "4", "5", "6"],
        correctIndex: 1,
        extra: "Basic maths.",
      },
    ])
  })

  it("defaults sl and extra to empty strings", () => {
    const [r] = valid([row({ sl: undefined, extra: undefined })])
    expect(r.sl).toBe("")
    expect(r.extra).toBe("")
  })

  it("keeps string and numeric sl", () => {
    const rows = valid([row({ sl: "A-1" }), row({ questions: "Q2", sl: 7 })])
    expect(rows.map((r) => r.sl)).toEqual(["A-1", 7])
  })

  it("accepts numeric options and answers", () => {
    const [r] = valid([row({ op1: 10, answer: 1 })])
    expect(r.options[0]).toBe("10")
    expect(r.correctIndex).toBe(0)
  })

  it("resolves the answer by option text", () => {
    const [r] = valid([row({ answer: "5" })])
    // "5" is a digit 1-4? No: digit 5 is not an index, so it matches op3's text.
    expect(r.correctIndex).toBe(2)
  })

  it("flags missing question, options and answer with row numbers", () => {
    const { valid, invalid } = validateRows([
      row({ sl: 5, questions: "  " }),
      row({ op3: "" }),
      row({ answer: undefined }),
      row({ answer: "nonsense" }),
      row(),
    ])
    expect(valid).toHaveLength(1)
    expect(invalid.map((i) => i.row)).toEqual([1, 2, 3, 4])
    expect(invalid[0].sl).toBe(5)
    expect(invalid[0].reasons).toEqual(['Missing "questions".'])
    expect(invalid[1].reasons).toEqual(['Missing "op3".'])
    expect(invalid[2].reasons).toEqual(['Missing "answer".'])
    expect(invalid[3].reasons[0]).toContain("does not match")
  })

  it("reports every problem in a row", () => {
    const { invalid } = validateRows([
      { sl: 3, op1: "a", op2: "", op3: "", op4: "d" },
    ])
    expect(invalid[0].reasons).toEqual([
      'Missing "questions".',
      'Missing "op2".',
      'Missing "op3".',
      'Missing "answer".',
    ])
  })

  it("rejects non-object rows", () => {
    const { valid, invalid } = validateRows([null, 3, "x", [], row()])
    expect(valid).toHaveLength(1)
    expect(invalid.map((i) => i.row)).toEqual([1, 2, 3, 4])
  })
})

describe("validateRows: tags", () => {
  it("leaves tags undefined when the row has no tags key", () => {
    const [r] = valid([row()])
    expect("tags" in r).toBe(false)
  })

  it("accepts a list, normalizing, deduplicating and sorting", () => {
    const [r] = valid([
      row({ tags: ["Physics", "#exam", "exam", "Organic Chem"] }),
    ])
    expect(r.tags).toEqual(["exam", "organic-chem", "physics"])
  })

  it("accepts one string split on commas and spaces", () => {
    const [r] = valid([row({ tags: "b, a  c" })])
    expect(r.tags).toEqual(["a", "b", "c"])
  })

  it("reads an empty list or string as no tags, and null as not given", () => {
    expect(valid([row({ tags: [] })])[0].tags).toEqual([])
    expect(valid([row({ tags: "" })])[0].tags).toEqual([])
    expect("tags" in valid([row({ tags: null })])[0]).toBe(false)
  })

  it("rejects a tags value that is not a list or text", () => {
    const { valid: ok, invalid } = validateRows([
      row({ tags: 5 }),
      row({ tags: { a: 1 } }),
    ])
    expect(ok).toEqual([])
    expect(invalid).toHaveLength(2)
    expect(invalid[0].reasons.join(" ")).toMatch(/tags/)
  })

  it("rejects a tag that is too long", () => {
    const { invalid } = validateRows([row({ tags: ["x".repeat(100)] })])
    expect(invalid[0].reasons.join(" ")).toMatch(/tags/)
  })
})

describe("planImport: tags", () => {
  const withTags = (tags?: unknown) =>
    valid([row(tags === undefined ? {} : { tags })])

  it("gives a new note its tags, or none", () => {
    expect(
      planImport(withTags(["a"]), TOPIC, new Map(), T0).toAdd[0].tags
    ).toEqual(["a"])
    expect(planImport(withTags(), TOPIC, new Map(), T0).toAdd[0].tags).toEqual(
      []
    )
  })

  it("updates a note whose tags changed, and counts the same tags as unchanged", () => {
    const first = planImport(withTags(["a"]), TOPIC, new Map(), T0)
    const stored = toMap(first.toAdd)

    const same = planImport(withTags(["a"]), TOPIC, stored, T1)
    expect(same.unchanged).toBe(1)
    expect(same.toUpdate).toEqual([])

    const changed = planImport(withTags(["a", "b"]), TOPIC, stored, T1)
    expect(changed.toUpdate).toHaveLength(1)
    expect(changed.toUpdate[0].tags).toEqual(["a", "b"])
    expect(changed.toUpdate[0].contentUpdatedAt).toBe(T1)
  })

  it("replaces the tags with an empty list when the row says so", () => {
    const first = planImport(withTags(["a"]), TOPIC, new Map(), T0)
    const plan = planImport(withTags([]), TOPIC, toMap(first.toAdd), T1)
    expect(plan.toUpdate[0].tags).toEqual([])
  })

  it("leaves the stored tags alone when the row has no tags key", () => {
    const first = planImport(withTags(["a"]), TOPIC, new Map(), T0)
    const stored = toMap(first.toAdd)

    const same = planImport(withTags(), TOPIC, stored, T1)
    expect(same.unchanged).toBe(1)

    // Another field changing must not wipe the tags either.
    const edited = planImport(valid([row({ extra: "new" })]), TOPIC, stored, T1)
    expect(edited.toUpdate[0].tags).toEqual(["a"])
  })
})

describe("planImport", () => {
  it("adds everything into an empty topic", () => {
    const plan = planImport(
      valid([row(), row({ questions: "Q2" })]),
      TOPIC,
      new Map(),
      T0
    )
    expect(plan.toAdd).toHaveLength(2)
    expect(plan.toUpdate).toEqual([])
    expect(plan.unchanged).toBe(0)
    const [note] = plan.toAdd
    expect(note.id).toMatch(/^n_/)
    expect(note).toMatchObject({
      topicId: TOPIC,
      question: "What is 2 + 2?",
      correctIndex: 1,
      contentUpdatedAt: T0,
      deletedAt: null,
    })
  })

  it("is idempotent: re-importing the same rows is 0 new / 0 updated", () => {
    const rows = valid([row(), row({ questions: "Q2", sl: 2 })])
    const first = planImport(rows, TOPIC, new Map(), T0)
    const second = planImport(rows, TOPIC, toMap(first.toAdd), T1)
    expect(second.toAdd).toEqual([])
    expect(second.toUpdate).toEqual([])
    expect(second.unchanged).toBe(2)
  })

  it("updates changed fields, keeps id and question, bumps only then", () => {
    const first = planImport(
      valid([row(), row({ questions: "Q2" })]),
      TOPIC,
      new Map(),
      T0
    )
    const stored = toMap(first.toAdd)

    const second = planImport(
      valid([
        row({ op4: "seven", sl: 9, extra: "new" }),
        row({ questions: "Q2" }),
      ]),
      TOPIC,
      stored,
      T1
    )
    expect(second.toAdd).toEqual([])
    expect(second.unchanged).toBe(1)
    expect(second.toUpdate).toHaveLength(1)
    const [updated] = second.toUpdate
    expect(updated.id).toBe(first.toAdd[0].id)
    expect(updated.options[3]).toBe("seven")
    expect(updated.sl).toBe(9)
    expect(updated.extra).toBe("new")
    expect(updated.contentUpdatedAt).toBe(T1)
  })

  it("detects a changed correct answer", () => {
    const first = planImport(valid([row()]), TOPIC, new Map(), T0)
    const second = planImport(
      valid([row({ answer: "op3" })]),
      TOPIC,
      toMap(first.toAdd),
      T1
    )
    expect(second.toUpdate).toHaveLength(1)
    expect(second.toUpdate[0].correctIndex).toBe(2)
  })

  it("does not overwrite the stored question text (e.g. user casing/edits)", () => {
    const first = planImport(valid([row()]), TOPIC, new Map(), T0)
    const second = planImport(
      valid([row({ questions: "  WHAT IS 2 + 2?  ", op1: "x" })]),
      TOPIC,
      toMap(first.toAdd),
      T1
    )
    expect(second.toAdd).toEqual([])
    expect(second.toUpdate[0].question).toBe("What is 2 + 2?")
  })

  it("resurrects a tombstoned note and bumps contentUpdatedAt", () => {
    const first = planImport(valid([row()]), TOPIC, new Map(), T0)
    const tombstone: Note = { ...first.toAdd[0], deletedAt: 1_500 }
    const second = planImport(valid([row()]), TOPIC, toMap([tombstone]), T1)
    expect(second.unchanged).toBe(0)
    expect(second.toUpdate).toHaveLength(1)
    expect(second.toUpdate[0]).toMatchObject({
      deletedAt: null,
      contentUpdatedAt: T1,
    })
  })

  it("counts duplicate questions in the file once; the last one wins", () => {
    const plan = planImport(
      valid([
        row({ op1: "first" }),
        row({ questions: "Other" }),
        row({ questions: "  what is 2 + 2?  ", op1: "last" }),
      ]),
      TOPIC,
      new Map(),
      T0
    )
    expect(plan.toAdd).toHaveLength(2)
    expect(plan.duplicates).toBe(1)
    const dup = plan.toAdd.find((n) => n.options[0] === "last")
    expect(dup).toBeDefined()
    expect(plan.toAdd.some((n) => n.options[0] === "first")).toBe(false)
  })

  it("scopes ids to the topic: same question in another topic is new", () => {
    const rows = valid([row()])
    const a = planImport(rows, "topicA", new Map(), T0)
    const b = planImport(rows, "topicB", toMap(a.toAdd), T0)
    expect(b.toAdd).toHaveLength(1)
    expect(b.toAdd[0].id).not.toBe(a.toAdd[0].id)
  })
})

describe("summarize / formatSummary", () => {
  it("builds the summary from a plan", () => {
    const plan = planImport(valid([row()]), TOPIC, new Map(), T0)
    expect(summarize(plan, 2)).toEqual({
      added: 1,
      updated: 0,
      unchanged: 0,
      invalid: 2,
      duplicates: 0,
    })
  })

  it("formats the headline message", () => {
    expect(
      formatSummary({
        added: 45,
        updated: 3,
        unchanged: 0,
        invalid: 2,
        duplicates: 0,
      })
    ).toBe("Added 45 new MCQs, updated 3 existing, skipped 2 invalid.")
  })

  it("formats an idempotent re-import", () => {
    expect(
      formatSummary({
        added: 0,
        updated: 0,
        unchanged: 10,
        invalid: 0,
        duplicates: 0,
      })
    ).toBe("Added 0 new MCQs, 10 unchanged.")
  })

  it("pluralizes and reports duplicates", () => {
    expect(
      formatSummary({
        added: 1,
        updated: 0,
        unchanged: 0,
        invalid: 0,
        duplicates: 1,
      })
    ).toBe("Added 1 new MCQ, merged 1 duplicate question in the file.")
  })
})
