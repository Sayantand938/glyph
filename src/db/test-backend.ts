/**
 * An in-memory SQLite backend on `node:sqlite`, for tests only (the app itself
 * uses `tauri-backend.ts`). It runs the same SQL the Rust side does.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import type { SqlBackend, SqlParam, SqlRow } from "./sql"

function bind(params: readonly SqlParam[]): SQLInputValue[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
}

export function memoryBackend(): SqlBackend {
  const sqlite = new DatabaseSync(":memory:")
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
