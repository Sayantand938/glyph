/**
 * Validation and change detection for the inline note editor: pure.
 */
import type { OptionIndex } from "./answer"

/** What the editor form holds. */
export interface NoteDraft {
  question: string
  options: [string, string, string, string]
  correctIndex: OptionIndex
  extra: string
}

export interface DraftErrors {
  question: string | null
  /** One entry per option; null when that option is fine. */
  options: [string | null, string | null, string | null, string | null]
}

export function validateDraft(draft: NoteDraft): {
  valid: boolean
  errors: DraftErrors
} {
  const errors: DraftErrors = {
    question: draft.question.trim() === "" ? "Question cannot be empty." : null,
    options: [null, null, null, null],
  }
  draft.options.forEach((option, i) => {
    if (option.trim() === "") errors.options[i] = "Option cannot be empty."
  })
  const valid =
    errors.question === null && errors.options.every((e) => e === null)
  return { valid, errors }
}

/** The draft with text trimmed, as it is stored. `extra` may be empty. */
export function cleanDraft(draft: NoteDraft): NoteDraft {
  return {
    question: draft.question.trim(),
    options: draft.options.map((o) => o.trim()) as NoteDraft["options"],
    correctIndex: draft.correctIndex,
    extra: draft.extra.trim(),
  }
}

/** True if saving `draft` would change any stored field of `note`. */
export function draftChangesNote(note: NoteDraft, draft: NoteDraft): boolean {
  const next = cleanDraft(draft)
  return (
    next.question !== note.question ||
    next.correctIndex !== note.correctIndex ||
    next.extra !== note.extra ||
    next.options.some((o, i) => o !== note.options[i])
  )
}
