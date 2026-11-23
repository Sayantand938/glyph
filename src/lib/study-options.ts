/**
 * What the user picks before a study session (like Anki's custom study): which
 * groups of card to include. Nothing is ever capped. Pure; the page stores it
 * per device.
 */
import type { DeckCounts, QueueGroups } from "./queue"

export type StudyOptions = QueueGroups

/** Everything on. */
export const DEFAULT_STUDY_OPTIONS: StudyOptions = {
  due: true,
  learning: true,
  new: true,
}

/**
 * Reads stored options; anything malformed gives null (use the defaults). An
 * older `newLimit` in the stored value is ignored (there is no limit any more).
 */
export function parseStudyOptions(value: unknown): StudyOptions | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  if (
    typeof v.due !== "boolean" ||
    typeof v.learning !== "boolean" ||
    typeof v.new !== "boolean"
  ) {
    return null
  }
  return { due: v.due, learning: v.learning, new: v.new }
}

/** The number of cards a session with these options would contain. */
export function sessionSize(counts: DeckCounts, options: StudyOptions): number {
  return (
    (options.due ? counts.due : 0) +
    (options.learning ? counts.learning : 0) +
    (options.new ? counts.new : 0)
  )
}
