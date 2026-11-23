import { describe, expect, it } from "vitest"

import type { BackupFile, CardRow, Deck, Note, RevlogRow } from "@/db/types"

import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  BackupFileError,
  BackupRowsError,
  PartBatcher,
  backupFileBlob,
  backupFileName,
  exportBackup,
  parseBackup,
  parseBackupLenient,
  parseSnapshotMeta,
  readBackupFile,
  serializeBackup,
  snapshotFileName,
  snapshotTime,
  snapshotsToDelete,
} from "./backup"
import { Crc32 } from "./backup/crc32"
import { digestOf, noteStamp } from "./sync"

const deck = (id: string): Deck => ({
  id,
  parentId: null,
  name: id,
  updatedAt: 100,
  deletedAt: null,
})

const note = (id: string): Note => ({
  id,
  topicId: "t1",
  sl: 1,
  question: `question \u00e9 \u4e2d ${id}`,
  options: ["a", "b", "c", "d"],
  correctIndex: 0,
  extra: "",
  tags: [],
  contentUpdatedAt: 100,
  deletedAt: null,
})

const card = (id: string): CardRow => ({
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
  flag: 0,
  suspended: false,
  buriedUntil: 0,
  markedAt: 0,
})

const log = (id: string): RevlogRow => ({
  id,
  cardId: "n1",
  reviewedAt: 100,
  rating: 3,
  state: 0,
  durationMs: 500,
  answerMs: 400,
  correct: true,
  stabilityAfter: 2.5,
  difficultyAfter: 5,
  scheduledDaysAfter: 2,
  dueAfter: 200,
})

function part(over: Partial<BackupFile>): BackupFile {
  return {
    ...exportBackup({ decks: [], notes: [], cards: [], revlog: [] }, 1),
    ...over,
  }
}

/** Parts like `readBackupParts`: decks, then notes in pages, cards, reviews. */
function sampleParts(notes = 5): BackupFile[] {
  const ids = Array.from({ length: notes }, (_, i) => `n${i + 1}`)
  return [
    part({ decks: [deck("t1")] }),
    part({ notes: ids.slice(0, 3).map(note) }),
    part({ notes: ids.slice(3).map(note) }),
    part({ cards: ids.map(card) }),
    part({ revlog: ids.map((id) => log(`r-${id}`)) }),
  ]
}

async function* asyncParts(parts: BackupFile[]): AsyncGenerator<BackupFile> {
  for (const p of parts) yield p
}

const blobOf = (parts: BackupFile[], compress: boolean) =>
  backupFileBlob(asyncParts(parts), 12345, { compress })

async function textOf(blob: Blob): Promise<string> {
  return blob.text()
}

async function collect(blob: Blob): Promise<BackupFile[]> {
  const got: BackupFile[] = []
  await readBackupFile(blob, (p) => {
    got.push(p)
  })
  return got
}

const rowsOf = (parts: BackupFile[]) => ({
  decks: parts.flatMap((p) => p.decks),
  notes: parts.flatMap((p) => p.notes),
  cards: parts.flatMap((p) => p.cards),
  revlog: parts.flatMap((p) => p.revlog),
})

describe("Crc32", () => {
  it("matches the standard check value", () => {
    const bytes = new TextEncoder().encode("123456789")
    expect(new Crc32().update(bytes).hex()).toBe("cbf43926")
  })

  it("gives the same result however the bytes are cut", () => {
    const bytes = new TextEncoder().encode("The quick brown fox jumps")
    const split = new Crc32()
      .update(bytes.subarray(0, 7))
      .update(bytes.subarray(7))
    expect(split.hex()).toBe(new Crc32().update(bytes).hex())
  })
})

describe("a backup file stream", () => {
  it.each([true, false])("round trips every row (gzip %s)", async (gzip) => {
    const parts = sampleParts()
    const blob = await blobOf(parts, gzip)
    const info = await readBackupFile(blob)
    expect(info.kind).toBe("stream")
    expect(info.compressed).toBe(gzip)
    expect(info.parts).toBe(parts.length)
    expect(info.rows).toEqual({
      decks: 1,
      notes: 5,
      cards: 5,
      revlog: 5,
      images: 0,
      settings: 0,
    })
    expect(info.exportedAt).toBe(12345)
    expect(rowsOf(await collect(blob))).toEqual(rowsOf(parts))
  })

  it("gives the same digest as the rows it was made from", async () => {
    const parts = sampleParts(40)
    const back = rowsOf(await collect(await blobOf(parts, true)))
    expect(digestOf(back.notes.map(noteStamp))).toEqual(
      digestOf(rowsOf(parts).notes.map(noteStamp))
    )
  })

  it("is plain lines of JSON when not compressed, header first, footer last", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const lines = text.trimEnd().split("\n")
    expect(lines).toHaveLength(7)
    expect(lines[0].startsWith('{"format":"glyph-stream"')).toBe(true)
    expect(JSON.parse(lines[0])).toMatchObject({
      app: BACKUP_APP,
      schemaVersion: BACKUP_SCHEMA_VERSION,
    })
    for (const line of lines.slice(1, -1)) {
      expect(parseBackup(line).ok).toBe(true)
    }
    expect(JSON.parse(lines[6])).toMatchObject({ end: true, parts: 5 })
  })

  it("is smaller when gzipped", async () => {
    const parts = sampleParts(500)
    const plain = await blobOf(parts, false)
    const packed = await blobOf(parts, true)
    expect(packed.size).toBeLessThan(plain.size / 3)
  })

  it("writes a file with no rows", async () => {
    const info = await readBackupFile(await blobOf([], true))
    expect(info.parts).toBe(0)
    expect(info.rows.notes).toBe(0)
  })

  it("handles a part bigger than the chunks the file is read in", async () => {
    const big = part({
      notes: Array.from({ length: 4000 }, (_, i) => note(`n${i}`)),
    })
    const got = await collect(await blobOf([big], false))
    expect(got).toHaveLength(1)
    expect(got[0].notes).toHaveLength(4000)
  })
})

describe("a damaged backup file", () => {
  const rejects = async (blob: Blob, message: RegExp) => {
    const seen: BackupFile[] = []
    await expect(
      readBackupFile(blob, (p) => {
        seen.push(p)
      })
    ).rejects.toThrow(message)
    return seen
  }

  it("is refused when the footer is missing (cut short)", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const lines = text.split("\n")
    const cut = lines.slice(0, 4).join("\n") + "\n"
    await rejects(new Blob([cut]), /cut short/)
  })

  it("is refused when it ends in the middle of a line", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    await rejects(
      new Blob([text.slice(0, text.length - 20)]),
      /cut short|damaged/
    )
  })

  it("is refused when a byte is flipped", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const flipped = text.replace(
      '"contentUpdatedAt":100',
      '"contentUpdatedAt":101'
    )
    await rejects(new Blob([flipped]), /checksum/)
  })

  it("is refused when a whole part is lost", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const lines = text.split("\n")
    lines.splice(2, 1)
    await rejects(new Blob([lines.join("\n")]), /checksum|rows it says/)
  })

  it("is refused when the counts are wrong even if the bytes are fine", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const lines = text.trimEnd().split("\n")
    const footer = JSON.parse(lines[lines.length - 1]) as {
      rows: { notes: number }
    }
    footer.rows.notes += 1
    lines[lines.length - 1] = JSON.stringify(footer)
    await rejects(new Blob([lines.join("\n") + "\n"]), /rows it says/)
  })

  it("is refused when something follows the end marker", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    await rejects(new Blob([text + text.split("\n")[1] + "\n"]), /extra data/)
  })

  it("is refused when a row inside a part is invalid, before any later part", async () => {
    const parts = sampleParts()
    const bad = JSON.parse(serializeBackup(parts[1])) as {
      notes: Record<string, unknown>[]
    }
    bad.notes[0].options = "nope"
    const text = await textOf(await blobOf(parts, false))
    const lines = text.split("\n")
    lines[2] = JSON.stringify(bad)
    await rejects(new Blob([lines.join("\n")]), /damaged: notes\[0\]/)
  })

  it("is refused when a gzipped file is truncated", async () => {
    const blob = await blobOf(sampleParts(300), true)
    const cut = blob.slice(0, Math.floor(blob.size * 0.6))
    await rejects(cut, /damaged or cut short/)
  })

  it("is refused when a gzipped file has a flipped byte", async () => {
    const bytes = new Uint8Array(
      await (await blobOf(sampleParts(300), true)).arrayBuffer()
    )
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    await rejects(
      new Blob([bytes]),
      /damaged|checksum|cut short|not a Glyph|extra|rows it says/
    )
  })

  it("is refused when it is gzip of something else", async () => {
    const stream = new Blob(["hello world"])
      .stream()
      .pipeThrough(new CompressionStream("gzip"))
    const blob = await new Response(stream).blob()
    await expect(readBackupFile(blob)).rejects.toBeInstanceOf(BackupFileError)
  })

  it("lets an error from the importer through unchanged", async () => {
    const blob = await blobOf(sampleParts(), true)
    await expect(
      readBackupFile(blob, () => {
        throw new Error("disk full")
      })
    ).rejects.toThrow("disk full")
  })

  it("refuses a newer stream version", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const lines = text.split("\n")
    lines[0] = lines[0].replace('"streamVersion":1', '"streamVersion":9')
    await rejects(new Blob([lines.join("\n")]), /newer version/)
  })
})

describe("an old single-JSON backup", () => {
  it("still imports, as one part", async () => {
    const file = exportBackup(
      {
        decks: [deck("t1")],
        notes: [note("n1")],
        cards: [card("n1")],
        revlog: [log("r1")],
      },
      7
    )
    const blob = new Blob([serializeBackup(file)], { type: "application/json" })
    const got: BackupFile[] = []
    const info = await readBackupFile(blob, (p) => {
      got.push(p)
    })
    expect(info.kind).toBe("single")
    expect(info.parts).toBe(1)
    expect(info.rows.notes).toBe(1)
    expect(got).toEqual([file])
  })

  it("reports a file that is not a backup", async () => {
    await expect(readBackupFile(new Blob(["not json"]))).rejects.toThrow(
      "not valid JSON"
    )
    await expect(readBackupFile(new Blob(['{"a":1}']))).rejects.toThrow(
      "not a Glyph backup"
    )
  })
})

describe("backupFileName", () => {
  it("uses the local date and the extension for the format", () => {
    const at = new Date(2026, 0, 5, 23, 59).getTime()
    expect(backupFileName(at, true)).toBe("glyph-backup-2026-01-05.glyph")
    expect(backupFileName(at, false)).toBe("glyph-backup-2026-01-05.jsonl")
  })
})

describe("a file with some invalid rows", () => {
  /** Notes part with one bad row, written as a valid file (right checksum). */
  async function withBadNote(): Promise<Blob> {
    const parts = sampleParts()
    const bad = JSON.parse(serializeBackup(parts[1])) as {
      notes: Record<string, unknown>[]
    }
    bad.notes[1].options = "nope"
    const text = await textOf(await blobOf(parts, false))
    const lines = text.split("\n")
    // Rebuild the footer so only the row is wrong, not the file.
    lines[2] = JSON.stringify(bad)
    const crc = new Crc32()
    const enc = new TextEncoder()
    for (const line of lines.slice(0, lines.length - 2)) {
      crc.update(enc.encode(line)).update(new Uint8Array([10]))
    }
    const footer = JSON.parse(lines[lines.length - 2]) as { crc: string }
    footer.crc = crc.hex()
    lines[lines.length - 2] = JSON.stringify(footer)
    return new Blob([lines.join("\n")])
  }

  it("is refused by default, as a bad-rows error", async () => {
    await expect(readBackupFile(await withBadNote())).rejects.toBeInstanceOf(
      BackupRowsError
    )
  })

  it("is read without the bad rows when lenient, and says what it left out", async () => {
    const got: BackupFile[] = []
    const info = await readBackupFile(
      await withBadNote(),
      (p) => {
        got.push(p)
      },
      { lenient: true }
    )
    expect(info.skipped.notes).toBe(1)
    expect(info.rows.notes).toBe(4)
    expect(info.skippedExamples).toEqual(["notes[1] in part 2"])
    expect(got.flatMap((p) => p.notes).map((n) => n.id)).toEqual([
      "n1",
      "n3",
      "n4",
      "n5",
    ])
  })

  it("still refuses a damaged checksum when lenient", async () => {
    const text = await textOf(await blobOf(sampleParts(), false))
    const flipped = text.replace(
      '"contentUpdatedAt":100',
      '"contentUpdatedAt":101'
    )
    await expect(
      readBackupFile(new Blob([flipped]), undefined, { lenient: true })
    ).rejects.toThrow(/checksum/)
  })

  it("parses a single file leniently too", () => {
    const file = JSON.parse(
      serializeBackup(
        exportBackup(
          { decks: [], notes: [note("n1"), note("n2")], cards: [], revlog: [] },
          1
        )
      )
    ) as { notes: Record<string, unknown>[] }
    file.notes[0].correctIndex = 9
    const text = JSON.stringify(file)
    expect(parseBackup(text).ok).toBe(false)
    const lenient = parseBackupLenient(text)
    expect(lenient.ok).toBe(true)
    if (lenient.ok) {
      expect(lenient.backup.notes.map((n) => n.id)).toEqual(["n2"])
      expect(lenient.skipped).toEqual([{ table: "notes", index: 0 }])
    }
    expect(parseBackupLenient("nope").ok).toBe(false)
  })
})

describe("import snapshots", () => {
  it("knows which files to delete, copy by copy, and leaves strangers alone", () => {
    const names = [
      "snap-1700000000001.glyph",
      "snap-1700000000001.json",
      "snap-1700000000002.glyph",
      "snap-1700000000002.json",
      "snap-1700000000003.glyph",
      "snap-1700000000003.json",
      "snap-1700000000004.glyph",
      "snap-1700000000004.json",
      "notes.txt",
    ]
    expect(snapshotsToDelete(names, 3)).toEqual([
      "snap-1700000000001.glyph",
      "snap-1700000000001.json",
    ])
    expect(snapshotsToDelete(names, 5)).toEqual([])
    // The copy being restored is never deleted and does not take a slot.
    expect(snapshotsToDelete(names, 2, 1700000000001)).toEqual([
      "snap-1700000000002.glyph",
      "snap-1700000000002.json",
    ])
  })

  it("names and reads copies", () => {
    expect(snapshotFileName(1700000000000, true)).toBe(
      "snap-1700000000000.glyph"
    )
    expect(snapshotTime("snap-1700000000000.json")).toBe(1700000000000)
    expect(snapshotTime("other.json")).toBeNull()
    const meta = {
      at: 1700000000000,
      file: "snap-1700000000000.glyph",
      bytes: 10,
      reason: "x.glyph",
      notes: 1,
      reviews: 2,
      digests: null,
    }
    expect(parseSnapshotMeta(JSON.stringify(meta))).toEqual(meta)
    expect(parseSnapshotMeta("{}")).toBeNull()
    expect(parseSnapshotMeta("nope")).toBeNull()
  })
})

describe("PartBatcher", () => {
  const notesPart = (from: number, count: number): BackupFile =>
    part({
      notes: Array.from({ length: count }, (_, i) => note(`n${from + i}`)),
    })

  it("joins small parts and hands back a batch only when the next would overflow", () => {
    const batcher = new PartBatcher(10)
    expect(batcher.add(notesPart(0, 4))).toBeNull()
    expect(batcher.add(notesPart(4, 4))).toBeNull()
    const full = batcher.add(notesPart(8, 4))
    expect(full?.notes.map((n) => n.id)).toEqual([
      "n0",
      "n1",
      "n2",
      "n3",
      "n4",
      "n5",
      "n6",
      "n7",
    ])
    expect(batcher.flush()?.notes.map((n) => n.id)).toEqual([
      "n8",
      "n9",
      "n10",
      "n11",
    ])
    expect(batcher.flush()).toBeNull()
  })

  it("never drops or reorders a row, whatever the sizes", () => {
    const batcher = new PartBatcher(7)
    const seen: string[] = []
    let next = 0
    for (const size of [3, 9, 1, 1, 12, 2, 5, 5, 5]) {
      const full = batcher.add(notesPart(next, size))
      next += size
      if (full) seen.push(...full.notes.map((n) => n.id))
    }
    seen.push(...(batcher.flush()?.notes.map((n) => n.id) ?? []))
    expect(seen).toEqual(Array.from({ length: next }, (_, i) => `n${i}`))
  })

  it("keeps an oversized part whole, and a picture weighs a lot", () => {
    const batcher = new PartBatcher(100)
    expect(batcher.add(notesPart(0, 500))).toBeNull()
    expect(batcher.flush()?.notes).toHaveLength(500)
    const image = {
      id: "a".repeat(32),
      mime: "image/webp" as const,
      width: 1,
      height: 1,
      data: "AAAA",
    }
    expect(batcher.add(part({ images: [image] }))).toBeNull()
    expect(batcher.add(notesPart(0, 1))?.images).toHaveLength(1)
  })
})
