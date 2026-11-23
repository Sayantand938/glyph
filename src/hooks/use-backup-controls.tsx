import * as React from "react"

import { makeBackupFile } from "@/db/backup-file"
import { previewBackup } from "@/db/backup-local"
import { importBackupFile } from "@/db/import-file"
import {
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
  snapshotsSupported,
} from "@/db/snapshots"
import type { BackupFile } from "@/db/types"
import {
  BackupRowsError,
  backupFileName,
  concatBackups,
  formatMergeSummary,
  formatSkipped,
  hasChanges,
  preferShareSheet,
  readBackupFile,
  type BackupFileInfo,
  type SnapshotMeta,
} from "@/lib/backup"

import { recordBackup } from "./use-backup-status"

export interface Notice {
  text: string
  tone: "info" | "error"
}

/** Files up to this many rows are previewed (what would change) before import. */
const PREVIEW_MAX_ROWS = 20_000

/** A step that waits for the person before an import goes on. */
export type ImportReview =
  /** What a small file would change; Import goes ahead, Cancel drops it. */
  | {
      kind: "preview"
      file: File
      summary: string
      skipped: string
      lenient: boolean
    }
  /** The file is whole but some rows are invalid; import the rest or cancel. */
  | { kind: "rows"; file: File; error: string }
  /** Putting a saved copy back, replacing everything on this device. */
  | { kind: "restore"; meta: SnapshotMeta }

function totalRows(info: BackupFileInfo): number {
  return Object.values(info.rows).reduce((a, b) => a + b, 0)
}

/** All the parts of a (small) file as one backup, so a preview sees it whole. */
async function readWhole(file: File, lenient: boolean): Promise<BackupFile> {
  let whole: BackupFile | null = null
  await readBackupFile(
    file,
    (part) => {
      whole = whole ? concatBackups(whole, part) : part
    },
    { lenient }
  )
  if (!whole) throw new Error("The backup file holds nothing to import.")
  return whole
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function onIos(): boolean {
  const nav = navigator
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  )
}

/**
 * Hands the file over: through the system share sheet on an iPhone or iPad
 * (where a download from a Home Screen app is unreliable), as a download
 * anywhere else. A share needs a fresh tap; if the browser says the tap is too
 * old after a long export, the file waits in `setWaiting` for one.
 */
async function deliver(
  filename: string,
  blob: Blob,
  setWaiting: (file: File | null) => void
): Promise<"downloaded" | "shared" | "cancelled" | "waiting"> {
  const file = new File([blob], filename, { type: blob.type })
  const canShareFiles =
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  if (preferShareSheet({ ios: onIos(), canShareFiles })) {
    try {
      await navigator.share({ files: [file], title: "Glyph backup" })
      return "shared"
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "AbortError") return "cancelled"
        if (error.name === "NotAllowedError") {
          setWaiting(file)
          return "waiting"
        }
      }
      // Anything else: fall back to a download.
    }
  }
  download(filename, blob)
  return "downloaded"
}

/**
 * Export / import of the backup file. `input` is a hidden file input that
 * must be rendered once; `chooseFile` opens it. Results go to `onNotice`.
 */
export function useBackupControls(onNotice: (notice: Notice) => void) {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [shareFile, setShareFile] = React.useState<File | null>(null)
  // A ref, not state: two quick clicks must not both pass the guard.
  const working = React.useRef(false)

  const run = React.useCallback(
    async (task: () => Promise<Notice | null>) => {
      if (working.current) return
      working.current = true
      setBusy(true)
      try {
        const notice = await task()
        if (notice) onNotice(notice)
      } catch (error) {
        console.error("Backup failed", error)
        onNotice({
          text:
            error instanceof RangeError
              ? "This device ran out of memory handling the backup."
              : error instanceof Error
                ? error.message
                : "The backup failed.",
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
        // Written part by part (never the whole database as one string), then
        // read back and checked before it is offered.
        const made = await makeBackupFile()
        const { rows } = made.info
        const filename = backupFileName(made.now, made.compressed)
        const how = await deliver(filename, made.blob, setShareFile)
        const pics = rows.images > 0 ? `, ${rows.images} images` : ""
        const what = `${rows.notes} notes${pics} and ${rows.revlog} reviews (checked, ${(made.blob.size / 1e6).toFixed(1)} MB)`
        if (how === "cancelled") {
          return { text: "Backup cancelled.", tone: "info" }
        }
        if (how === "waiting") {
          return {
            text: `Backup of ${what} is ready. Tap "Share backup file" to save it.`,
            tone: "info",
          }
        }
        recordBackup(made.now)
        return {
          text: `Exported ${what} ${how === "shared" ? "through the share sheet" : "to " + filename}.`,
          tone: "info",
        }
      }),
    [run]
  )

  /** Finishes a share that needed a tap of its own (iPhone, iPad). */
  const shareNow = React.useCallback(async () => {
    if (!shareFile) return
    try {
      await navigator.share({ files: [shareFile], title: "Glyph backup" })
      recordBackup(Date.now())
      setShareFile(null)
      onNotice({ text: "Backup shared.", tone: "info" })
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setShareFile(null)
      download(shareFile.name, shareFile)
      recordBackup(Date.now())
      onNotice({ text: `Saved ${shareFile.name}.`, tone: "info" })
    }
  }, [shareFile, onNotice])

  const [review, setReview] = React.useState<ImportReview | null>(null)
  const [snapshots, setSnapshots] = React.useState<SnapshotMeta[]>([])
  const refreshSnapshots = React.useCallback(async () => {
    setSnapshots(await listSnapshots())
  }, [])
  React.useEffect(() => {
    const timer = setTimeout(() => void refreshSnapshots(), 0)
    return () => clearTimeout(timer)
  }, [refreshSnapshots])

  /**
   * Imports a backup file in steps, each safe to stop at: (1) a read-only pass
   * over the whole file (checksum, counts, every row), so a damaged file is
   * refused before anything is written; (2) for a small file, a preview of what
   * it would change, waiting for a yes; (3) a copy of the current data (so the
   * import can be undone); (4) the merge, part by part.
   */
  const importFile = React.useCallback(
    (file: File, options: { lenient?: boolean; confirmed?: boolean } = {}) =>
      run(async () => {
        const lenient = options.lenient === true
        let info: BackupFileInfo
        try {
          info = await readBackupFile(file, undefined, { lenient })
        } catch (error) {
          if (error instanceof BackupRowsError && !lenient) {
            setReview({ kind: "rows", file, error: error.message })
            return null
          }
          throw error
        }
        const skipped = formatSkipped(info.skipped, info.skippedExamples)

        if (!options.confirmed && totalRows(info) <= PREVIEW_MAX_ROWS) {
          const stats = await previewBackup(await readWhole(file, lenient))
          if (!hasChanges(stats)) {
            return {
              text: `Nothing new to merge. ${skipped}`.trim(),
              tone: "info",
            }
          }
          setReview({
            kind: "preview",
            file,
            summary: formatMergeSummary(stats),
            skipped,
            lenient,
          })
          return null
        }

        let undo = "Undo is in Settings > Data."
        if (snapshotsSupported()) {
          try {
            await saveSnapshot(`before importing ${file.name}`)
          } catch (error) {
            const why = error instanceof Error ? ` (${error.message})` : ""
            return {
              text: `Nothing was imported: a safety copy of your data could not be saved first${why}. Free some space and try again.`,
              tone: "error",
            }
          }
        } else {
          undo =
            "This browser cannot keep a copy, so this import cannot be undone."
        }
        const { stats } = await importBackupFile(file, { lenient })
        await refreshSnapshots()
        return {
          text: [formatMergeSummary(stats), skipped, undo]
            .filter(Boolean)
            .join(" "),
          tone: "info",
        }
      }),
    [run, refreshSnapshots]
  )

  const confirmReview = React.useCallback(() => {
    const current = review
    setReview(null)
    if (!current) return
    if (current.kind === "restore") {
      void run(async () => {
        const result = await restoreSnapshot(current.meta)
        await refreshSnapshots()
        const when = new Date(current.meta.at).toLocaleString()
        const check = result.verified
          ? "Checked: it matches the copy exactly."
          : "Could not confirm that it matches the copy exactly."
        return {
          text: `Put back the copy from ${when}: ${result.notes} questions and ${result.reviews} reviews. ${check} The data as it was just before is also kept as a copy.`,
          tone: result.verified ? "info" : "error",
        }
      })
      return
    }
    void importFile(current.file, {
      lenient: current.kind === "rows" ? true : current.lenient,
      confirmed: true,
    })
  }, [review, run, importFile, refreshSnapshots])

  const cancelReview = React.useCallback(() => setReview(null), [])

  const removeSnapshot = React.useCallback(
    async (meta: SnapshotMeta) => {
      await deleteSnapshot(meta)
      await refreshSnapshots()
    },
    [refreshSnapshots]
  )

  const chooseFile = React.useCallback(() => fileInput.current?.click(), [])

  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".glyph,.jsonl,.json,application/json,application/gzip,application/octet-stream"
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

  return {
    exportFile,
    chooseFile,
    input,
    busy,
    /** A finished backup waiting for a tap on "Share backup file". */
    shareReady: shareFile !== null,
    shareNow,
    /** A step waiting for a yes before an import goes on, or null. */
    review,
    confirmReview,
    cancelReview,
    /** Copies taken before imports, newest first. */
    snapshots,
    startRestore: (meta: SnapshotMeta) => setReview({ kind: "restore", meta }),
    removeSnapshot,
  }
}
