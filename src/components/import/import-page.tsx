import * as React from "react"
import { AlertTriangleIcon, CheckIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { useLiveQuery } from "@/hooks/use-live-query"
import { loadDecks, loadTopicNotes } from "@/db/queries"
import { commitImport } from "@/db/repo"
import type { Note } from "@/db/types"
import {
  deckPath,
  findDeckByPath,
  liveDecks,
  parseDeckPath,
  pathLabel,
  PATH_SEPARATOR,
} from "@/lib/deck-tree"
import {
  formatSummary,
  planImport,
  summarize,
  type ImportSummary,
} from "@/lib/importer"

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

  // Where to import: "WBCS > Mains > 2018", any depth. Missing decks are made.
  const [destination, setDestination] = React.useState("")

  const [commitError, setCommitError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImportSummary | null>(null)

  const decks = useLiveQuery(() => loadDecks(), [], ["decks"])
  const live = React.useMemo(() => liveDecks(decks ?? []), [decks])
  const suggestions = React.useMemo(
    () => live.map((d) => pathLabel(deckPath(live, d.id))).sort(),
    [live]
  )

  const names = parseDeckPath(destination)
  const target = findDeckByPath(live, names)
  // How many levels of the path exist already; the rest would be created.
  let existingLevels = 0
  for (let k = names.length; k > 0; k--) {
    if (findDeckByPath(live, names.slice(0, k))) {
      existingLevels = k
      break
    }
  }
  const toCreate = names.slice(existingLevels)

  // Stored notes of the chosen deck (including tombstones), for the preview.
  const existingTopicId = target?.id ?? null
  const storedNotes = useLiveQuery(
    () =>
      existingTopicId ? loadTopicNotes(existingTopicId) : Promise.resolve([]),
    [existingTopicId],
    ["notes"]
  )

  // A new deck has no id yet; ids only matter for grouping duplicates here.
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
    if (!file || names.length === 0 || busy) return
    setBusy(true)
    setCommitError(null)
    try {
      const summary = await commitImport(
        { path: names },
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
  const canCommit = valid > 0 && names.length > 0 && !busy

  let hint = ""
  if (file && valid === 0) hint = "No valid rows to import."
  else if (file && names.length === 0) hint = "Type the deck to import into."

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-deck`} className="text-xs font-medium">
          Deck to import into
        </label>
        <input
          id={`${id}-deck`}
          list={`${id}-decks`}
          value={destination}
          disabled={busy}
          placeholder={`e.g. WBCS${PATH_SEPARATOR}Mains${PATH_SEPARATOR}2018${PATH_SEPARATOR}Paper 4`}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDestination(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <datalist id={`${id}-decks`}>
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <p role="status" className="min-h-4 text-xs text-muted-foreground">
          {names.length === 0
            ? `Type a path with ">" between the levels, as deep as you like. Decks that do not exist yet are created.`
            : toCreate.length === 0
              ? `Into the existing deck ${pathLabel(deckPath(live, target?.id ?? ""))}.`
              : existingLevels === 0
                ? `Creates ${toCreate.join(PATH_SEPARATOR)}.`
                : `Inside ${names.slice(0, existingLevels).join(PATH_SEPARATOR)}, creates ${toCreate.join(PATH_SEPARATOR)}.`}
        </p>
      </div>

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
