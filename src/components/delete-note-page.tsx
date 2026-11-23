import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { deleteNote } from "@/db/repo"
import type { Note } from "@/db/types"
import { previewText } from "@/lib/browse"

const PREVIEW_CHARS = 140

function clip(text: string): string {
  return text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}...`
    : text
}

/**
 * Confirms and soft-deletes one question. Used by the study session and the
 * browse list. `onDeleted` runs after the write, then the page closes.
 */
export function DeleteNotePage({
  note,
  onClose,
  onDeleted,
}: {
  note: Note
  onClose: () => void
  onDeleted?: (note: Note) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      await deleteNote(note.id)
      onDeleted?.(note)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the question.")
      setBusy(false)
    }
  }

  return (
    <PageShell
      title="Delete this question?"
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
      <blockquote className="rounded-lg border p-3 text-sm">
        {clip(previewText(note.question))}
      </blockquote>
      <p className="text-sm text-muted-foreground">
        It will be removed from your decks and from study. The deletion is
        recorded in backups, so restoring an older backup won&apos;t bring it
        back. Importing the same question again does.
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
