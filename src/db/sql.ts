/**
 * The SQL layer. A `SqlBackend` runs statements on one SQLite connection (the
 * Tauri app's Rust side, or `node:sqlite` in tests). `Database` adds what the
 * rest of the app relies on: calls run one at a time, so `BEGIN` ... `COMMIT`
 * sent as separate calls stay on one connection with nothing in between, and a
 * committed write tells live queries which tables changed.
 *
 * Inside `transaction` only use the `tx` it hands you. Calling `db.select`
 * from there waits for the transaction to end, which is never.
 */
import { emitChange, tableWritten, type TableName } from "./live"

export type SqlParam = string | number | boolean | null
export type SqlRow = Record<string, unknown>

export interface SqlRunner {
  select(sql: string, params?: readonly SqlParam[]): Promise<SqlRow[]>
  /** Runs one statement; resolves to the number of rows it changed. */
  execute(sql: string, params?: readonly SqlParam[]): Promise<number>
  /** Runs one statement once per row of parameters. */
  executeMany(
    sql: string,
    rows: readonly (readonly SqlParam[])[]
  ): Promise<number>
}

export interface SqlBackend extends SqlRunner {
  /** Runs several statements without parameters (the schema). */
  script(sql: string): Promise<void>
}

/** Rows per `executeMany` call, to keep one message to the backend small. */
const MANY_CHUNK = 2000

export class Database implements SqlRunner {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly backend: SqlBackend) {}

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job)
    this.tail = run.catch(() => undefined)
    return run
  }

  private async many(
    sql: string,
    rows: readonly (readonly SqlParam[])[]
  ): Promise<number> {
    let changed = 0
    for (let i = 0; i < rows.length; i += MANY_CHUNK) {
      changed += await this.backend.executeMany(
        sql,
        rows.slice(i, i + MANY_CHUNK)
      )
    }
    return changed
  }

  select(sql: string, params: readonly SqlParam[] = []): Promise<SqlRow[]> {
    return this.enqueue(() => this.backend.select(sql, params))
  }

  async execute(
    sql: string,
    params: readonly SqlParam[] = []
  ): Promise<number> {
    return this.transaction((tx) => tx.execute(sql, params))
  }

  async executeMany(
    sql: string,
    rows: readonly (readonly SqlParam[])[]
  ): Promise<number> {
    return this.transaction((tx) => tx.executeMany(sql, rows))
  }

  /**
   * Runs `fn` in one SQL transaction: everything it writes is committed
   * together, or rolled back if it throws. Tables it wrote are announced to live
   * queries after the commit.
   */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const written = new Set<TableName>()
      const note = (sql: string) => {
        const table = tableWritten(sql)
        if (table) written.add(table)
      }
      const tx: SqlRunner = {
        select: (sql, params = []) => this.backend.select(sql, params),
        execute: (sql, params = []) => {
          note(sql)
          return this.backend.execute(sql, params)
        },
        executeMany: (sql, rows) => {
          note(sql)
          return this.many(sql, rows)
        },
      }
      await this.backend.execute("BEGIN IMMEDIATE", [])
      let value: T
      try {
        value = await fn(tx)
        await this.backend.execute("COMMIT", [])
      } catch (error) {
        try {
          await this.backend.execute("ROLLBACK", [])
        } catch {
          // The connection already ended the transaction.
        }
        throw error
      }
      emitChange(written)
      return value
    })
  }

  /** Applies the migrations the database has not seen yet. */
  migrate(migrations: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      const [row] = await this.backend.select("PRAGMA user_version", [])
      const current = Number(row?.user_version ?? 0)
      if (current > migrations.length) {
        throw new Error(
          `This database is from a newer version of Glyph (schema ${current}).`
        )
      }
      for (let version = current; version < migrations.length; version++) {
        try {
          await this.backend.script(
            `BEGIN;\n${migrations[version]}\nPRAGMA user_version = ${version + 1};\nCOMMIT;`
          )
        } catch (error) {
          try {
            await this.backend.execute("ROLLBACK", [])
          } catch {
            // Nothing was open.
          }
          throw error
        }
      }
    })
  }
}
