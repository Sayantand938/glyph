import type { BackupFile, BackupImage, RevlogRow, SettingRow } from "@/db/types"
import { readSettingRow } from "@/lib/settings"

import {
  isNum,
  isRec,
  readCard,
  readDeck,
  readImage,
  readLog,
  readNote,
} from "./read-rows"
import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  type ParseBackupResult,
} from "./types"

/** A row left out of a lenient parse, by table and position in the file's list. */
export interface SkippedRow {
  table: string
  index: number
}

function readTable<T>(
  name: string,
  value: unknown,
  read: (row: unknown) => T | null,
  skipped: SkippedRow[] | null
): { ok: true; rows: T[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `The backup is missing its "${name}" list.` }
  }
  const rows: T[] = []
  for (let i = 0; i < value.length; i++) {
    const row = read(value[i])
    if (row === null) {
      if (skipped) {
        skipped.push({ table: name, index: i })
        continue
      }
      return {
        ok: false,
        error: `The backup is damaged: ${name}[${i}] is not a valid row.`,
      }
    }
    rows.push(row)
  }
  return { ok: true, rows }
}

/** Parses and validates backup file text. Never throws. */
export function parseBackup(text: string): ParseBackupResult {
  const result = parseWith(text, null)
  return result.ok ? { ok: true, backup: result.backup } : result
}

/**
 * Like `parseBackup`, but a row that is not valid is left out and listed in
 * `skipped` instead of rejecting the whole file. A file that is not a backup, a
 * missing table or a newer version are still errors.
 */
export function parseBackupLenient(
  text: string
):
  | { ok: true; backup: BackupFile; skipped: SkippedRow[] }
  | { ok: false; error: string } {
  const skipped: SkippedRow[] = []
  const result = parseWith(text, skipped)
  return result.ok ? { ok: true, backup: result.backup, skipped } : result
}

function parseWith(
  text: string,
  skipped: SkippedRow[] | null
): ParseBackupResult {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return { ok: false, error: "This file is not valid JSON." }
  }
  if (!isRec(data) || data.app !== BACKUP_APP) {
    return { ok: false, error: "This is not a Glyph backup file." }
  }

  const version = data.schemaVersion
  if (!isNum(version) || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "The backup has no valid schema version." }
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        "This backup was made by a newer version of Glyph. Update the app and try again.",
    }
  }
  if (!isNum(data.exportedAt)) {
    return { ok: false, error: "The backup has no valid export time." }
  }

  const decks = readTable("decks", data.decks, readDeck, skipped)
  if (!decks.ok) return decks
  const notes = readTable("notes", data.notes, readNote, skipped)
  if (!notes.ok) return notes
  const cards = readTable("cards", data.cards, readCard, skipped)
  if (!cards.ok) return cards
  // Review rows before schema 5 lack the fields analytics needs (right/wrong,
  // time to pick, state after), so they are not imported; the questions and the
  // cards' progress still are. A file from 5 on must have complete rows.
  const revlog =
    version < 5
      ? { ok: true as const, rows: [] as RevlogRow[] }
      : readTable("revlog", data.revlog, readLog, skipped)
  if (!revlog.ok) return revlog
  // Absent in version 1 files; when present it must be valid.
  const images =
    data.images === undefined
      ? { ok: true as const, rows: [] as BackupImage[] }
      : readTable("images", data.images, readImage, skipped)
  if (!images.ok) return images
  // Absent before version 6; when present every row must be valid.
  const settings =
    data.settings === undefined
      ? { ok: true as const, rows: [] as SettingRow[] }
      : readTable("settings", data.settings, readSettingRow, skipped)
  if (!settings.ok) return settings

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      schemaVersion: version,
      exportedAt: data.exportedAt,
      decks: decks.rows,
      notes: notes.rows,
      cards: cards.rows,
      revlog: revlog.rows,
      images: images.rows,
      settings: settings.rows,
    },
  }
}
