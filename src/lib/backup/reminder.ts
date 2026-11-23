/**
 * When to remind about a backup, and the names of automatic backup files.
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
/** How many automatic backup files are kept in the chosen folder. */
export const KEEP_AUTO_BACKUPS = 7

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

/**
 * Whether the automatic backup should run: something changed and the last
 * backup (of any kind) was on an earlier local day, or there is none.
 */
export function autoBackupDue(
  lastAt: number | null,
  changes: number,
  now: number
): boolean {
  if (changes <= 0) return false
  const last = trustedLastBackup(lastAt, now)
  if (last === null) return true
  return describeBackupAge(last, now) !== "today"
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

const AUTO_NAME = /^glyph-auto-(\d{4})-(\d{2})-(\d{2})\.(glyph|jsonl)$/

/** "glyph-auto-YYYY-MM-DD.glyph": one file a day, overwritten within the day. */
export function autoBackupName(now: number, compressed: boolean): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, "0")
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `glyph-auto-${day}.${compressed ? "glyph" : "jsonl"}`
}

/**
 * Of the file names in the backup folder, the old automatic backups to delete
 * so that `keep` remain (the newest by date). Files that are not ours are never
 * listed, so nothing else in the folder can be deleted.
 */
export function autoBackupsToDelete(
  names: readonly string[],
  keep = KEEP_AUTO_BACKUPS
): string[] {
  const ours = names
    .filter((name) => AUTO_NAME.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  return ours.slice(Math.max(0, keep))
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
