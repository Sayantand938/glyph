import { describe, expect, it } from "vitest"

import {
  defaultDirection,
  filterCounts,
  filterRows,
  formatDue,
  flagCounts,
  isDueRow,
  makeBrowseRow,
  noteAsJson,
  previewText,
  searchTerms,
  sortRows,
  stateLabel,
  type BrowseCard,
  type BrowseNote,
  type BrowseRow,
} from "./browse"
import { countCards } from "./queue"

// A fixed local time: 2026-03-10 12:00.
const NOW = new Date(2026, 2, 10, 12, 0, 0, 0).getTime()
const HOUR = 3_600_000
const DAY = 86_400_000

function note(over: Partial<BrowseNote> = {}): BrowseNote {
  return {
    id: "n1",
    topicId: "t1",
    sl: 1,
    question: "What is the SI unit of force?",
    options: ["Newton", "Joule", "Watt", "Pascal"],
    extra: "Named after Isaac Newton.",
    tags: [],
    ...over,
  }
}

function card(over: Partial<BrowseCard> = {}): BrowseCard {
  return {
    state: 2,
    due: NOW + DAY,
    reps: 3,
    lapses: 0,
    difficulty: 5,
    ...over,
  }
}

function row(
  over: Partial<BrowseNote> = {},
  progress: Partial<BrowseCard> = {}
): BrowseRow {
  return makeBrowseRow(note(over), card(progress), "Mechanics", "Physics")
}

describe("previewText", () => {
  it("turns image tokens into [image]", () => {
    const id = "0123456789abcdef0123456789abcdef"
    expect(previewText(`See ![fig](img:${id}) here`)).toBe("See [image] here")
  })

  it("leaves other bracket syntax and math alone", () => {
    expect(previewText("a ![x](https://e.com/i.png) $x^2$")).toBe(
      "a ![x](https://e.com/i.png) $x^2$"
    )
  })

  it("collapses whitespace and drops light Markdown markers", () => {
    expect(previewText("## Title\n\n**bold**  and `code`\n- item")).toBe(
      "Title bold and code item"
    )
    expect(previewText("```js\nlet a = 1\n```")).toBe("let a = 1")
  })

  it("keeps plain asterisks between spaces", () => {
    expect(previewText("2 * 3 * 4")).toBe("2 * 3 * 4")
  })
})

describe("makeBrowseRow", () => {
  it("copies progress and builds the search text", () => {
    const r = row({}, { lapses: 2, reps: 7, difficulty: 6.5 })
    expect(r).toMatchObject({
      id: "n1",
      topicName: "Mechanics",
      subjectName: "Physics",
      lapses: 2,
      reps: 7,
      difficulty: 6.5,
    })
    expect(r.search).toContain("newton")
    expect(r.search).toContain("isaac")
    expect(r.search).toBe(r.search.toLowerCase())
  })

  it("shows a note with no card as New", () => {
    const r = makeBrowseRow(note(), undefined, "T", "S")
    expect(r.state).toBe(0)
    expect(r.lapses).toBe(0)
  })
})

describe("searchTerms and filterRows", () => {
  const rows = [
    row({
      id: "a",
      question: "Capital of France?",
      options: ["Paris", "Rome", "Oslo", "Bern"],
      extra: "",
    }),
    row({
      id: "b",
      question: "Capital of Italy?",
      options: ["Paris", "Rome", "Oslo", "Bern"],
      extra: "",
    }),
    row({
      id: "c",
      question: "Unit of force",
      options: ["N", "J", "W", "Pa"],
      extra: "Newton",
    }),
  ]

  it("splits on any whitespace and ignores case", () => {
    expect(searchTerms("  Capital   FRANCE ")).toEqual(["capital", "france"])
    expect(searchTerms("   ")).toEqual([])
  })

  it("needs every word to match, in question, options or extra", () => {
    const ids = (query: string) =>
      filterRows(rows, { query, filter: "all" }, NOW).map((r) => r.id)
    expect(ids("")).toEqual(["a", "b", "c"])
    expect(ids("capital")).toEqual(["a", "b"])
    expect(ids("capital france")).toEqual(["a"])
    expect(ids("newton")).toEqual(["c"])
    expect(ids("rome")).toEqual(["a", "b"])
    expect(ids("nothing here")).toEqual([])
  })

  it("combines search with a filter", () => {
    const mixed = [
      row({ id: "a" }, { lapses: 1 }),
      row({ id: "b" }, { lapses: 0 }),
    ]
    expect(
      filterRows(mixed, { query: "force", filter: "lapsed" }, NOW).map(
        (r) => r.id
      )
    ).toEqual(["a"])
  })
})

describe("tags in browse", () => {
  const rows = [
    row({ id: "a", question: "Alpha", tags: ["exam", "physics"] }),
    row({ id: "b", question: "Bravo", tags: ["physics"] }),
    row({ id: "c", question: "Charlie", tags: [] }),
  ]
  const ids = (tags: string[], query = "") =>
    filterRows(rows, { query, filter: "all", tags }, NOW).map((r) => r.id)

  it("copies the tags and searches them as text", () => {
    expect(rows[0].tags).toEqual(["exam", "physics"])
    expect(rows[0].search).toContain("exam")
    expect(ids([], "exam")).toEqual(["a"])
  })

  it("keeps the row's tags independent of the note's array", () => {
    const tags = ["x"]
    const r = row({ tags })
    tags.push("y")
    expect(r.tags).toEqual(["x"])
  })

  it("filters by tag, needing every selected tag", () => {
    expect(ids([])).toEqual(["a", "b", "c"])
    expect(ids(["physics"])).toEqual(["a", "b"])
    expect(ids(["physics", "exam"])).toEqual(["a"])
    expect(ids(["nope"])).toEqual([])
  })

  it("matches a tag exactly, not as a substring", () => {
    expect(ids(["phys"])).toEqual([])
  })

  it("combines the tag filter with search", () => {
    expect(ids(["physics"], "bravo")).toEqual(["b"])
  })

  it("sorts by tags, untagged first", () => {
    expect(sortRows(rows, "tags", "asc").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ])
  })
})

describe("filters", () => {
  const rows = [
    row({ id: "new" }, { state: 0, due: NOW - DAY, reps: 0 }),
    row({ id: "learn-due" }, { state: 1, due: NOW - 60_000 }),
    row({ id: "learn-later" }, { state: 1, due: NOW + HOUR }),
    row({ id: "relearn-due" }, { state: 3, due: NOW }),
    row({ id: "rev-today" }, { state: 2, due: NOW + 5 * HOUR }),
    row({ id: "rev-over" }, { state: 2, due: NOW - 3 * DAY, lapses: 2 }),
    row({ id: "rev-later" }, { state: 2, due: NOW + 9 * DAY }),
  ]
  const ids = (filter: Parameters<typeof filterRows>[1]["filter"]) =>
    filterRows(rows, { query: "", filter }, NOW).map((r) => r.id)

  it("picks rows by state", () => {
    expect(ids("new")).toEqual(["new"])
    expect(ids("learning")).toEqual(["learn-due", "learn-later", "relearn-due"])
    expect(ids("review")).toEqual(["rev-today", "rev-over", "rev-later"])
  })

  it("due follows the dashboard rule (review due today, learning due now)", () => {
    expect(ids("due")).toEqual([
      "learn-due",
      "relearn-due",
      "rev-today",
      "rev-over",
    ])
    expect(isDueRow(rows[0], NOW)).toBe(false)
  })

  it("lapsed means at least one lapse", () => {
    expect(ids("lapsed")).toEqual(["rev-over"])
  })

  it("filterCounts matches the filters", () => {
    const counts = filterCounts(rows, NOW)
    expect(counts).toEqual({
      all: 7,
      new: 1,
      learning: 3,
      review: 3,
      due: 4,
      lapsed: 1,
      leeches: 0,
      flagged: 0,
      suspended: 0,
      buried: 0,
    })
  })

  it("leeches are the questions tagged leech, whatever their lapses", () => {
    const tagged = [
      row({ id: "a", tags: ["leech"] }, { lapses: 9 }),
      row({ id: "b", tags: ["leech", "physics"] }, { lapses: 0 }),
      row({ id: "c", tags: ["physics"] }, { lapses: 12 }),
    ]
    expect(
      filterRows(tagged, { query: "", filter: "leeches" }, NOW).map((r) => r.id)
    ).toEqual(["a", "b"])
    expect(filterCounts(tagged, NOW).leeches).toBe(2)
  })

  it("due matches the dashboard's Learning + Due counts", () => {
    const cards = rows.map((r) => ({
      cardId: r.id,
      topicId: r.topicId,
      state: r.state,
      due: r.due,
    }))
    const counts = countCards(cards, NOW)
    expect(counts.learning + counts.due).toBe(filterCounts(rows, NOW).due)
  })
})

describe("sortRows", () => {
  it("sorts the source number numerically, then as text", () => {
    const rows = [
      row({ id: "a", sl: 10 }),
      row({ id: "b", sl: 2 }),
      row({ id: "c", sl: 1 }),
    ]
    expect(sortRows(rows, "number", "asc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ])
    expect(sortRows(rows, "number", "desc").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ])

    const text = [
      row({ id: "a", sl: "Q10" }),
      row({ id: "b", sl: "Q2" }),
      row({ id: "c", sl: 3 }),
    ]
    expect(sortRows(text, "number", "asc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ])
  })

  it("puts New cards last by due, soonest first", () => {
    const rows = [
      row({ id: "new", sl: 1 }, { state: 0, due: 0 }),
      row({ id: "later", sl: 2 }, { due: NOW + 9 * DAY }),
      row({ id: "soon", sl: 3 }, { due: NOW + DAY }),
    ]
    expect(sortRows(rows, "due", "asc").map((r) => r.id)).toEqual([
      "soon",
      "later",
      "new",
    ])
    expect(sortRows(rows, "due", "desc").map((r) => r.id)).toEqual([
      "new",
      "later",
      "soon",
    ])
  })

  it("sorts by lapses and difficulty, ties by source number", () => {
    const rows = [
      row({ id: "a", sl: 1 }, { lapses: 1, difficulty: 3 }),
      row({ id: "b", sl: 2 }, { lapses: 4, difficulty: 3 }),
      row({ id: "c", sl: 3 }, { lapses: 1, difficulty: 9 }),
    ]
    expect(sortRows(rows, "lapses", "desc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ])
    expect(sortRows(rows, "difficulty", "desc").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  it("sorts questions alphabetically, ignoring case", () => {
    const rows = [
      row({ id: "a", question: "banana" }),
      row({ id: "b", question: "Apple" }),
      row({ id: "c", question: "cherry" }),
    ]
    expect(sortRows(rows, "question", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ])
  })

  it("sorts by reps, state and topic", () => {
    const rows = [
      row({ id: "a", sl: 1 }, { reps: 2, state: 2 }),
      row({ id: "b", sl: 2 }, { reps: 9, state: 1 }),
      row({ id: "c", sl: 3 }, { reps: 5, state: 0 }),
    ]
    expect(sortRows(rows, "reps", "desc").map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ])
    expect(sortRows(rows, "state", "asc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ])

    const decks = [
      { ...row({ id: "a", sl: 1 }), subjectName: "Math", topicName: "Algebra" },
      { ...row({ id: "b", sl: 2 }), subjectName: "Art", topicName: "Zebra" },
      { ...row({ id: "c", sl: 3 }), subjectName: "Art", topicName: "Apple" },
    ]
    expect(sortRows(decks, "topic", "asc").map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ])
  })

  it("does not modify its input and has sensible default directions", () => {
    const rows = [row({ id: "a", sl: 2 }), row({ id: "b", sl: 1 })]
    sortRows(rows, "number", "asc")
    expect(rows.map((r) => r.id)).toEqual(["a", "b"])
    expect(defaultDirection("reps")).toBe("desc")
    expect(defaultDirection("topic")).toBe("asc")
    expect(defaultDirection("lapses")).toBe("desc")
    expect(defaultDirection("difficulty")).toBe("desc")
    expect(defaultDirection("number")).toBe("asc")
    expect(defaultDirection("due")).toBe("asc")
  })
})

describe("labels", () => {
  it("names the four states", () => {
    expect([0, 1, 2, 3].map(stateLabel)).toEqual([
      "New",
      "Learning",
      "Review",
      "Relearning",
    ])
    expect(stateLabel(9)).toBe("Unknown")
  })

  it("formats due dates", () => {
    const at = (state: number, due: number) => formatDue({ state, due }, NOW)
    expect(at(0, 0)).toBe("new")
    expect(at(1, NOW - 1000)).toBe("now")
    expect(at(1, NOW + 10 * 60_000)).toBe("in 10m")
    expect(at(3, NOW + 3 * HOUR)).toBe("in 3h")
    expect(at(2, NOW + 2 * HOUR)).toBe("today")
    expect(at(2, NOW + DAY)).toBe("tomorrow")
    expect(at(2, NOW - 3 * DAY)).toBe("3d overdue")
    expect(at(2, NOW + 9 * DAY)).toBe("in 9d")
    expect(at(2, NOW + 60 * DAY)).toBe("in 2mo")
    expect(at(2, NOW + 400 * DAY)).toBe("in 1.1y")
  })
})

describe("noteAsJson with tags", () => {
  const base = {
    question: "Q",
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    extra: "",
  }

  it("adds the tags after the other fields when there are some", () => {
    const text = noteAsJson({ ...base, tags: ["exam", "physics"] })
    expect(JSON.parse(text).tags).toEqual(["exam", "physics"])
    expect(Object.keys(JSON.parse(text)).at(-1)).toBe("tags")
  })

  it("leaves them out when empty or missing", () => {
    expect(JSON.parse(noteAsJson({ ...base, tags: [] }))).not.toHaveProperty(
      "tags"
    )
    expect(JSON.parse(noteAsJson(base))).not.toHaveProperty("tags")
  })
})

describe("noteAsJson", () => {
  const full = {
    question: "What is the SI unit of force?",
    options: ["Newton", "Joule", "Watt", "Pascal"],
    correctIndex: 0,
    extra: "Named after Isaac Newton.",
  }

  it("has the question, lettered options, the answer letter and the extra", () => {
    expect(JSON.parse(noteAsJson(full))).toEqual({
      question: "What is the SI unit of force?",
      options: { A: "Newton", B: "Joule", C: "Watt", D: "Pascal" },
      answer: "A",
      extra: "Named after Isaac Newton.",
    })
  })

  it("is pretty-printed with the keys in reading order", () => {
    const text = noteAsJson({ ...full, correctIndex: 2 })
    expect(text).toContain("\n  ")
    expect(Object.keys(JSON.parse(text))).toEqual([
      "question",
      "options",
      "answer",
      "extra",
    ])
    expect(JSON.parse(text).answer).toBe("C")
  })

  it("leaves out an empty extra", () => {
    expect(JSON.parse(noteAsJson({ ...full, extra: "  " }))).not.toHaveProperty(
      "extra"
    )
  })

  it("replaces image tokens, keeping any alt text", () => {
    const id = "0123456789abcdef0123456789abcdef"
    const data = JSON.parse(
      noteAsJson({
        question: `See ![the graph](img:${id}) and ![](img:${id})`,
        options: [`![](img:${id})`, "b", "c", "d"],
        correctIndex: 1,
        extra: `![fig](img:${id})`,
      })
    )
    expect(data.question).toBe("See [image: the graph] and [image]")
    expect(data.options.A).toBe("[image]")
    expect(data.extra).toBe("[image: fig]")
  })

  it("keeps math, quotes and line breaks intact", () => {
    const data = JSON.parse(
      noteAsJson({
        question: 'Solve $x^2 = 4$ for "x"\nShow work.',
        options: ["\\(2\\)", "b", "c", "d"],
        correctIndex: 0,
        extra: "",
      })
    )
    expect(data.question).toBe('Solve $x^2 = 4$ for "x"\nShow work.')
    expect(data.options.A).toBe("\\(2\\)")
  })
})

describe("flags, suspended and buried cards", () => {
  const rows = [
    row({ id: "plain" }, { state: 2, due: NOW - DAY }),
    row({ id: "red" }, { state: 2, due: NOW - DAY, flag: 1 }),
    row({ id: "blue" }, { state: 0, flag: 4 }),
    row({ id: "susp" }, { state: 2, due: NOW - DAY, suspended: true }),
    row(
      { id: "buried" },
      { state: 2, due: NOW - DAY, buriedUntil: NOW + HOUR }
    ),
    row(
      { id: "was-buried" },
      { state: 2, due: NOW - DAY, buriedUntil: NOW - 1 }
    ),
  ]
  const ids = (filter: Parameters<typeof filterRows>[1]["filter"]) =>
    filterRows(rows, { query: "", filter }, NOW).map((r) => r.id)

  it("reads the marks from the card, unmarked when absent", () => {
    expect(rows[1]).toMatchObject({ flag: 1, suspended: false, buriedUntil: 0 })
    expect(rows[3].suspended).toBe(true)
    const none = makeBrowseRow(note(), undefined, "T", "S")
    expect(none).toMatchObject({ flag: 0, suspended: false, buriedUntil: 0 })
  })

  it("filters flagged, suspended and buried rows", () => {
    expect(ids("flagged")).toEqual(["red", "blue"])
    expect(ids("suspended")).toEqual(["susp"])
    expect(ids("buried")).toEqual(["buried"])
  })

  it("keeps hidden rows out of Due, matching the dashboard", () => {
    expect(ids("due")).toEqual(["plain", "red", "was-buried"])
    const counts = countCards(
      rows.map((r) => ({ ...r, cardId: r.id })),
      NOW
    )
    expect(ids("due")).toHaveLength(counts.due + counts.learning)
    expect(isDueRow({ state: 2, due: NOW - DAY, suspended: true }, NOW)).toBe(
      false
    )
  })

  it("filters by flag colour (any of the chosen flags)", () => {
    const by = (flags: number[]) =>
      filterRows(rows, { query: "", filter: "all", flags }, NOW).map(
        (r) => r.id
      )
    expect(by([1])).toEqual(["red"])
    expect(by([1, 4])).toEqual(["red", "blue"])
    expect(by([])).toHaveLength(rows.length)
  })

  it("counts every filter, including the new ones", () => {
    expect(filterCounts(rows, NOW)).toMatchObject({
      flagged: 2,
      suspended: 1,
      buried: 1,
    })
  })

  it("counts rows per flag, leaving out unused flags", () => {
    const more = [...rows, row({ id: "red2" }, { flag: 1 })]
    expect(flagCounts(more)).toEqual([
      { flag: 1, count: 2 },
      { flag: 4, count: 1 },
    ])
    expect(flagCounts([])).toEqual([])
  })

  it("sorts flagged rows first, by colour, and unflagged last", () => {
    const asc = sortRows(rows, "flag", "asc").map((r) => r.id)
    expect(asc.slice(0, 2)).toEqual(["red", "blue"])
    const desc = sortRows(rows, "flag", "desc").map((r) => r.id)
    expect(desc.slice(-2)).toEqual(["blue", "red"])
  })
})
