import { beforeEach, describe, expect, it } from "vitest"

import { Rating } from "@/db/scheduler"
import { parseImportText, validateRows } from "@/lib/importer"

import { computeDigests, readBackupParts } from "./backup-parts"
import { openDatabase } from "./database"
import { subscribeTables } from "./live"
import {
  loadCardHistory,
  loadBrowseItems,
  loadDashboard,
  loadDeckInfo,
  loadImageView,
  loadStudyCards,
  loadTagNames,
  loadTopicNotes,
} from "./queries"
import {
  addImage,
  addNote,
  applyReview,
  commitImport,
  createDeck,
  deleteNote,
  importBackup,
  saveNote,
  saveSetting,
  setFlag,
  softDeleteDeck,
  undoReview,
} from "./repo"
import { db } from "./database"
import { memoryBackend } from "./test-backend"
import { CARDS, NOTES, getRow } from "./tables"
import type { CardRow, Deck, Note } from "./types"

const QUESTIONS = JSON.stringify([
  {
    sl: 1,
    questions: "Capital of France?",
    op1: "Paris",
    op2: "Rome",
    op3: "Oslo",
    op4: "Bern",
    answer: "A",
    tags: ["geo", "europe"],
  },
  {
    sl: 2,
    questions: "2 + 2?",
    op1: "3",
    op2: "4",
    op3: "5",
    op4: "6",
    answer: "B",
    tags: ["math"],
  },
])

async function importQuestions() {
  const parsed = parseImportText(QUESTIONS)
  if (!parsed.ok) throw new Error(parsed.error)
  const { valid, invalid } = validateRows(parsed.rows)
  expect(invalid).toEqual([])
  return commitImport({ path: ["Quiz", "Basics"] }, valid, 0, 1_000)
}

const NOW = 5_000_000_000_000

const topLevelNames = (data: { children: Map<string | null, Deck[]> }) =>
  (data.children.get(null) ?? []).map((d) => d.name)

/** New cards across every deck (each card is counted once, in its own deck). */
const totalNew = (data: { counts: Map<string, { new: number }> }) =>
  [...data.counts.values()].reduce((sum, c) => sum + c.new, 0)

beforeEach(async () => {
  await openDatabase(memoryBackend())
})

describe("startup", () => {
  it("creates the schema and seeds the sample deck once", async () => {
    const data = await loadDashboard(NOW)
    expect(topLevelNames(data)).toEqual(["Sample Subject"])
    expect(totalNew(data)).toBe(3)
    expect(await loadTagNames()).toEqual([
      "astronomy",
      "chemistry",
      "geography",
    ])
  })
})

describe("import and queries", () => {
  it("imports into new decks and indexes the tags", async () => {
    const summary = await importQuestions()
    expect(summary.added).toBe(2)
    const data = await loadDashboard(NOW)
    expect(topLevelNames(data)).toEqual(["Quiz", "Sample Subject"])
    expect(await loadTagNames()).toContain("europe")
    expect(await loadTagNames()).toContain("math")

    const tagged = await loadStudyCards({ kind: "tag", id: "geo" })
    expect(tagged).toHaveLength(1)
  })

  it("importing again changes nothing and keeps card progress", async () => {
    await importQuestions()
    const [card] = await loadStudyCards({ kind: "tag", id: "math" })
    await applyReview(card, Rating.Good, 1200, 0.9, undefined, NOW)
    const again = await importQuestions()
    expect(again.added).toBe(0)
    const stored = await db.transaction((tx) => getRow(tx, CARDS, card.cardId))
    expect(stored?.reps).toBe(1)
  })
})

describe("reviews", () => {
  it("applies a review, logs it and undoes it", async () => {
    await importQuestions()
    const [before] = await loadStudyCards({ kind: "tag", id: "math" })
    const { row, log } = await applyReview(
      before,
      Rating.Good,
      900,
      0.9,
      undefined,
      NOW
    )
    expect(row.reps).toBe(1)
    let history = await loadCardHistory(before.cardId)
    expect(history.logs.map((l) => l.id)).toEqual([log.id])
    expect(history.logs[0].correct).toBe(true)

    expect(await undoReview(log.id, before)).toBe(true)
    history = await loadCardHistory(before.cardId)
    expect(history.logs).toEqual([])
    expect(history.card).toEqual(before)
    // A second undo finds no log and changes nothing.
    expect(await undoReview(log.id, before)).toBe(false)
  })

  it("keeps a flag set before the review lands", async () => {
    await importQuestions()
    const [stale] = await loadStudyCards({ kind: "tag", id: "math" })
    await setFlag(stale.cardId, 3, NOW)
    const { row } = await applyReview(
      stale,
      Rating.Again,
      500,
      0.9,
      undefined,
      NOW
    )
    expect(row.flag).toBe(3)
    const stored: CardRow | undefined = await db.transaction((tx) =>
      getRow(tx, CARDS, stale.cardId)
    )
    expect(stored?.flag).toBe(3)
    expect(stored?.lapses).toBe(row.lapses)
  })
})

describe("notes and decks", () => {
  it("saves an edit with new tags and a soft delete hides the note", async () => {
    await importQuestions()
    const [card] = await loadStudyCards({ kind: "tag", id: "math" })
    const note = await db.transaction((tx) => getRow(tx, NOTES, card.noteId))
    expect(note).toBeDefined()
    const edited: Note = { ...(note as Note), tags: ["algebra"] }
    await saveNote(edited, {}, NOW)

    expect(await loadStudyCards({ kind: "tag", id: "math" })).toEqual([])
    expect(await loadStudyCards({ kind: "tag", id: "algebra" })).toHaveLength(1)

    await deleteNote(card.noteId, NOW + 1)
    expect(await loadStudyCards({ kind: "tag", id: "algebra" })).toEqual([])
    // The row stays as a tombstone, so a re-import resurrects it.
    const stored = await db.transaction((tx) => getRow(tx, NOTES, card.noteId))
    expect(stored?.deletedAt).toBe(NOW + 1)
  })

  it("deleting a deck tombstones the decks inside it and their notes", async () => {
    await importQuestions()
    const quiz = (await loadDashboard(NOW)).children
      .get(null)
      ?.find((d) => d.name === "Quiz")
    expect(quiz).toBeDefined()
    await softDeleteDeck(quiz!.id, NOW)
    const data = await loadDashboard(NOW)
    expect(topLevelNames(data)).toEqual(["Sample Subject"])
    const cards = await loadStudyCards({ kind: "deck", id: quiz!.id })
    expect(cards).toEqual([])
  })

  it("creates a deck only under a live deck, and refuses a duplicate name", async () => {
    const maths = await createDeck("Maths")
    const algebra = await createDeck("Algebra", maths.id)
    await expect(createDeck("Orphan", "nope")).rejects.toThrow(
      "no longer exists"
    )
    await expect(createDeck("  algebra ", maths.id)).rejects.toThrow(
      "already exists"
    )
    // The same name is fine at another level.
    await expect(createDeck("Algebra", algebra.id)).resolves.toBeDefined()
    await softDeleteDeck(maths.id, NOW)
    await expect(createDeck("Late", algebra.id)).rejects.toThrow(
      "no longer exists"
    )
  })
})

describe("transactions", () => {
  it("rolls back everything when a step throws", async () => {
    const before = await loadDashboard(NOW)
    await expect(
      db.transaction(async (tx) => {
        await tx.execute("DELETE FROM decks")
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    const after = await loadDashboard(NOW)
    expect(topLevelNames(after)).toEqual(topLevelNames(before))
  })

  it("announces committed writes to live queries, not rolled back ones", async () => {
    const seen: number[] = []
    const off = subscribeTables(["settings"], () => seen.push(1))
    await db
      .transaction(async (tx) => {
        await tx.execute(
          "INSERT INTO settings (key, value, updatedAt) VALUES ('retention', '0.9', 1)"
        )
        throw new Error("no")
      })
      .catch(() => undefined)
    expect(seen).toHaveLength(0)
    await saveSetting("retention", 0.85, NOW)
    expect(seen).toHaveLength(1)
    off()
  })
})

describe("images", () => {
  it("stores base64 and serves a data URL", async () => {
    await addImage({
      id: "img1",
      mime: "image/png",
      width: 2,
      height: 3,
      data: "AAEC",
    })
    expect(await loadImageView("img1")).toEqual({
      src: "data:image/png;base64,AAEC",
      width: 2,
      height: 3,
    })
    expect(await loadImageView("nope")).toBeNull()
  })
})

describe("backup round trip", () => {
  it("a full read merged into an empty database gives equal digests", async () => {
    await importQuestions()
    const [card] = await loadStudyCards({ kind: "tag", id: "geo" })
    await applyReview(card, Rating.Good, 700, 0.9, undefined, NOW)
    await setFlag(card.cardId, 2, NOW + 10)
    await saveSetting("retention", 0.88, NOW)
    await addImage({
      id: "i1",
      mime: "image/png",
      width: 1,
      height: 1,
      data: "AAEC",
    })
    const digests = await computeDigests()
    const parts = []
    for await (const part of readBackupParts(null)) parts.push(part)
    expect(parts.length).toBeGreaterThan(0)

    await openDatabase(memoryBackend())
    // The fresh database has its own seed rows; merge into a cleared one so the
    // digests can match.
    await db.transaction(async (tx) => {
      for (const t of [
        "decks",
        "notes",
        "cards",
        "revlog",
        "images",
        "settings",
        "note_tags",
      ]) {
        await tx.execute(`DELETE FROM ${t}`)
      }
    })
    for (const part of parts) await importBackup(part)
    expect(await computeDigests()).toEqual(digests)

    const stored = await loadTopicNotes(card.topicId)
    expect(stored).toHaveLength(2)
  })

  it("a delta only carries what changed since", async () => {
    await importQuestions()
    const [card] = await loadStudyCards({ kind: "tag", id: "math" })
    const since = NOW
    await applyReview(card, Rating.Good, 400, 0.9, undefined, since + 100)
    const parts = []
    for await (const part of readBackupParts(since)) parts.push(part)
    const rows = parts.reduce(
      (n, p) => n + p.notes.length + p.cards.length + p.revlog.length,
      0
    )
    expect(rows).toBe(2) // the card and its review, no notes
  })
})

describe("adding a question by hand", () => {
  const draft = {
    question: "Largest ocean?",
    options: ["Atlantic", "Pacific", "Indian", "Arctic"] as [
      string,
      string,
      string,
      string,
    ],
    correctIndex: 1 as const,
    extra: "",
    tags: ["geo"],
  }

  async function topicId(): Promise<string> {
    const data = await loadDashboard(NOW)
    const subject = data.children.get(null)![0]
    return data.children.get(subject.id)![0].id
  }

  it("creates the note and a fresh card, numbered after the topic's last", async () => {
    const topic = await topicId()
    const before = await loadTopicNotes(topic)
    const note = await addNote(topic, draft, NOW)
    expect(note.sl).toBe(Math.max(...before.map((n) => Number(n.sl))) + 1)
    expect(note.deletedAt).toBeNull()

    const notes = await loadTopicNotes(topic)
    expect(notes.map((n) => n.id)).toContain(note.id)
    const card = await db.transaction((tx) => getRow(tx, CARDS, note.id))
    expect(card?.state).toBe(0)
    expect(await loadTagNames()).toContain("geo")
    expect((await loadStudyCards({ kind: "tag", id: "geo" })).length).toBe(1)
  })

  it("refuses the same question in the same deck", async () => {
    const topic = await topicId()
    await addNote(topic, draft, NOW)
    await expect(
      addNote(topic, { ...draft, question: "  largest   OCEAN?  " }, NOW + 1)
    ).rejects.toThrow("already in this deck")
  })

  it("brings a deleted question back with its old card", async () => {
    const topic = await topicId()
    const note = await addNote(topic, draft, NOW)
    const [card] = await loadStudyCards({ kind: "tag", id: "geo" })
    await applyReview(card, Rating.Good, 1000, 0.9, undefined, NOW)
    await deleteNote(note.id, NOW + 10)

    const back = await addNote(topic, { ...draft, extra: "Pacific" }, NOW + 20)
    expect(back.id).toBe(note.id)
    expect(back.deletedAt).toBeNull()
    expect(back.extra).toBe("Pacific")
    expect(back.contentUpdatedAt).toBeGreaterThan(NOW + 10)
    const kept = await db.transaction((tx) => getRow(tx, CARDS, note.id))
    expect(kept?.reps).toBe(1)
  })

  it("refuses a deck that was deleted, or sits under one", async () => {
    const topic = await topicId()
    const data = await loadDashboard(NOW)
    await softDeleteDeck(data.children.get(null)![0].id, NOW + 5)
    await expect(addNote(topic, draft, NOW + 6)).rejects.toThrow(
      "no longer exists"
    )
  })
})

describe("loadDeckInfo", () => {
  it("describes a deck with its path and sub-decks, and is null once deleted", async () => {
    const data = await loadDashboard(NOW)
    const subject = data.children.get(null)![0]
    const topic = data.children.get(subject.id)![0]

    const s = await loadDeckInfo(subject.id)
    expect(s?.deck.id).toBe(subject.id)
    expect(s?.children.map((t) => t.id)).toEqual([topic.id])
    expect(s?.descendants).toBe(1)
    expect(s?.siblings.map((d) => d.id)).toContain(subject.id)

    const t = await loadDeckInfo(topic.id)
    expect(t?.children).toEqual([])
    expect(t?.descendants).toBe(0)
    expect(t?.path.map((d) => d.name)).toEqual([subject.name, topic.name])
    expect(t?.siblings.map((d) => d.id)).toEqual([topic.id])

    await softDeleteDeck(subject.id, NOW + 1)
    expect(await loadDeckInfo(subject.id)).toBeNull()
    expect(await loadDeckInfo(topic.id)).toBeNull() // under a deleted subject
    expect(await loadDeckInfo("missing")).toBeNull()
  })
})

describe("decks to any depth", () => {
  const PATH = ["WBCS", "Mains", "2018", "Paper 4"]

  async function importInto(names: string[], question: string, now = 2_000) {
    const parsed = parseImportText(
      JSON.stringify([
        {
          sl: 1,
          questions: question,
          op1: "a",
          op2: "b",
          op3: "c",
          op4: "d",
          answer: "A",
        },
      ])
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const { valid } = validateRows(parsed.rows)
    return commitImport({ path: names }, valid, 0, now)
  }

  it("imports into a path of any length, creating every missing level once", async () => {
    await importInto(PATH, "Q1")
    await importInto(["wbcs", "MAINS", "2018", "Paper 3"], "Q2") // reuses 3 levels

    const data = await loadDashboard(NOW)
    const wbcs = data.children.get(null)!.find((d) => d.name === "WBCS")!
    const mains = data.children.get(wbcs.id)!
    expect(mains.map((d) => d.name)).toEqual(["Mains"])
    const y2018 = data.children.get(mains[0].id)!
    expect(y2018.map((d) => d.name)).toEqual(["2018"])
    const papers = data.children.get(y2018[0].id)!
    expect(papers.map((d) => d.name)).toEqual(["Paper 3", "Paper 4"])
  })

  it("studies and browses a deck together with everything below it", async () => {
    await importInto(PATH, "Q1")
    await importInto(["WBCS", "Mains", "2018", "Paper 3"], "Q2")
    await importInto(["WBCS", "Prelims"], "Q3")
    const data = await loadDashboard(NOW)
    const wbcs = data.children.get(null)!.find((d) => d.name === "WBCS")!
    const mains = data.children.get(wbcs.id)!.find((d) => d.name === "Mains")!

    expect(await loadStudyCards({ kind: "deck", id: mains.id })).toHaveLength(2)
    expect(await loadStudyCards({ kind: "deck", id: wbcs.id })).toHaveLength(3)

    const items = await loadBrowseItems({ kind: "deck", id: mains.id })
    expect(items.map((i) => i.row.deckPath).sort()).toEqual([
      "WBCS > Mains > 2018 > Paper 3",
      "WBCS > Mains > 2018 > Paper 4",
    ])
  })

  it("a question can be added to a deck at any level", async () => {
    await importInto(["WBCS", "Mains"], "Q1")
    const data = await loadDashboard(NOW)
    const wbcs = data.children.get(null)!.find((d) => d.name === "WBCS")!
    const note = await addNote(
      wbcs.id,
      {
        question: "Direct in WBCS?",
        options: ["a", "b", "c", "d"],
        correctIndex: 0,
        extra: "",
        tags: [],
      },
      NOW
    )
    const items = await loadBrowseItems({ kind: "deck", id: wbcs.id })
    expect(items.find((i) => i.note.id === note.id)?.row.deckPath).toBe("WBCS")
    expect(items).toHaveLength(2)
  })

  it("deleting a deck in the middle removes everything below it, not its parent", async () => {
    await importInto(PATH, "Q1")
    await importInto(["WBCS", "Prelims"], "Q2")
    const data = await loadDashboard(NOW)
    const wbcs = data.children.get(null)!.find((d) => d.name === "WBCS")!
    const mains = data.children.get(wbcs.id)!.find((d) => d.name === "Mains")!

    await softDeleteDeck(mains.id, NOW + 1)

    const after = await loadDashboard(NOW)
    expect(after.children.get(wbcs.id)!.map((d) => d.name)).toEqual(["Prelims"])
    expect(await loadStudyCards({ kind: "deck", id: wbcs.id })).toHaveLength(1)
    // The notes of the deleted decks are tombstoned with them.
    const all = await loadBrowseItems(null)
    expect(all.map((i) => i.note.question)).not.toContain("Q1")
  })

  it("a deck under a deleted one does not show up, even if it was not deleted itself", async () => {
    await importInto(PATH, "Q1")
    const data = await loadDashboard(NOW)
    const wbcs = data.children.get(null)!.find((d) => d.name === "WBCS")!
    // Only the top deck gets a tombstone (as a merge from another device could leave it).
    await db.transaction((tx) =>
      tx.execute("UPDATE decks SET deletedAt = ? WHERE id = ?", [NOW, wbcs.id])
    )
    const after = await loadDashboard(NOW)
    expect(topLevelNames(after)).toEqual(["Sample Subject"])
    expect(await loadBrowseItems(null)).toHaveLength(3)
  })
})
