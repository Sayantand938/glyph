/**
 * Opens Glyph's SQLite file for the MCP server.
 *
 * The desktop app talks to the same file through its Rust bridge. Here the
 * bridge is `node:sqlite`, which is also what the app's own tests use, so the
 * SQL, migrations and repo layer are the real ones (no second copy of the
 * schema). The app may have the file open at the same time; a busy timeout
 * makes a short overlap wait instead of failing.
 */
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import { openDatabase } from "@/db/database"
import type { SqlBackend, SqlParam, SqlRow } from "@/db/sql"

function bind(params: readonly SqlParam[]): SQLInputValue[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
}

/** The app's data folder, by platform (Tauri uses the bundle identifier). */
export function defaultDbPath(): string {
  const id = "app.glyph.desktop"
  if (process.platform === "win32") {
    const appData = process.env.APPDATA
    if (appData) return join(appData, id, "glyph.db")
    return join(homedir(), "AppData", "Roaming", id, "glyph.db")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", id, "glyph.db")
  }
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(data, id, "glyph.db")
}

function fileBackend(path: string): SqlBackend {
  const sqlite = new DatabaseSync(path)
  // WAL lets the app read while the MCP server writes, and survives a crash.
  sqlite.exec("PRAGMA journal_mode = WAL")
  sqlite.exec("PRAGMA busy_timeout = 5000")
  sqlite.exec("PRAGMA foreign_keys = ON")
  return {
    select: async (sql, params = []) =>
      sqlite.prepare(sql).all(...bind(params)) as SqlRow[],
    execute: async (sql, params = []) =>
      Number(sqlite.prepare(sql).run(...bind(params)).changes),
    executeMany: async (sql, rows) => {
      const stmt = sqlite.prepare(sql)
      let changed = 0
      for (const row of rows) changed += Number(stmt.run(...bind(row)).changes)
      return changed
    },
    script: async (sql) => {
      sqlite.exec(sql)
    },
  }
}

export interface OpenedDb {
  path: string
}

/**
 * Opens (and migrates, and seeds when empty, exactly like the app) the Glyph
 * database at `path`. Returns after the schema and seed are in place.
 */
export async function openGlyphDb(path: string): Promise<OpenedDb> {
  mkdirSync(dirname(path), { recursive: true })
  await openDatabase(fileBackend(path))
  return { path }
}

/** `--db <path>`, `-d <path>`, or `GLYPH_DB`; otherwise the app's own file. */
export function dbPathFromArgs(argv: readonly string[]): string {
  const index = argv.findIndex((arg) => arg === "--db" || arg === "-d")
  if (index !== -1 && argv[index + 1]) return argv[index + 1]
  const inline = argv.find((arg) => arg.startsWith("--db="))
  if (inline) return inline.slice("--db=".length)
  return process.env.GLYPH_DB || defaultDbPath()
}
