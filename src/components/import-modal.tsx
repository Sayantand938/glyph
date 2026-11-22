import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangleIcon, CheckIcon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { db } from "@/db/database"
import { commitImport } from "@/db/repo"
import type { Deck, Note } from "@/db/types"
import {
  MAX_IMPORT_BYTES,
  formatSummary,
  parseImportText,
  planImport,
  resolveDeckRef,
  summarize,
  validateRows,
  type DeckRef,
  type ImportSummary,
  type Validation,
} from "@/lib/importer"

const MAX_INVALID_SHOWN = 200
const NO_NOTES: ReadonlyMap<string, Note> = new Map()

const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

interface LoadedFile {
  name: string
  validation: Validation
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeRef(ref: DeckRef | null, decks: readonly Deck[]): string {
  if (!ref) return ""
  if (ref.kind === "new") return `Will create "${ref.name}".`
  const deck = decks.find((d) => d.id === ref.id)
  return deck ? `Will use existing "${deck.name}".` : ""
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (summary: ImportSummary) => void
}) {
  const [busy, setBusy] = React.useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let a click-away or Esc close the dialog mid-write.
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent>
        <ImportForm
          busy={busy}
          setBusy={setBusy}
          onClose={() => onOpenChange(false)}
          onImported={onImported}
        />
      </DialogContent>
    </Dialog>
  )
}

function ImportForm({
  busy,
  setBusy,
  onClose,
  onImported,
}: {
  busy: boolean
  setBusy: (busy: boolean) => void
  onClose: () => void
  onImported?: (summary: ImportSummary) => void
}) {
  const id = React.useId()
  const fileInput = React.useRef<HTMLInputElement>(null)
  const readToken = React.useRef(0)

  const [file, setFile] = React.useState<LoadedFile | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const [subjectId, setSubjectId] = React.useState("")
  const [subjectName, setSubjectName] = React.useState("")
  const [topicId, setTopicId] = React.useState("")
  const [topicName, setTopicName] = React.useState("")

  const [commitError, setCommitError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportSummary | null>(null)

  const decks = useLiveQuery(() => db.decks.toArray(), [])
  const liveDecks = (decks ?? []).filter((d) => d.deletedAt === null)
  const subjects = liveDecks.filter((d) => d.parentId === null)

  const subjectRef = resolveDeckRef(subjects, subjectId, subjectName)
  const topics =
    subjectRef?.kind === "existing"
      ? liveDecks.filter((d) => d.parentId === subjectRef.id)
      : []
  const topicRef = resolveDeckRef(topics, topicId, topicName)

  // Stored notes of the chosen topic (including tombstones), for the preview.
  const existingTopicId = topicRef?.kind === "existing" ? topicRef.id : null
  const storedNotes = useLiveQuery(
    () =>
      existingTopicId
        ? db.notes.where("topicId").equals(existingTopicId).toArray()
        : [],
    [existingTopicId]
  )

  // A new topic has no id yet; ids only matter for grouping duplicates here.
  const plan = file
    ? planImport(
        file.validation.valid,
        existingTopicId ?? "",
        existingTopicId
          ? new Map((storedNotes ?? []).map((n) => [n.id, n]))
          : NO_NOTES,
        0
      )
    : null

  async function readFile(picked: File) {
    const token = ++readToken.current
    setResult(null)
    setCommitError(null)

    if (picked.size > MAX_IMPORT_BYTES) {
      setFile(null)
      setFileError(
        `That file is ${formatBytes(picked.size)}; the limit is ${formatBytes(MAX_IMPORT_BYTES)}.`
      )
      return
    }

    let text: string
    try {
      text = await picked.text()
    } catch {
      if (token !== readToken.current) return
      setFile(null)
      setFileError("Couldn't read that file.")
      return
    }
    if (token !== readToken.current) return

    const parsed = parseImportText(text)
    if (!parsed.ok) {
      setFile(null)
      setFileError(parsed.error)
      return
    }
    setFileError(null)
    setFile({ name: picked.name, validation: validateRows(parsed.rows) })
  }

  async function commit() {
    if (!file || !subjectRef || !topicRef || busy) return
    setBusy(true)
    setCommitError(null)
    try {
      const summary = await commitImport(
        { subject: subjectRef, topic: topicRef },
        file.validation.valid,
        file.validation.invalid.length
      )
      setResult(summary)
      onImported?.(summary)
    } catch (error) {
      console.error("Import failed", error)
      setCommitError(
        error instanceof Error ? error.message : "The import failed."
      )
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Import complete</DialogTitle>
          <DialogDescription>{file?.name}</DialogDescription>
        </DialogHeader>
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border p-3"
        >
          <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {formatSummary(result)}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    )
  }

  const valid = file?.validation.valid.length ?? 0
  const invalid = file?.validation.invalid ?? []
  const summary = plan ? summarize(plan, invalid.length) : null
  const canCommit =
    valid > 0 && subjectRef !== null && topicRef !== null && !busy

  const topicBlocked = subjectRef === null
  let hint = ""
  if (file && valid === 0) hint = "No valid rows to import."
  else if (file && !subjectRef) hint = "Choose or type a subject."
  else if (file && !topicRef) hint = "Choose or type a topic."

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import MCQs from JSON</DialogTitle>
        <DialogDescription>
          Re-importing the same file never resets study progress.
        </DialogDescription>
      </DialogHeader>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const dropped = e.dataTransfer.files[0]
          if (dropped && !busy) void readFile(dropped)
        }}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center ${dragging ? "bg-muted" : ""}`}
      >
        <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-xs text-muted-foreground">
          {file ? file.name : "Drop a .json file here"}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {file ? "Choose another file" : "Choose file"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-label="JSON file"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            // Reset so picking the same file again re-triggers onChange.
            e.target.value = ""
            if (picked) void readFile(picked)
          }}
        />
      </div>

      {fileError && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {fileError}
        </p>
      )}

      <fieldset className="flex flex-col gap-3" disabled={busy}>
        <legend className="sr-only">Target</legend>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-subject`} className="text-xs font-medium">
            Subject
          </label>
          <select
            id={`${id}-subject`}
            className={fieldClass}
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value)
              setTopicId("")
            }}
          >
            <option value="">Select a subject...</option>
            {subjects.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            className={fieldClass}
            placeholder="...or type a new subject"
            aria-label="New subject name"
            value={subjectName}
            onChange={(e) => {
              setSubjectName(e.target.value)
              setTopicId("")
            }}
          />
          <p className="min-h-4 text-xs text-muted-foreground">
            {describeRef(subjectRef, liveDecks)}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-topic`} className="text-xs font-medium">
            Topic
          </label>
          <select
            id={`${id}-topic`}
            className={fieldClass}
            value={topicId}
            disabled={topicBlocked || topics.length === 0}
            onChange={(e) => setTopicId(e.target.value)}
          >
            <option value="">
              {topics.length === 0 ? "No topics yet" : "Select a topic..."}
            </option>
            {topics.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            className={fieldClass}
            placeholder="...or type a new topic"
            aria-label="New topic name"
            value={topicName}
            disabled={topicBlocked}
            onChange={(e) => setTopicName(e.target.value)}
          />
          <p className="min-h-4 text-xs text-muted-foreground">
            {describeRef(topicRef, liveDecks)}
          </p>
        </div>
      </fieldset>

      {summary && (
        <div className="flex flex-col gap-2 text-sm" aria-live="polite">
          <p>
            <strong>{valid}</strong> valid ({summary.added} new,{" "}
            {summary.updated} will update, {summary.unchanged} unchanged),{" "}
            <strong>{invalid.length}</strong> invalid
            {summary.duplicates > 0 &&
              `; ${summary.duplicates} duplicate question${summary.duplicates === 1 ? "" : "s"} in the file will be merged (last one wins)`}
            .
          </p>

          {invalid.length > 0 && (
            <details className="rounded-lg border p-2 text-xs">
              <summary className="cursor-pointer select-none">
                Show invalid rows
              </summary>
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {invalid.slice(0, MAX_INVALID_SHOWN).map((item) => (
                  <li key={item.row}>
                    <span className="font-medium">
                      Row {item.row}
                      {item.sl !== "" && ` (sl ${item.sl})`}:
                    </span>{" "}
                    {item.reasons.join(" ")}
                  </li>
                ))}
                {invalid.length > MAX_INVALID_SHOWN && (
                  <li className="text-muted-foreground">
                    ...and {invalid.length - MAX_INVALID_SHOWN} more.
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      {commitError && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {commitError}
        </p>
      )}

      <DialogFooter>
        {hint && (
          <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
            {hint}
          </p>
        )}
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canCommit} onClick={() => void commit()}>
          {busy ? "Importing..." : "Import"}
        </Button>
      </DialogFooter>
    </>
  )
}
