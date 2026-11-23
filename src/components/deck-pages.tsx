import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { createDeckPath, renameDeck, softDeleteDeck } from "@/db/repo"
import type { Deck } from "@/db/types"
import { PATH_SEPARATOR, parseDeckPath } from "@/lib/deck-tree"
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
    : trimmed.includes(">")
      ? "A name cannot contain >, it separates sub-decks."
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
      title="Rename deck"
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

/** Makes a new deck: at the top (`parent` null) or inside `parent`, to any depth. */
export function CreateDeckPage({
  parent,
  siblings,
  onClose,
}: {
  parent: Deck | null
  /** The live decks at that level, to catch duplicate names. */
  siblings: readonly Deck[]
  onClose: () => void
}) {
  const id = React.useId()
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // "WBCS > Mains > 2018" makes three nested decks; a plain name makes one.
  const names = parseDeckPath(name)
  const nested = names.length > 1
  const clash =
    names.length === 1 &&
    siblings.some((d) => deckNameKey(d.name) === deckNameKey(names[0]))
  const problem = clash ? "A deck with that name already exists here." : null

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (names.length === 0 || problem || busy) return
    setBusy(true)
    try {
      await createDeckPath(names, parent?.id ?? null)
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <PageShell
      title={parent ? "New sub-deck" : "New deck"}
      description={
        parent
          ? `Inside "${parent.name}". Questions can go in any deck, and a deck's numbers include the decks inside it.`
          : "Questions can go in any deck, and a deck's numbers include the decks inside it."
      }
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
            disabled={busy || names.length === 0 || problem !== null}
          >
            {busy ? "Creating..." : "Create"}
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
          placeholder="Deck or Deck > Sub-deck > Sub-deck"
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
        <p role="alert" className="min-h-4 text-xs">
          {error ?? problem}
        </p>
        <p className="text-xs text-muted-foreground">
          {nested
            ? `Creates ${names.join(PATH_SEPARATOR)}, adding any level that is missing.`
            : "Use > to make sub-decks in one go, like WBCS > Mains > 2018."}
        </p>
      </div>
    </PageShell>
  )
}

export function DeleteDeckPage({
  deck,
  descendants,
  onClose,
}: {
  deck: Deck
  /** Decks inside it, at any depth: they go with it. */
  descendants: number
  onClose: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

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
      title={<>Delete deck &ldquo;{deck.name}&rdquo;?</>}
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
        {descendants > 0
          ? `The ${descendants === 1 ? "deck" : `${descendants} decks`} inside it and all questions in them will be removed from the app too.`
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
