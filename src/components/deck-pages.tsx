import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { renameDeck, softDeleteDeck } from "@/db/repo"
import type { Deck } from "@/db/types"
import { deckNameKey } from "@/lib/importer"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong."
}

export function RenameDeckPage({
  deck,
  siblings,
  onClose,
}: {
  deck: Deck
  /** Live decks at the same level (including `deck`), to catch duplicate names. */
  siblings: readonly Deck[]
  onClose: () => void
}) {
  const id = React.useId()
  const [name, setName] = React.useState(deck.name)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const trimmed = name.trim()
  const clash = siblings.some(
    (d) => d.id !== deck.id && deckNameKey(d.name) === deckNameKey(trimmed)
  )
  const problem = !trimmed
    ? "Name cannot be empty."
    : clash
      ? "A deck with that name already exists here."
      : null
  const unchanged = trimmed === deck.name

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (problem || unchanged || busy) return
    setBusy(true)
    try {
      await renameDeck(deck.id, trimmed)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <PageShell
      title={`Rename ${deck.parentId === null ? "subject" : "topic"}`}
      description="Questions and study progress are kept."
      onBack={onClose}
      backDisabled={busy}
      onSubmit={(e) => void save(e)}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || unchanged || problem !== null}
          >
            {busy ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-medium">
          Name
        </label>
        <input
          id={id}
          autoFocus
          className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        <p role="alert" className="min-h-4 text-xs">
          {error ?? (unchanged ? "" : problem)}
        </p>
      </div>
    </PageShell>
  )
}

export function DeleteDeckPage({
  deck,
  topicCount,
  onClose,
}: {
  deck: Deck
  /** Topics that go with it when `deck` is a Subject. */
  topicCount: number
  onClose: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const isSubject = deck.parentId === null

  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      await softDeleteDeck(deck.id)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <PageShell
      title={
        <>
          Delete {isSubject ? "subject" : "topic"} &ldquo;{deck.name}&rdquo;?
        </>
      }
      onBack={onClose}
      backDisabled={busy}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Deleting..." : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {isSubject && topicCount > 0
          ? `Its ${topicCount === 1 ? "topic" : `${topicCount} topics`} and all questions will be removed from the app.`
          : "All its questions will be removed from the app."}{" "}
        The deletion is recorded in backups, so restoring an older backup
        won&apos;t bring it back.
      </p>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </PageShell>
  )
}
