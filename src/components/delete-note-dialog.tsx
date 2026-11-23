import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
 * browse list. `onDeleted` runs after the write, then the dialog closes.
 */
export function DeleteNoteDialog({
  note,
  onClose,
  onDeleted,
}: {
  /** The question to delete; null keeps the dialog closed. */
  note: Note | null
  onClose: () => void
  onDeleted?: (note: Note) => void
}) {
  return (
    <Dialog open={note !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {note && (
          <DeleteForm
            key={note.id}
            note={note}
            onClose={onClose}
            onDeleted={onDeleted}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteForm({
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
    <>
      <DialogHeader>
        <DialogTitle>Delete this question?</DialogTitle>
        <DialogDescription>
          &ldquo;{clip(previewText(note.question))}&rdquo; will be removed from
          your decks and from study. The deletion is recorded in backups, so
          restoring an older backup won&apos;t bring it back. Importing the same
          question again does.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </>
  )
}
