/**
 * When to remind about a backup (backups are made by hand).
 * Pure (no DB, no storage, no clock: the caller passes `now`).
 *
 * The browser's database is the only copy of the data, so a backup file is the
 * only protection against clearing site data, a lost phone or storage eviction.
 */

/** A backup this old is due as soon as anything has changed since. */
export const REMIND_AFTER_DAYS = 7
/** After this many reviews and edits a backup is due after a day. */
export const REMIND_AFTER_CHANGES = 500
/** With no backup yet, nothing is due until there is something worth keeping. */
export const FIRST_BACKUP_MIN_CHANGES = 10

const DAY_MS = 24 * 60 * 60 * 1000

/** A stored last-backup time, or null when missing or not a usable time. */
export function parseLastBackup(text: string | null): number | null {
  if (text === null) return null
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The last backup time to trust. One in the future (the clock was set back, or
 * the value is garbage) says nothing about what has been saved since, so it is
 * treated as "never" and the next backup fixes it.
 */
export function trustedLastBackup(
  lastAt: number | null,
  now: number
): number | null {
  if (lastAt === null || lastAt > now + DAY_MS) return null
  return lastAt
}

/**
 * Whether to ask for a backup. `changes` is the number of reviews and question
 * edits made since `lastAt` (everything when there was no backup).
 */
export function backupDue(
  lastAt: number | null,
  changes: number,
  now: number
): boolean {
  if (changes <= 0) return false
  const last = trustedLastBackup(lastAt, now)
  if (last === null) return changes >= FIRST_BACKUP_MIN_CHANGES
  const days = (now - last) / DAY_MS
  if (days >= REMIND_AFTER_DAYS) return true
  return days >= 1 && changes >= REMIND_AFTER_CHANGES
}

/** "never", "today", "yesterday" or "5 days ago" (calendar days, local time). */
export function describeBackupAge(lastAt: number | null, now: number): string {
  const last = trustedLastBackup(lastAt, now)
  if (last === null) return "never"
  const day = (t: number) => {
    const d = new Date(t)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }
  const days = Math.max(0, Math.round((day(now) - day(last)) / DAY_MS))
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

/**
 * Whether to hand the backup to the system share sheet instead of a download.
 * iPhone and iPad web apps added to the Home Screen often lose a Blob download,
 * while the share sheet can "Save to Files".
 */
export function preferShareSheet(env: {
  ios: boolean
  canShareFiles: boolean
}): boolean {
  return env.ios && env.canShareFiles
}
