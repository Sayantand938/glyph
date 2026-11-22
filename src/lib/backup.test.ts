import { describe, expect, it } from "vitest"

import type { CardRow, Deck, Note, RevlogRow } from "@/db/types"

import {
  BACKUP_SCHEMA_VERSION,
  backupFilename,
  exportBackup,
  formatMergeSummary,
  mergeBackup,
  parseBackup,
  serializeBackup,
  type BackupData,
} from "./backup"

function deck(id: string, over: Partial<Deck> = {}): Deck {
  return {
    id,
    parentId: null,
    name: id,
    updatedAt: 100,
    deletedAt: null,
    ...over,
  }
}

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    topicId: "t1",
    sl: 1,
    question: `q ${id}`,
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    extra: "",
    contentUpdatedAt: 100,
    deletedAt: null,
    ...over,
  }
}

function card(id: string, over: Partial<CardRow> = {}): CardRow {
  return {
    cardId: id,
    noteId: id,
    topicId: "t1",
    due: 100,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: 0,
    updatedAt: 100,
    ...over,
  }
}

function log(id: string, over: Partial<RevlogRow> = {}): RevlogRow {
  return {
    id,
    cardId: "n1",
    reviewedAt: 100,
    rating: 3,
    state: 0,
    durationMs: 500,
    ...over,
  }
}

function data(over: Partial<BackupData> = {}): BackupData {
  return { decks: [], notes: [], cards: [], revlog: [], ...over }
}

/** Applies a merge result's writes to a local data set, like the DB layer. */
function apply(local: BackupData, write: BackupData): BackupData {
  const upsert = <T>(rows: T[], extra: T[], key: (row: T) => string): T[] => {
    const map = new Map(rows.map((r) => [key(r), r]))
    for (const r of extra) map.set(key(r), r)
    return [...map.values()]
  }
  return {
    decks: upsert(local.decks, write.decks, (r) => r.id),
    notes: upsert(local.notes, write.notes, (r) => r.id),
    cards: upsert(local.cards, write.cards, (r) => r.cardId),
    revlog: upsert(local.revlog, write.revlog, (r) => r.id),
  }
}

describe("exportBackup / parseBackup", () => {
  const sample = data({
    decks: [deck("s1"), deck("t1", { parentId: "s1", deletedAt: 500 })],
    notes: [note("n1"), note("n2", { deletedAt: 400, sl: "x" })],
    cards: [card("n1", { state: 2, lastReview: 90 })],
    revlog: [log("r1")],
  })

  it("round-trips losslessly, tombstones included", () => {
    const file = exportBackup(sample, 12345)
    expect(file).toMatchObject({
      app: "mcq-srs",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 12345,
    })
    const parsed = parseBackup(serializeBackup(file))
    expect(parsed).toEqual({ ok: true, backup: file })
  })

  it("accepts a UTF-8 BOM", () => {
    const text = `\uFEFF${serializeBackup(exportBackup(sample, 1))}`
    expect(parseBackup(text).ok).toBe(true)
  })

  it("strips unknown fields", () => {
    const file = exportBackup(sample, 1)
    const dirty = JSON.parse(serializeBackup(file)) as typeof file
    ;(dirty.notes[0] as unknown as Record<string, unknown>).evil = "x"
    const parsed = parseBackup(JSON.stringify(dirty))
    expect(parsed.ok && "evil" in parsed.backup.notes[0]).toBe(false)
  })

  const rejects = (text: string, message: RegExp) => {
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(message)
  }
  const mutate = (fn: (f: Record<string, unknown>) => void): string => {
    const file = JSON.parse(serializeBackup(exportBackup(sample, 1))) as Record<
      string,
      unknown
    >
    fn(file)
    return JSON.stringify(file)
  }

  it("rejects garbage", () => {
    rejects("not json", /not valid JSON/)
    rejects("[]", /not a Glyph backup/)
    rejects("null", /not a Glyph backup/)
    rejects(
      mutate((f) => (f.app = "other")),
      /not a Glyph backup/
    )
  })

  it("rejects missing, invalid and newer schema versions", () => {
    rejects(
      mutate((f) => delete f.schemaVersion),
      /schema version/
    )
    rejects(
      mutate((f) => (f.schemaVersion = "1")),
      /schema version/
    )
    rejects(
      mutate((f) => (f.schemaVersion = 0)),
      /schema version/
    )
    rejects(
      mutate((f) => (f.schemaVersion = BACKUP_SCHEMA_VERSION + 1)),
      /newer version/
    )
  })

  it("rejects a missing table or a damaged row, naming it", () => {
    rejects(
      mutate((f) => delete f.revlog),
      /"revlog"/
    )
    rejects(
      mutate((f) => ((f.notes as unknown[])[1] = { id: "n2" })),
      /notes\[1\]/
    )
    rejects(
      mutate((f) => ((f.cards as Record<string, unknown>[])[0].state = 9)),
      /cards\[0\]/
    )
    rejects(
      mutate((f) => ((f.revlog as Record<string, unknown>[])[0].rating = 0)),
      /revlog\[0\]/
    )
    rejects(
      mutate(
        (f) => ((f.notes as Record<string, unknown>[])[0].options = ["a"])
      ),
      /notes\[0\]/
    )
  })
})

describe("backupFilename", () => {
  it("uses the local date", () => {
    expect(backupFilename(new Date(2026, 0, 5, 23, 59).getTime())).toBe(
      "mcq-backup-2026-01-05.json"
    )
  })
})

describe("mergeBackup: decks", () => {
  it("newer updatedAt wins in both directions", () => {
    const older = data({ decks: [deck("a", { name: "old", updatedAt: 1 })] })
    const newer = data({ decks: [deck("a", { name: "new", updatedAt: 2 })] })
    expect(mergeBackup(older, newer).merged.decks[0].name).toBe("new")
    expect(mergeBackup(newer, older).merged.decks[0].name).toBe("new")
    expect(mergeBackup(newer, older).write.decks).toEqual([])
  })

  it("adds unknown decks and propagates a newer tombstone", () => {
    const local = data({ decks: [deck("a", { updatedAt: 1 })] })
    const incoming = data({
      decks: [deck("a", { updatedAt: 5, deletedAt: 5 }), deck("b")],
    })
    const result = mergeBackup(local, incoming)
    expect(result.merged.decks.find((d) => d.id === "a")?.deletedAt).toBe(5)
    expect(result.stats).toMatchObject({ decksAdded: 1, decksUpdated: 1 })
  })

  it("lets a tombstone win an exact tie", () => {
    const live = data({ decks: [deck("a", { updatedAt: 7 })] })
    const dead = data({ decks: [deck("a", { updatedAt: 7, deletedAt: 7 })] })
    expect(mergeBackup(live, dead).merged.decks[0].deletedAt).toBe(7)
    expect(mergeBackup(dead, live).merged.decks[0].deletedAt).toBe(7)
  })
})

describe("mergeBackup: notes", () => {
  it("newer contentUpdatedAt wins in both directions", () => {
    const a = data({
      notes: [note("n1", { extra: "old", contentUpdatedAt: 1 })],
    })
    const b = data({
      notes: [note("n1", { extra: "new", contentUpdatedAt: 2 })],
    })
    expect(mergeBackup(a, b).merged.notes[0].extra).toBe("new")
    expect(mergeBackup(b, a).merged.notes[0].extra).toBe("new")
    expect(mergeBackup(a, b).stats.notesUpdated).toBe(1)
    expect(mergeBackup(b, a).stats.notesUpdated).toBe(0)
  })

  it("a newer tombstone beats an older live note, either side", () => {
    const live = data({ notes: [note("n1", { contentUpdatedAt: 10 })] })
    const dead = data({
      notes: [note("n1", { contentUpdatedAt: 10, deletedAt: 20 })],
    })
    expect(mergeBackup(live, dead).merged.notes[0].deletedAt).toBe(20)
    expect(mergeBackup(dead, live).merged.notes[0].deletedAt).toBe(20)
  })

  it("a live note edited after the tombstone wins (resurrection)", () => {
    const live = data({ notes: [note("n1", { contentUpdatedAt: 30 })] })
    const dead = data({
      notes: [note("n1", { contentUpdatedAt: 10, deletedAt: 20 })],
    })
    expect(mergeBackup(dead, live).merged.notes[0].deletedAt).toBeNull()
    expect(mergeBackup(live, dead).merged.notes[0].deletedAt).toBeNull()
    expect(mergeBackup(live, dead).write.notes).toEqual([])
  })

  it("a tombstone does not win when only as new as the live content", () => {
    const live = data({ notes: [note("n1", { contentUpdatedAt: 20 })] })
    const dead = data({
      notes: [note("n1", { contentUpdatedAt: 5, deletedAt: 20 })],
    })
    expect(mergeBackup(live, dead).merged.notes[0].deletedAt).toBeNull()
  })

  it("reports notes whose topic is missing", () => {
    const result = mergeBackup(
      data({ decks: [deck("t1", { parentId: "s1" })] }),
      data({ notes: [note("n1"), note("n2", { topicId: "gone" })] })
    )
    expect(result.stats.notesAdded).toBe(2)
    expect(result.stats.notesMissingTopic).toBe(1)
    expect(formatMergeSummary(result.stats)).toContain(
      "missing from the backup"
    )
  })
})

describe("mergeBackup: cards", () => {
  const base = { notes: [note("n1")] }

  it("larger lastReview wins in both directions", () => {
    const behind = data({
      ...base,
      cards: [card("n1", { lastReview: 10, reps: 1 })],
    })
    const ahead = data({
      ...base,
      cards: [card("n1", { lastReview: 50, reps: 4 })],
    })
    expect(mergeBackup(behind, ahead).merged.cards[0].reps).toBe(4)
    expect(mergeBackup(ahead, behind).merged.cards[0].reps).toBe(4)
    expect(mergeBackup(ahead, behind).write.cards).toEqual([])
  })

  it("breaks lastReview ties on updatedAt", () => {
    const a = data({
      ...base,
      cards: [card("n1", { lastReview: 10, updatedAt: 10, reps: 1 })],
    })
    const b = data({
      ...base,
      cards: [card("n1", { lastReview: 10, updatedAt: 20, reps: 2 })],
    })
    expect(mergeBackup(a, b).merged.cards[0].reps).toBe(2)
    expect(mergeBackup(b, a).merged.cards[0].reps).toBe(2)
  })

  it("drops incoming cards whose note does not exist", () => {
    const result = mergeBackup(data(), data({ cards: [card("orphan")] }))
    expect(result.merged.cards).toEqual([])
    expect(result.stats.cardsDropped).toBe(1)
    expect(formatMergeSummary(result.stats)).toContain("no matching note")
  })

  it("keeps a card for a tombstoned note", () => {
    const incoming = data({
      notes: [note("n1", { deletedAt: 9 })],
      cards: [card("n1")],
    })
    expect(mergeBackup(data(), incoming).merged.cards).toHaveLength(1)
  })

  it("repairs topicId to match the winning note", () => {
    const local = data({
      notes: [note("n1", { topicId: "t1", contentUpdatedAt: 1 })],
      cards: [card("n1", { topicId: "t1", lastReview: 50 })],
    })
    const incoming = data({
      notes: [note("n1", { topicId: "t2", contentUpdatedAt: 9 })],
      cards: [card("n1", { topicId: "t2", lastReview: 10 })],
    })
    const result = mergeBackup(local, incoming)
    expect(result.merged.notes[0].topicId).toBe("t2")
    // Local progress wins, but the card follows the note to its new topic.
    expect(result.merged.cards[0]).toMatchObject({
      topicId: "t2",
      lastReview: 50,
    })
    expect(result.write.cards).toHaveLength(1)
  })
})

describe("mergeBackup: revlog", () => {
  it("unions by id", () => {
    const local = data({ revlog: [log("r1"), log("r2")] })
    const incoming = data({ revlog: [log("r2"), log("r3")] })
    const result = mergeBackup(local, incoming)
    expect(result.merged.revlog.map((r) => r.id).sort()).toEqual([
      "r1",
      "r2",
      "r3",
    ])
    expect(result.write.revlog.map((r) => r.id)).toEqual(["r3"])
    expect(result.stats.reviewsAdded).toBe(1)
  })
})

describe("mergeBackup: idempotence and round trips", () => {
  const backup = data({
    decks: [deck("s1"), deck("t1", { parentId: "s1" })],
    notes: [note("n1"), note("n2", { deletedAt: 300 })],
    cards: [card("n1", { state: 2, lastReview: 90 }), card("n2")],
    revlog: [log("r1"), log("r2")],
  })

  it("importing into an empty database restores everything", () => {
    const result = mergeBackup(data(), backup)
    expect(result.merged).toEqual(backup)
    expect(result.stats).toMatchObject({
      decksAdded: 2,
      notesAdded: 2,
      cardsUpdated: 2,
      reviewsAdded: 2,
    })
  })

  it("merging the same backup twice changes nothing the second time", () => {
    const first = mergeBackup(data(), backup)
    const after = apply(data(), first.write)
    const second = mergeBackup(after, backup)
    expect(second.write).toEqual(data())
    expect(second.merged).toEqual(after)
    expect(formatMergeSummary(second.stats)).toBe("Nothing new to merge.")
  })

  it("importing an older backup over newer data keeps the newer rows", () => {
    const older = backup
    const newer = data({
      decks: [
        deck("s1", { name: "renamed", updatedAt: 500 }),
        deck("t1", { parentId: "s1" }),
      ],
      notes: [
        note("n1", { extra: "edited", contentUpdatedAt: 500 }),
        note("n2", { deletedAt: 300 }),
      ],
      cards: [
        card("n1", { state: 2, lastReview: 400, reps: 9, updatedAt: 400 }),
        card("n2"),
      ],
      revlog: [log("r1"), log("r2"), log("r3")],
    })
    const result = mergeBackup(newer, older)
    expect(result.merged).toEqual(newer)
    expect(result.write).toEqual(data())
  })

  it("is commutative for conflicting edits", () => {
    const a = data({
      notes: [note("n1", { extra: "A", contentUpdatedAt: 5 })],
      cards: [card("n1", { lastReview: 7, reps: 1 })],
      revlog: [log("ra")],
    })
    const b = data({
      notes: [note("n1", { extra: "B", contentUpdatedAt: 9 })],
      cards: [card("n1", { lastReview: 3, reps: 2 })],
      revlog: [log("rb")],
    })
    const sorted = (d: BackupData) => ({
      notes: d.notes,
      cards: d.cards,
      revlog: d.revlog.map((r) => r.id).sort(),
    })
    expect(sorted(mergeBackup(a, b).merged)).toEqual(
      sorted(mergeBackup(b, a).merged)
    )
  })
})

describe("formatMergeSummary", () => {
  const zero = mergeBackup(data(), data()).stats

  it("reports notes, cards and reviews", () => {
    expect(
      formatMergeSummary({
        ...zero,
        notesAdded: 4,
        cardsUpdated: 1,
        reviewsAdded: 20,
      })
    ).toBe("Merged: +4 notes, +1 card updated, +20 reviews.")
  })
})
