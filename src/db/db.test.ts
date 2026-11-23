import { beforeEach, describe, expect, it } from "vitest"

import { Rating } from "@/db/scheduler"
import { parseImportText, validateRows } from "@/lib/importer"

import { computeDigests, readBackupParts } from "./backup-parts"
import { openDatabase } from "./database"
import { subscribeTables } from "./live"
import {
  loadCardHistory,
  loadDashboard,
  loadImageView,
  loadStudyCards,
  loadTagNames,
  loadTopicNotes,
} from "./queries"
import {
  addImage,
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
import type { CardRow, Note } from "./types"

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
  return commitImport(
    {
      subject: { kind: "new", name: "Quiz" },
      topic: { kind: "new", name: "Basics" },
    },
    valid,
    0,
    1_000
  )
}

const NOW = 5_000_000_000_000

beforeEach(async () => {
  await openDatabase(memoryBackend())
})

describe("startup", () => {
  it("creates the schema and seeds the sample deck once", async () => {
    const data = await loadDashboard(NOW)
    expect(data.subjects.map((s) => s.name)).toEqual(["Sample Subject"])
    const counts = [...data.counts.values()][0]
    expect(counts.new).toBe(3)
    expect(data.tags.map((t) => t.tag)).toEqual([
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
    expect(data.subjects.map((s) => s.name)).toEqual(["Quiz", "Sample Subject"])
    expect(data.tags.map((t) => t.tag)).toContain("europe")
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

  it("deleting a subject tombstones its topics and notes", async () => {
    await importQuestions()
    const subject = (await loadDashboard(NOW)).subjects.find(
      (s) => s.name === "Quiz"
    )
    expect(subject).toBeDefined()
    await softDeleteDeck(subject!.id, NOW)
    const data = await loadDashboard(NOW)
    expect(data.subjects.map((s) => s.name)).toEqual(["Sample Subject"])
    const topic = await loadStudyCards({ kind: "subject", id: subject!.id })
    expect(topic).toEqual([])
  })

  it("creates a topic only under a live subject", async () => {
    const subject = await createDeck("Maths")
    const topic = await createDeck("Algebra", subject.id)
    await expect(createDeck("Nested", topic.id)).rejects.toThrow()
    await expect(createDeck("Orphan", "nope")).rejects.toThrow()
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
    expect(after.subjects).toEqual(before.subjects)
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
