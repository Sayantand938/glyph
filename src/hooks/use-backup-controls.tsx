import * as React from "react"

import { importBackup } from "@/db/repo"
import { readBackupSnapshot } from "@/db/queries"
import {
  MAX_BACKUP_BYTES,
  backupFilename,
  exportBackup,
  formatMergeSummary,
  parseBackup,
  serializeBackup,
} from "@/lib/backup"

export interface Notice {
  text: string
  tone: "info" | "error"
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Export / import of the JSON backup file. `input` is a hidden file input that
 * must be rendered once; `chooseFile` opens it. Results go to `onNotice`.
 */
export function useBackupControls(onNotice: (notice: Notice) => void) {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  // A ref, not state: two quick clicks must not both pass the guard.
  const working = React.useRef(false)

  const run = React.useCallback(
    async (task: () => Promise<Notice>) => {
      if (working.current) return
      working.current = true
      setBusy(true)
      try {
        onNotice(await task())
      } catch (error) {
        console.error("Backup failed", error)
        onNotice({
          text: error instanceof Error ? error.message : "The backup failed.",
          tone: "error",
        })
      } finally {
        working.current = false
        setBusy(false)
      }
    },
    [onNotice]
  )

  const exportFile = React.useCallback(
    () =>
      run(async () => {
        const now = Date.now()
        const { data, images } = await readBackupSnapshot()
        const file = exportBackup(data, now, images)
        const filename = backupFilename(now)
        download(filename, serializeBackup(file))
        const pics = images.length > 0 ? `, ${images.length} images` : ""
        return {
          text: `Exported ${file.notes.length} notes${pics} and ${file.revlog.length} reviews to ${filename}.`,
          tone: "info",
        }
      }),
    [run]
  )

  const importFile = React.useCallback(
    (file: File) =>
      run(async () => {
        if (file.size > MAX_BACKUP_BYTES) {
          return {
            text: "That file is too large to be a backup.",
            tone: "error",
          }
        }
        const parsed = parseBackup(await file.text())
        if (!parsed.ok) return { text: parsed.error, tone: "error" }
        const stats = await importBackup(parsed.backup)
        return { text: formatMergeSummary(stats), tone: "info" }
      }),
    [run]
  )

  const chooseFile = React.useCallback(() => fileInput.current?.click(), [])

  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".json,application/json"
      className="sr-only"
      tabIndex={-1}
      aria-label="Backup file"
      onChange={(e) => {
        const picked = e.target.files?.[0]
        // Reset so picking the same file again re-triggers onChange.
        e.target.value = ""
        if (picked) void importFile(picked)
      }}
    />
  )

  return { exportFile, chooseFile, input, busy }
}
