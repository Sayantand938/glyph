/**
 * Change notifications for live queries. Every committed write says which
 * tables it touched; a live query subscribes to the tables it reads and runs
 * again when one of them changes. No DB or React imports.
 */
export type TableName =
  "decks" | "notes" | "cards" | "revlog" | "images" | "settings"

type Listener = (changed: ReadonlySet<TableName>) => void

const listeners = new Set<Listener>()

export function subscribeTables(
  tables: readonly TableName[],
  onChange: () => void
): () => void {
  const watched = new Set<TableName>(tables)
  const listener: Listener = (changed) => {
    for (const table of changed) {
      if (watched.has(table)) {
        onChange()
        return
      }
    }
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitChange(changed: ReadonlySet<TableName>): void {
  if (changed.size === 0) return
  for (const listener of [...listeners]) listener(changed)
}

const WRITE =
  /^\s*(?:insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update|delete\s+from)\s+"?(\w+)"?/i

/** The table a write statement changes, as a live-query table name (or null). */
export function tableWritten(sql: string): TableName | null {
  const name = WRITE.exec(sql)?.[1]?.toLowerCase()
  if (name === undefined) return null
  if (name === "note_tags") return "notes"
  switch (name) {
    case "decks":
    case "notes":
    case "cards":
    case "revlog":
    case "images":
    case "settings":
      return name
    default:
      return null
  }
}
