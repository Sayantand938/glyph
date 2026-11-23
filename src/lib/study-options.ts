/**
 * What the user picks before a study session (like Anki's custom study): which
 * groups of card to include and how many new cards at most. Pure; the page
 * stores it per device.
 */
import { limitNew, type DeckCounts, type QueueGroups } from "./queue"

export interface StudyOptions extends QueueGroups {
  /** At most this many new cards; null = no limit. */
  newLimit: number | null
}

/** Everything on and no limit: a new-card limit is only ever the user's own choice. */
export const DEFAULT_STUDY_OPTIONS: StudyOptions = {
  due: true,
  learning: true,
  new: true,
  newLimit: null,
}

/** Reads stored options; anything malformed gives null (use the defaults). */
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
  let newLimit: number | null = null
  if (v.newLimit !== null) {
    if (typeof v.newLimit !== "number") return null
    const limit = parseNewLimit(String(v.newLimit))
    if (limit === undefined) return null
    newLimit = limit
  }
  return { due: v.due, learning: v.learning, new: v.new, newLimit }
}

/**
 * Turns the text of the limit box into a limit: empty means no limit (null), a
 * whole number is taken as typed (only kept inside the range JavaScript can
 * count exactly), anything else is undefined (not a usable value yet).
 */
export function parseNewLimit(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return undefined
  return Math.min(Number.MAX_SAFE_INTEGER, Number(trimmed))
}

/** The number of cards a session with these options would contain. */
export function sessionSize(counts: DeckCounts, options: StudyOptions): number {
  return (
    (options.due ? counts.due : 0) +
    (options.learning ? counts.learning : 0) +
    (options.new ? limitNew(counts.new, options.newLimit) : 0)
  )
}
