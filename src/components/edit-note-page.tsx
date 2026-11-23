import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangleIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { NoteImage } from "@/components/note-image"
import { loadTagNames } from "@/db/queries"
import { pruneImages, saveNote } from "@/db/repo"
import type { Note } from "@/db/types"
import { useImagePaste } from "@/hooks/use-image-paste"
import type { OptionIndex } from "@/lib/answer"
import { imageIdsIn } from "@/lib/image"
import {
  cleanDraft,
  draftChangesNote,
  validateDraft,
  type NoteDraft,
} from "@/lib/note-edit"
import { formatTags, parseTags } from "@/lib/tags"

const LABELS = ["A", "B", "C", "D"] as const
const MAX_SUGGESTIONS = 12
const INDEXES: readonly OptionIndex[] = [0, 1, 2, 3]

const fieldClass =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"

/** Small previews of the images a field's text uses. Renders nothing without any. */
function ImageStrip({ text }: { text: string }) {
  const ids = imageIdsIn(text)
  if (ids.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <NoteImage
          key={id}
          id={id}
          alt=""
          className="my-0 h-16 w-auto border"
        />
      ))}
    </div>
  )
}

function noteToDraft(note: Note): NoteDraft {
  return {
    question: note.question,
    options: [...note.options],
    correctIndex: note.correctIndex,
    extra: note.extra,
    tags: note.tags,
  }
}

/** Full-page editor for one question; closes itself through `onClose`. */
export function EditNotePage({
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
  // What is typed in the Tags field; `draft.tags` is its parsed form.
  const [tagsText, setTagsText] = React.useState(() =>
    formatTags(original.tags)
  )
  const knownTags = useLiveQuery(() => loadTagNames(), [])
  const [resetFsrs, setResetFsrs] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { valid, errors } = validateDraft(draft)
  const changed = draftChangesNote(original, draft)
  const { paste, pending: pendingImages, pasted } = useImagePaste(setError)

  // A pasted image is stored at once so it can be previewed. If the edit is
  // cancelled (or the page just closed) nothing uses it, so drop it. Saving
  // prunes by itself.
  React.useEffect(
    () => () => {
      if (pasted.current) void pruneImages().catch(() => undefined)
    },
    [pasted]
  )

  function setOption(index: number, update: (value: string) => string) {
    setDraft((d) => {
      const options = [...d.options] as NoteDraft["options"]
      options[index] = update(options[index])
      return { ...d, options }
    })
    setError(null)
  }

  // Tags used elsewhere that this question does not have yet.
  const suggestions = (knownTags ?? [])
    .filter((tag) => !draft.tags.includes(tag))
    .slice(0, MAX_SUGGESTIONS)

  function addTag(tag: string) {
    const text = tagsText.trim() === "" ? tag : `${tagsText.trimEnd()} ${tag}`
    setTagsText(text)
    setDraft((d) => ({ ...d, tags: parseTags(text) }))
    setError(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || busy || pendingImages > 0) return
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
    <PageShell
      title="Edit question"
      description="Changes show up straight away. Study progress is kept unless you reset it below. Paste a screenshot into any field to add an image."
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
          <Button type="submit" disabled={busy || !valid || pendingImages > 0}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
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
          onPaste={(e) =>
            paste(
              e,
              (update) =>
                setDraft((d) => ({ ...d, question: update(d.question) })),
              true
            )
          }
        />
        <ImageStrip text={draft.question} />
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
                onChange={(e) => {
                  const value = e.target.value
                  setOption(i, () => value)
                }}
                onPaste={(e) =>
                  paste(e, (update) => setOption(i, update), false)
                }
              />
            </div>
            <div className="pl-12 empty:hidden">
              <ImageStrip text={draft.options[i]} />
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
          onPaste={(e) =>
            paste(
              e,
              (update) => setDraft((d) => ({ ...d, extra: update(d.extra) })),
              true
            )
          }
        />
        <ImageStrip text={draft.extra} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-t`} className="text-xs font-medium">
          Tags (optional, separated by spaces or commas)
        </label>
        <input
          id={`${id}-t`}
          className={`${fieldClass} h-8 py-0`}
          value={tagsText}
          placeholder="e.g. physics exam-2025"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={errors.tags !== null}
          onChange={(e) => {
            setTagsText(e.target.value)
            setDraft((d) => ({ ...d, tags: parseTags(e.target.value) }))
            setError(null)
          }}
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Existing tags">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className="rounded border px-1.5 text-[0.7rem] leading-5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => addTag(tag)}
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
        {errors.tags && (
          <p role="alert" className="text-xs text-destructive">
            {errors.tags}
          </p>
        )}
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

      {pendingImages > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Adding {pendingImages === 1 ? "image" : "images"}...
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </PageShell>
  )
}
