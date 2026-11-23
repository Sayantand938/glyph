import * as React from "react"

import { countChangesSince } from "@/db/queries"
import {
  backupDue,
  describeBackupAge,
  parseLastBackup,
  trustedLastBackup,
} from "@/lib/backup"

const KEY = "glyph.lastBackupAt"
const EVENT = "glyph:backup-recorded"

/** When a backup file was last made on this device (null: never, or unknown). */
export function readLastBackup(): number | null {
  try {
    return parseLastBackup(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

/** Notes that a backup was just made (by hand). */
export function recordBackup(at: number): void {
  try {
    localStorage.setItem(KEY, String(at))
  } catch {
    // No storage: the reminder simply keeps asking.
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export interface BackupStatus {
  /** Last backup made on this device, or null. */
  lastAt: number | null
  /** "never", "today", "3 days ago". */
  age: string
  /** Reviews and edits since then; null while it is being counted. */
  changes: number | null
  due: boolean
}

/**
 * The backup status for the settings page and the reminder: the last backup
 * time (per device, in localStorage) and how much work it does not contain.
 * `refresh` is any value that changes when the data may have changed.
 */
export function useBackupStatus(refresh: unknown = 0): BackupStatus {
  const stored = React.useSyncExternalStore(
    subscribe,
    readLastBackup,
    () => null
  )
  const [opened] = React.useState(() => Date.now())
  const [counted, setCounted] = React.useState<{
    since: number | null
    changes: number
    now: number
  } | null>(null)

  React.useEffect(() => {
    let alive = true
    const now = Date.now()
    const since = trustedLastBackup(stored, now)
    countChangesSince(since)
      .then((changes) => {
        if (alive) setCounted({ since, changes, now })
      })
      .catch(() => {
        if (alive) setCounted(null)
      })
    return () => {
      alive = false
    }
  }, [stored, refresh])

  // Counted for this very last-backup time, or still counting.
  const fresh =
    counted !== null && counted.since === trustedLastBackup(stored, counted.now)
  const now = fresh ? counted.now : opened
  const changes = fresh ? counted.changes : null
  return {
    lastAt: stored,
    age: describeBackupAge(stored, now),
    changes,
    due: changes !== null && backupDue(stored, changes, now),
  }
}
