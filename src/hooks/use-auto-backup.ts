import * as React from "react"

import {
  askFolderPermission,
  chooseBackupFolder,
  folderBackupSupported,
  folderPermission,
  forgetBackupFolder,
  loadBackupFolder,
  writeAutoBackup,
  type FolderHandle,
} from "@/db/backup-folder"
import { countChangesSince } from "@/db/queries"
import { autoBackupDue, trustedLastBackup } from "@/lib/backup"

import { readLastBackup, recordBackup } from "./use-backup-status"

const CHECK_MS = 10 * 60 * 1000

export interface AutoBackup {
  /** This browser can write to a folder (Chrome or Edge on a computer). */
  supported: boolean
  /** Name of the chosen folder, or null when automatic backup is off. */
  folder: string | null
  /** The folder is chosen but the browser wants a click before writing again. */
  needsPermission: boolean
  running: boolean
  /** The latest automatic backup: its file name and when, or the error. */
  last: { name: string; at: number } | null
  error: string | null
  choose: () => Promise<void>
  /** Allows writing again (call from a click). */
  allow: () => Promise<void>
  turnOff: () => Promise<void>
}

function describe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The automatic backup failed."
}

/**
 * Automatic backup to a folder the person picked once: after something has
 * changed, at most once a local day, never while `paused` (studying or a sync),
 * keeping the seven newest files. The browser may ask for permission again
 * after a restart; that needs a click (`allow`), so it is shown, not forced.
 */
export function useAutoBackup(paused: boolean): AutoBackup {
  const supported = React.useMemo(() => folderBackupSupported(), [])
  const [handle, setHandle] = React.useState<FolderHandle | null>(null)
  const [needsPermission, setNeedsPermission] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [last, setLast] = React.useState<AutoBackup["last"]>(null)
  const [error, setError] = React.useState<string | null>(null)
  const busy = React.useRef(false)

  React.useEffect(() => {
    if (!supported) return
    let alive = true
    void loadBackupFolder().then((found) => {
      if (alive) setHandle(found)
    })
    return () => {
      alive = false
    }
  }, [supported])

  const backUp = React.useCallback(
    async (folder: FolderHandle, force: boolean) => {
      if (busy.current) return
      busy.current = true
      setRunning(true)
      try {
        const now = Date.now()
        const lastAt = readLastBackup()
        const changes = await countChangesSince(trustedLastBackup(lastAt, now))
        if (!force && !autoBackupDue(lastAt, changes, now)) return
        const written = await writeAutoBackup(folder, now)
        recordBackup(now)
        setLast({ name: written.name, at: now })
        setError(null)
      } catch (failure) {
        setError(describe(failure))
      } finally {
        busy.current = false
        setRunning(false)
      }
    },
    []
  )

  const check = React.useCallback(async () => {
    if (!handle || paused || busy.current) return
    if ((await folderPermission(handle)) !== "granted") {
      setNeedsPermission(true)
      return
    }
    setNeedsPermission(false)
    await backUp(handle, false)
  }, [handle, paused, backUp])

  React.useEffect(() => {
    if (!handle || paused) return
    // Soon, not inside the effect itself (it sets state once it has looked).
    const first = setTimeout(() => void check(), 0)
    const timer = setInterval(() => void check(), CHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [handle, paused, check])

  const choose = React.useCallback(async () => {
    try {
      const picked = await chooseBackupFolder()
      if (!picked) return
      setHandle(picked)
      setNeedsPermission(false)
      setError(null)
      // The first copy is made at once, so the folder is known to work.
      await backUp(picked, true)
    } catch (failure) {
      setError(describe(failure))
    }
  }, [backUp])

  const allow = React.useCallback(async () => {
    if (!handle) return
    if (await askFolderPermission(handle)) {
      setNeedsPermission(false)
      await backUp(handle, false)
    }
  }, [handle, backUp])

  const turnOff = React.useCallback(async () => {
    await forgetBackupFolder()
    setHandle(null)
    setNeedsPermission(false)
    setLast(null)
    setError(null)
  }, [])

  return {
    supported,
    folder: handle?.name ?? null,
    needsPermission,
    running,
    last,
    error,
    choose,
    allow,
    turnOff,
  }
}
