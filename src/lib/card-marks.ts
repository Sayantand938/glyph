/**
 * Card marks: the Anki-style flag, suspend and bury state of a card. Pure (no
 * DB, no React, no ts-fsrs). The marks live on the card row but are not FSRS
 * progress: a review, a reset and an undo all leave them alone.
 *
 *  - flag: 0 = none, 1-7 = a colour (Anki's palette), shown in the study
 *    session and the browse list and used as a filter there
 *  - suspended: the card is left out of the study queue and the counts until it
 *    is unsuspended
 *  - buriedUntil: the card is left out until that moment (the start of the next
 *    local day), after which it returns on its own; 0 = not buried
 *  - markedAt: when any of the three last changed, so a backup merge can keep
 *    the newest marks whatever else differs between the two copies
 */

export interface CardMarks {
  flag: number
  suspended: boolean
  /** ms epoch; the card is buried while `now` is before it. 0 = not buried. */
  buriedUntil: number
  /** ms epoch of the last change to the marks; 0 = never marked. */
  markedAt: number
}

export const NO_MARKS: CardMarks = {
  flag: 0,
  suspended: false,
  buriedUntil: 0,
  markedAt: 0,
}

export const FLAG_COUNT = 7

export const FLAG_NAMES: readonly string[] = [
  "Red",
  "Orange",
  "Green",
  "Blue",
  "Pink",
  "Turquoise",
  "Purple",
]

export function isFlag(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= FLAG_COUNT
  )
}

/** "Red" for 1 ... "Purple" for 7; "No flag" for anything else. */
export function flagName(flag: number): string {
  return FLAG_NAMES[flag - 1] ?? "No flag"
}

/** Flag numbers 1..7, for building menus and filters. */
export const FLAG_VALUES: readonly number[] = FLAG_NAMES.map((_, i) => i + 1)

/** The marks of a card (or anything shaped like one); missing fields count as unmarked. */
export function marksOf(card: Partial<CardMarks>): CardMarks {
  return {
    flag: isFlag(card.flag) ? card.flag : 0,
    suspended: card.suspended === true,
    buriedUntil:
      typeof card.buriedUntil === "number" && Number.isFinite(card.buriedUntil)
        ? card.buriedUntil
        : 0,
    markedAt:
      typeof card.markedAt === "number" && Number.isFinite(card.markedAt)
        ? card.markedAt
        : 0,
  }
}

export function sameMarks(
  a: Partial<CardMarks>,
  b: Partial<CardMarks>
): boolean {
  const x = marksOf(a)
  const y = marksOf(b)
  return (
    x.flag === y.flag &&
    x.suspended === y.suspended &&
    x.buriedUntil === y.buriedUntil &&
    x.markedAt === y.markedAt
  )
}

export function isBuried(card: Partial<CardMarks>, now: number): boolean {
  return marksOf(card).buriedUntil > now
}

/** Suspended or buried right now: left out of the queue, the counts and "Due". */
export function isHidden(card: Partial<CardMarks>, now: number): boolean {
  return card.suspended === true || isBuried(card, now)
}

/** The first moment of the next local calendar day: when a buried card comes back. */
export function nextDayStart(now: number): number {
  const day = new Date(now)
  day.setHours(24, 0, 0, 0)
  return day.getTime()
}

/** Picking the flag a card already has clears it; any other pick sets it. */
export function toggleFlag(current: number, picked: number): number {
  return current === picked ? 0 : picked
}

/** Ctrl+1 ... Ctrl+7: the flag a keyboard event stands for, from its `code` (layout independent). */
export function flagFromKeyCode(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-7])$/.exec(code)
  return match ? Number(match[1]) : null
}

/**
 * Which copy of a card's marks wins in a backup merge: the one changed last.
 * On a tie the marks of `fallback` (the copy whose progress won) are kept.
 */
export function newerMarks(
  local: Partial<CardMarks>,
  incoming: Partial<CardMarks>,
  fallback: Partial<CardMarks>
): CardMarks {
  const a = marksOf(local)
  const b = marksOf(incoming)
  if (a.markedAt === b.markedAt) return marksOf(fallback)
  return b.markedAt > a.markedAt ? b : a
}
