/**
 * The backup file as a stream, so a big database neither has to fit in one
 * string to be saved nor in one `JSON.parse` to be restored.
 *
 * Layout (text, one JSON value per line, usually gzipped; the extension is
 * `.glyph`):
 *
 *   {"format":"glyph-stream","streamVersion":1,"app":"mcq-srs","schemaVersion":6,"exportedAt":...}
 *   <a complete backup (`BackupFile`) holding some rows>      (any number of lines)
 *   {"end":true,"parts":N,"rows":{decks,notes,cards,revlog,images,settings},"crc":"..."}
 *
 * Every part line is an ordinary backup, so it goes through `parseBackup` and
 * merges with `importBackup` exactly like a whole file or a sync part. The
 * footer is the proof the file is whole: how many parts and rows were written
 * and the CRC-32 of every byte before it. A file without a footer was cut short;
 * a changed byte, a lost part or a swapped row fails the checksum or the counts.
 *
 * An old single-JSON backup (what Glyph saved before) is still read: it is
 * detected by its first bytes and read whole, as before.
 *
 * Pure: web streams and text only, no DB and no React.
 */
import type { BackupFile } from "@/db/types"

import { Crc32 } from "./crc32"
import { parseBackup, parseBackupLenient, type SkippedRow } from "./parse"
import { BACKUP_APP, BACKUP_SCHEMA_VERSION } from "./types"

export const STREAM_FORMAT = "glyph-stream"
const STREAM_VERSION = 1
const HEADER_PREFIX = `{"format":"${STREAM_FORMAT}"`
const FOOTER_PREFIX = '{"end":true'
const NEWLINE = new Uint8Array([10])

const TABLES = [
  "decks",
  "notes",
  "cards",
  "revlog",
  "images",
  "settings",
] as const
export type BackupCounts = Record<(typeof TABLES)[number], number>

export function emptyCounts(): BackupCounts {
  return { decks: 0, notes: 0, cards: 0, revlog: 0, images: 0, settings: 0 }
}

function addCounts(counts: BackupCounts, part: BackupFile): void {
  for (const table of TABLES) counts[table] += part[table].length
}

/** A file that cannot be used; the message is meant for the person. */
export class BackupFileError extends Error {}

/**
 * The file is a backup and is whole, but some rows in it are not valid. A
 * lenient read (`lenient: true`) leaves those rows out and reports them.
 */
export class BackupRowsError extends BackupFileError {}

/** Whether this browser can gzip (all current ones can). */
export const canCompress = (): boolean =>
  typeof CompressionStream !== "undefined"

/**
 * The bytes of a backup file for these parts (see `readBackupParts`), produced
 * as they are asked for: no more than one part is ever held. With `compress`
 * the stream is gzipped.
 */
export function backupFileStream(
  parts: AsyncIterable<BackupFile>,
  now: number,
  options: { compress?: boolean } = {}
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder()
  const iterator = parts[Symbol.asyncIterator]()
  const crc = new Crc32()
  const counts = emptyCounts()
  let written = 0
  let stage: "header" | "parts" | "done" = "header"

  const raw = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      if (stage === "header") {
        const header = {
          format: STREAM_FORMAT,
          streamVersion: STREAM_VERSION,
          app: BACKUP_APP,
          schemaVersion: BACKUP_SCHEMA_VERSION,
          exportedAt: now,
        }
        const bytes = encoder.encode(`${JSON.stringify(header)}\n`)
        crc.update(bytes)
        controller.enqueue(bytes)
        stage = "parts"
        return
      }
      if (stage === "parts") {
        const next = await iterator.next()
        if (!next.done) {
          const bytes = encoder.encode(`${JSON.stringify(next.value)}\n`)
          crc.update(bytes)
          addCounts(counts, next.value)
          written += 1
          controller.enqueue(bytes)
          return
        }
        const footer = {
          end: true,
          parts: written,
          rows: counts,
          crc: crc.hex(),
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(footer)}\n`))
        controller.close()
        stage = "done"
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })

  return options.compress && canCompress()
    ? raw.pipeThrough(new CompressionStream("gzip"))
    : raw
}

/** The file for these parts as a Blob (the browser may keep it off the heap). */
export async function backupFileBlob(
  parts: AsyncIterable<BackupFile>,
  now: number,
  options: { compress?: boolean } = {}
): Promise<Blob> {
  const compressed = options.compress === true && canCompress()
  const blob = await new Response(
    backupFileStream(parts, now, { compress: compressed })
  ).blob()
  return new Blob([blob], {
    type: compressed ? "application/gzip" : "application/x-ndjson",
  })
}

/** "glyph-backup-YYYY-MM-DD.glyph" (or `.jsonl` when not compressed). */
export function backupFileName(now: number, compressed: boolean): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, "0")
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `glyph-backup-${day}.${compressed ? "glyph" : "jsonl"}`
}

interface Line {
  bytes: Uint8Array
  /** False for a last line with no newline after it: the file ends mid-line. */
  terminated: boolean
}

/** The lines of a byte stream, found without decoding it first. */
async function* linesOf(
  source: ReadableStream<Uint8Array>
): AsyncGenerator<Line> {
  const reader = source.getReader()
  let pending: Uint8Array[] = []
  const join = (tail: Uint8Array): Uint8Array => {
    if (pending.length === 0) return tail
    const size = pending.reduce((n, p) => n + p.length, tail.length)
    const out = new Uint8Array(size)
    let at = 0
    for (const piece of pending) {
      out.set(piece, at)
      at += piece.length
    }
    out.set(tail, at)
    pending = []
    return out
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      let from = 0
      for (;;) {
        const at = value.indexOf(10, from)
        if (at < 0) break
        yield { bytes: join(value.subarray(from, at)), terminated: true }
        from = at + 1
      }
      if (from < value.length) pending.push(value.slice(from))
    }
    const rest = join(new Uint8Array(0))
    if (rest.length > 0) yield { bytes: rest, terminated: false }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export interface ReadOptions {
  /** Leave invalid rows out (and count them) instead of refusing the file. */
  lenient?: boolean
}

export interface BackupFileInfo {
  /** `stream` is this format; `single` an old one-JSON-value file. */
  kind: "stream" | "single"
  compressed: boolean
  exportedAt: number
  parts: number
  /** Rows read and valid. */
  rows: BackupCounts
  /** Rows left out because they were not valid (only with `lenient`). */
  skipped: BackupCounts
  /** A few of them, like "notes[3] in part 2", for the report. */
  skippedExamples: string[]
}

type PartHandler = (part: BackupFile) => Promise<void> | void

const CUT_SHORT = "This backup file is cut short, so it was not imported."
const DAMAGED = "This backup file is damaged, so it was not imported."

function parseFooter(text: string): {
  parts: number
  rows: BackupCounts
  crc: string
} {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupFileError(DAMAGED)
  }
  const rec = data as Record<string, unknown> | null
  const rows = rec?.rows as Record<string, unknown> | undefined
  const counts = emptyCounts()
  const valid =
    typeof rec === "object" &&
    rec !== null &&
    typeof rec.parts === "number" &&
    typeof rec.crc === "string" &&
    typeof rows === "object" &&
    rows !== null &&
    TABLES.every((table) => {
      const n = rows[table]
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return false
      counts[table] = n
      return true
    })
  if (!valid) throw new BackupFileError(DAMAGED)
  return { parts: rec.parts as number, rows: counts, crc: rec.crc as string }
}

function parsePart(
  text: string,
  lenient: boolean
):
  | { ok: true; backup: BackupFile; skipped: SkippedRow[] }
  | { ok: false; error: string } {
  if (lenient) return parseBackupLenient(text)
  const parsed = parseBackup(text)
  return parsed.ok ? { ok: true, backup: parsed.backup, skipped: [] } : parsed
}

/** The error for a part that did not parse: bad rows are their own kind. */
function failedParse(message: string): BackupFileError {
  return /is not a valid row.$/.test(message)
    ? new BackupRowsError(message)
    : new BackupFileError(message)
}

function noteSkipped(
  counts: BackupCounts,
  examples: string[],
  skipped: SkippedRow[],
  part: number
): void {
  for (const row of skipped) {
    counts[row.table as keyof BackupCounts] += 1
    if (examples.length < 5) {
      examples.push(`${row.table}[${row.index}] in part ${part}`)
    }
  }
}

async function readStream(
  source: ReadableStream<Uint8Array>,
  compressed: boolean,
  onPart: PartHandler | undefined,
  failed: { value: boolean },
  lenient: boolean
): Promise<BackupFileInfo> {
  const decoder = new TextDecoder()
  const crc = new Crc32()
  const rows = emptyCounts()
  const skipped = emptyCounts()
  const examples: string[] = []
  let parts = 0
  let exportedAt: number | null = null
  let footer: ReturnType<typeof parseFooter> | null = null

  for await (const line of linesOf(source)) {
    if (!line.terminated) throw new BackupFileError(CUT_SHORT)
    if (footer) {
      throw new BackupFileError(
        "This backup file has extra data after its end marker, so it was not imported."
      )
    }
    const text = decoder.decode(line.bytes)

    if (exportedAt === null) {
      let header: unknown
      try {
        header = JSON.parse(text)
      } catch {
        throw new BackupFileError(DAMAGED)
      }
      const h = header as Record<string, unknown> | null
      if (
        typeof h !== "object" ||
        h === null ||
        h.format !== STREAM_FORMAT ||
        h.app !== BACKUP_APP ||
        typeof h.exportedAt !== "number"
      ) {
        throw new BackupFileError("This is not a Glyph backup file.")
      }
      if (
        typeof h.streamVersion !== "number" ||
        h.streamVersion > STREAM_VERSION
      ) {
        throw new BackupFileError(
          "This backup was made by a newer version of Glyph. Update the app and try again."
        )
      }
      exportedAt = h.exportedAt
      crc.update(line.bytes).update(NEWLINE)
      continue
    }

    if (text.startsWith(FOOTER_PREFIX)) {
      footer = parseFooter(text)
      continue
    }

    crc.update(line.bytes).update(NEWLINE)
    const parsed = parsePart(text, lenient)
    if (!parsed.ok) throw failedParse(parsed.error)
    parts += 1
    addCounts(rows, parsed.backup)
    noteSkipped(skipped, examples, parsed.skipped, parts)
    if (onPart) {
      failed.value = true
      await onPart(parsed.backup)
      failed.value = false
    }
  }

  if (exportedAt === null || footer === null)
    throw new BackupFileError(CUT_SHORT)
  if (footer.crc !== crc.hex()) {
    throw new BackupFileError(
      "This backup file does not match its checksum: it was changed or damaged, so it was not imported."
    )
  }
  if (
    footer.parts !== parts ||
    TABLES.some((table) => footer.rows[table] !== rows[table] + skipped[table])
  ) {
    throw new BackupFileError(
      "This backup file does not hold the rows it says it should, so it was not imported."
    )
  }
  return {
    kind: "stream",
    compressed,
    exportedAt,
    parts,
    rows,
    skipped,
    skippedExamples: examples,
  }
}

/**
 * Reads a backup file (this stream format, gzipped or not, or an old
 * single-JSON one), handing each part to `onPart` as it is read, and checks the
 * footer at the end. Throws `BackupFileError` with a message for the person for
 * anything wrong with the file; an error from `onPart` itself is passed on
 * unchanged. Without `onPart` it only checks the file, which is how an import
 * proves the whole file is good before it writes anything.
 */
export async function readBackupFile(
  file: Blob,
  onPart?: PartHandler,
  options: ReadOptions = {}
): Promise<BackupFileInfo> {
  const lenient = options.lenient === true
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const compressed = head[0] === 0x1f && head[1] === 0x8b
  const start = new TextDecoder().decode(head).replace(/^\ufeff/, "")

  if (!compressed && !start.startsWith(HEADER_PREFIX)) {
    // An old backup: one JSON value, read whole as before.
    const text = await file.text()
    const parsed = parsePart(text, lenient)
    if (!parsed.ok) throw failedParse(parsed.error)
    const rows = emptyCounts()
    addCounts(rows, parsed.backup)
    const skipped = emptyCounts()
    const examples: string[] = []
    noteSkipped(skipped, examples, parsed.skipped, 1)
    if (onPart) await onPart(parsed.backup)
    return {
      kind: "single",
      compressed: false,
      exportedAt: parsed.backup.exportedAt,
      parts: 1,
      rows,
      skipped,
      skippedExamples: examples,
    }
  }

  let source = file.stream()
  if (compressed) {
    if (typeof DecompressionStream === "undefined") {
      throw new BackupFileError(
        "This browser cannot open a compressed backup. Use a current Chrome, Edge, Firefox or Safari."
      )
    }
    source = source.pipeThrough(new DecompressionStream("gzip"))
  }
  const failed = { value: false }
  try {
    return await readStream(source, compressed, onPart, failed, lenient)
  } catch (error) {
    if (error instanceof BackupFileError || failed.value) throw error
    // The gzip layer (or the disk) gave up part-way: a cut-short or damaged file.
    throw new BackupFileError(
      compressed
        ? "This backup file is damaged or cut short and cannot be unpacked, so it was not imported."
        : DAMAGED
    )
  }
}
