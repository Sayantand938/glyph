/**
 * Leeches: questions that keep being forgotten. Pure (no DB, no React).
 *
 * Like Anki, a card becomes a leech when its lapse count reaches a threshold
 * (and again every half threshold after that, so a card you unsuspend and still
 * keep failing is caught again). A leech gets the `leech` tag, and optionally
 * the card is suspended too. In an MCQ deck a leech is often a badly worded
 * question or a bad distractor, so the tag is the cue to go and fix it.
 *
 * Nothing here caps reviews, learning or new cards; a leech is only marked.
 */
import { MAX_TAGS_PER_NOTE, parseTags } from "./tags"

export const LEECH_TAG = "leech"

/** What happens to a card when it becomes a leech (the tag is added either way). */
export type LeechAction = "tag" | "suspend"

export const DEFAULT_LEECH_THRESHOLD = 8
export const MAX_LEECH_THRESHOLD = 99
export const DEFAULT_LEECH_ACTION: LeechAction = "tag"

/** The user's leech setting as the review write needs it. */
export interface LeechRule {
  /** Lapses that make a leech; always at least 1 (0 = off is not a rule). */
  threshold: number
  action: LeechAction
}

/** Whole number 0-99 (0 = off); anything else is not usable. */
export function parseLeechThreshold(stored: unknown): number | null {
  return typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= 0 &&
    stored <= MAX_LEECH_THRESHOLD
    ? stored
    : null
}

export function parseLeechAction(stored: unknown): LeechAction | null {
  return stored === "tag" || stored === "suspend" ? stored : null
}

/** The rule for a threshold and action, or null when leech detection is off. */
export function leechRule(
  threshold: number,
  action: LeechAction
): LeechRule | null {
  return threshold >= 1 ? { threshold, action } : null
}

/**
 * Whether a review that moved the card from `before` to `after` lapses makes it
 * a leech: the count rose, reached the threshold, and sits on the threshold or
 * a whole number of half thresholds above it (8, 12, 16 ... for 8).
 */
export function isLeechLapse(
  before: number,
  after: number,
  threshold: number
): boolean {
  if (threshold < 1 || after <= before || after < threshold) return false
  const step = Math.max(1, Math.floor(threshold / 2))
  return (after - threshold) % step === 0
}

export function hasLeechTag(tags: readonly string[]): boolean {
  return tags.includes(LEECH_TAG)
}

/**
 * The tags with `leech` added (still unique and sorted). If the note is already
 * at the tag limit the list comes back unchanged, so a leech can never make a
 * note unsaveable.
 */
export function withLeechTag(tags: readonly string[]): string[] {
  if (hasLeechTag(tags) || tags.length >= MAX_TAGS_PER_NOTE) return [...tags]
  return parseTags([...tags, LEECH_TAG])
}

export function withoutLeechTag(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag !== LEECH_TAG)
}

/** One line for the study screen when a review made the card a leech. */
export function leechNotice(
  action: LeechAction,
  lapses: number,
  tagged: boolean
): string {
  const times = `${lapses} ${lapses === 1 ? "time" : "times"}`
  const mark = tagged ? ' Tagged "leech".' : ""
  return action === "suspend"
    ? `Leech: forgotten ${times}, so it is suspended.${mark} Z undoes it.`
    : `Leech: forgotten ${times}.${mark} Check its wording.`
}
