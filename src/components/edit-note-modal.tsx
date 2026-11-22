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
import { saveNote } from "@/db/repo"
import type { Note } from "@/db/types"
import type { OptionIndex } from "@/lib/answer"
import {
  cleanDraft,
  draftChangesNote,
  validateDraft,
  type NoteDraft,
} from "@/lib/note-edit"

const LABELS = ["A", "B", "C", "D"] as const
const INDEXES: readonly OptionIndex[] = [0, 1, 2, 3]

const fieldClass =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"

export function EditNoteModal({
  note,
  onClose,
  onSaved,
}: {
  /** The note being edited; null keeps the dialog closed. */
  note: Note | null
  onClose: () => void
  /** Called after a successful save with whether FSRS progress was reset. */
  onSaved?: (note: Note, resetFsrs: boolean) => void
}) {
  return (
    <Dialog open={note !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {note && (
          <EditForm
            key={note.id}
            note={note}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function noteToDraft(note: Note): NoteDraft {
  return {
    question: note.question,
    options: [...note.options],
    correctIndex: note.correctIndex,
    extra: note.extra,
  }
}

function EditForm({
  note,
  onClose,
  onSaved,
}: {
  note: Note
  onClose: () => void
  onSaved?: (note: Note, resetFsrs: boolean) => void
}) {
  const id = React.useId()
  // The form works on its own copy, so a live update of the note underneath
  // never overwrites what is being typed.
  const [original] = React.useState(() => noteToDraft(note))
  const [draft, setDraft] = React.useState<NoteDraft>(original)
  const [resetFsrs, setResetFsrs] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { valid, errors } = validateDraft(draft)
  const changed = draftChangesNote(original, draft)

  function setOption(index: number, value: string) {
    setDraft((d) => {
      const options = [...d.options] as NoteDraft["options"]
      options[index] = value
      return { ...d, options }
    })
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    if (!changed && !resetFsrs) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const clean = cleanDraft(draft)
      const saved = await saveNote({ ...note, ...clean }, { resetFsrs })
      onSaved?.(saved, resetFsrs)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the question.")
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit question</DialogTitle>
        <DialogDescription>
          Changes show up straight away. Study progress is kept unless you reset
          it below.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-q`} className="text-xs font-medium">
          Question
        </label>
        <textarea
          id={`${id}-q`}
          rows={3}
          className={fieldClass}
          value={draft.question}
          aria-invalid={errors.question !== null}
          onChange={(e) => {
            setDraft((d) => ({ ...d, question: e.target.value }))
            setError(null)
          }}
        />
        {errors.question && (
          <p role="alert" className="text-xs text-destructive">
            {errors.question}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium">
          Options (select the correct one)
        </legend>
        {INDEXES.map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-correct`}
                className="size-4 shrink-0 accent-foreground"
                checked={draft.correctIndex === i}
                aria-label={`Option ${LABELS[i]} is correct`}
                onChange={() => setDraft((d) => ({ ...d, correctIndex: i }))}
              />
              <span className="w-4 shrink-0 text-xs font-semibold">
                {LABELS[i]}
              </span>
              <input
                className={`${fieldClass} h-8 py-0`}
                value={draft.options[i]}
                aria-label={`Option ${LABELS[i]}`}
                aria-invalid={errors.options[i] !== null}
                onChange={(e) => setOption(i, e.target.value)}
              />
            </div>
            {errors.options[i] && (
              <p role="alert" className="pl-12 text-xs text-destructive">
                {errors.options[i]}
              </p>
            )}
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-x`} className="text-xs font-medium">
          Extra (shown after answering, optional)
        </label>
        <textarea
          id={`${id}-x`}
          rows={3}
          className={fieldClass}
          value={draft.extra}
          onChange={(e) => {
            setDraft((d) => ({ ...d, extra: e.target.value }))
            setError(null)
          }}
        />
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-foreground"
          checked={resetFsrs}
          onChange={(e) => setResetFsrs(e.target.checked)}
        />
        <span>
          Reset FSRS progress
          <span className="block text-muted-foreground">
            Makes this a new card again. Review history is kept.
          </span>
        </span>
      </label>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !valid}>
          {busy ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  )
}
