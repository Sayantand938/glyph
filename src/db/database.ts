import { MIGRATIONS } from "./schema"
import { seedIfEmpty } from "./seed"
import { Database, type SqlBackend } from "./sql"
import { tauriBackend } from "./tauri-backend"

let current: Database | null = null

function open(): Database {
  if (!current) throw new Error("The database is not open yet.")
  return current
}

/**
 * The open database. Calls go to whichever backend `openDatabase` set up, so
 * modules can import this once and tests can swap the backend underneath.
 */
export const db: Pick<
  Database,
  "select" | "execute" | "executeMany" | "transaction"
> = {
  select: (sql, params) => open().select(sql, params),
  execute: (sql, params) => open().execute(sql, params),
  executeMany: (sql, rows) => open().executeMany(sql, rows),
  transaction: (fn) => open().transaction(fn),
}

/** Opens `backend`, brings its schema up to date and seeds an empty database. */
export async function openDatabase(backend: SqlBackend): Promise<void> {
  const database = new Database(backend)
  await database.migrate(MIGRATIONS)
  current = database
  await database.transaction((tx) => seedIfEmpty(tx))
}

let ready: Promise<void> | null = null

/**
 * Startup: open the app's SQLite file and seed it when empty. Idempotent; every
 * caller shares one promise. A failure is not cached so a later call can retry.
 */
export function initDatabase(): Promise<void> {
  if (ready) return ready
  ready = openDatabase(tauriBackend).catch((error: unknown) => {
    ready = null
    throw error
  })
  return ready
}
