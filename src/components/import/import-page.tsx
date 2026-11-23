import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangleIcon, CheckIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { db } from "@/db/database"
import { commitImport } from "@/db/repo"
import type { Note } from "@/db/types"
import {
  formatSummary,
  planImport,
  resolveDeckRef,
  summarize,
  type ImportSummary,
} from "@/lib/importer"

import { DeckField } from "./deck-field"
import { FileDrop } from "./file-drop"
import { ImportPreview } from "./import-preview"
import { useImportFile } from "./use-import-file"

const NO_NOTES: ReadonlyMap<string, Note> = new Map()

/** Full-page importer for a JSON file of questions. */
export function ImportPage({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported?: (summary: ImportSummary) => void
}) {
  const id = React.useId()
  const [busy, setBusy] = React.useState(false)
  const { file, fileError, readFile } = useImportFile()

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

  function pickFile(picked: File) {
    setResult(null)
    setCommitError(null)
    void readFile(picked)
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
      <PageShell
        title="Import complete"
        description={file?.name}
        onBack={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border p-3"
        >
          <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {formatSummary(result)}
        </p>
      </PageShell>
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
    <PageShell
      title="Import MCQs from JSON"
      description="Re-importing the same file never resets study progress."
      onBack={onClose}
      backDisabled={busy}
      footer={
        <>
          {hint && (
            <p className="text-xs text-muted-foreground sm:mr-auto">{hint}</p>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canCommit} onClick={() => void commit()}>
            {busy ? "Importing..." : "Import"}
          </Button>
        </>
      }
    >
      <FileDrop
        fileName={file?.name ?? null}
        disabled={busy}
        onFile={pickFile}
      />

      {fileError && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {fileError}
        </p>
      )}

      <fieldset className="flex flex-col gap-3" disabled={busy}>
        <legend className="sr-only">Target</legend>

        <DeckField
          id={`${id}-subject`}
          label="Subject"
          noun="subject"
          options={subjects}
          emptyOptionLabel="Select a subject..."
          selectedId={subjectId}
          onSelect={(next) => {
            setSubjectId(next)
            setTopicId("")
          }}
          name={subjectName}
          onName={(next) => {
            setSubjectName(next)
            setTopicId("")
          }}
          resolved={subjectRef}
          liveDecks={liveDecks}
        />

        <DeckField
          id={`${id}-topic`}
          label="Topic"
          noun="topic"
          options={topics}
          emptyOptionLabel={
            topics.length === 0 ? "No topics yet" : "Select a topic..."
          }
          selectedId={topicId}
          onSelect={setTopicId}
          name={topicName}
          onName={setTopicName}
          selectDisabled={topicBlocked || topics.length === 0}
          nameDisabled={topicBlocked}
          resolved={topicRef}
          liveDecks={liveDecks}
        />
      </fieldset>

      {summary && (
        <ImportPreview valid={valid} invalid={invalid} summary={summary} />
      )}

      {commitError && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {commitError}
        </p>
      )}
    </PageShell>
  )
}
