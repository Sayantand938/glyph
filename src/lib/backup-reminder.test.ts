import { describe, expect, it } from "vitest"

import {
  FIRST_BACKUP_MIN_CHANGES,
  REMIND_AFTER_CHANGES,
  REMIND_AFTER_DAYS,
  backupDue,
  describeBackupAge,
  parseLastBackup,
  preferShareSheet,
  trustedLastBackup,
} from "./backup"

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 5, 15, 12, 0).getTime()

describe("backupDue", () => {
  it("is never due when nothing changed", () => {
    expect(backupDue(null, 0, NOW)).toBe(false)
    expect(backupDue(NOW - 30 * DAY, 0, NOW)).toBe(false)
  })

  it("waits for a little data before the first backup", () => {
    expect(backupDue(null, FIRST_BACKUP_MIN_CHANGES - 1, NOW)).toBe(false)
    expect(backupDue(null, FIRST_BACKUP_MIN_CHANGES, NOW)).toBe(true)
  })

  it("is due a week after the last backup when anything changed", () => {
    const at = NOW - REMIND_AFTER_DAYS * DAY
    expect(backupDue(at + 60_000, 1, NOW)).toBe(false)
    expect(backupDue(at, 1, NOW)).toBe(true)
  })

  it("is due after a day of heavy use, not on the same day", () => {
    expect(backupDue(NOW - 2 * DAY, REMIND_AFTER_CHANGES - 1, NOW)).toBe(false)
    expect(backupDue(NOW - 2 * DAY, REMIND_AFTER_CHANGES, NOW)).toBe(true)
    expect(backupDue(NOW - 3_600_000, REMIND_AFTER_CHANGES * 5, NOW)).toBe(
      false
    )
  })

  it("treats a backup time in the future (clock set back) as never", () => {
    const future = NOW + 40 * DAY
    expect(trustedLastBackup(future, NOW)).toBeNull()
    expect(backupDue(future, FIRST_BACKUP_MIN_CHANGES, NOW)).toBe(true)
    expect(backupDue(future, 1, NOW)).toBe(false)
    // A few hours of drift is still believed.
    expect(trustedLastBackup(NOW + 3_600_000, NOW)).toBe(NOW + 3_600_000)
  })
})

describe("parseLastBackup", () => {
  it("accepts a positive number and nothing else", () => {
    expect(parseLastBackup("1700000000000")).toBe(1700000000000)
    expect(parseLastBackup(null)).toBeNull()
    expect(parseLastBackup("")).toBeNull()
    expect(parseLastBackup("abc")).toBeNull()
    expect(parseLastBackup("-5")).toBeNull()
    expect(parseLastBackup("0")).toBeNull()
  })
})

describe("describeBackupAge", () => {
  it("counts calendar days", () => {
    const lateLastNight = new Date(2026, 5, 14, 23, 59).getTime()
    expect(describeBackupAge(null, NOW)).toBe("never")
    expect(describeBackupAge(NOW - 3_600_000, NOW)).toBe("today")
    expect(describeBackupAge(lateLastNight, NOW)).toBe("yesterday")
    expect(describeBackupAge(NOW - 5 * DAY, NOW)).toBe("5 days ago")
    expect(describeBackupAge(NOW + 90 * DAY, NOW)).toBe("never")
  })
})

describe("preferShareSheet", () => {
  it("is only for iOS with file sharing", () => {
    expect(preferShareSheet({ ios: true, canShareFiles: true })).toBe(true)
    expect(preferShareSheet({ ios: true, canShareFiles: false })).toBe(false)
    expect(preferShareSheet({ ios: false, canShareFiles: true })).toBe(false)
  })
})
