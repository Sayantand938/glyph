import {
  isFlag,
  marksOf,
  nextDayStart,
  sameMarks,
  type CardMarks,
} from "@/lib/card-marks"

import { db } from "../database"

type MarkPatch = Partial<Pick<CardMarks, "flag" | "suspended" | "buriedUntil">>

/**
 * Applies `patch` to the card's marks in one transaction and stamps
 * `markedAt` (always later than the previous stamp, so the change wins a
 * backup merge). Reads the stored row, never a copy from the screen, so it can't
 * undo a review that landed a moment earlier. A change that alters nothing is
 * not written. FSRS progress is never touched.
 */
async function updateMarks(
  cardId: string,
  patch: MarkPatch,
  now: number
): Promise<void> {
  await db.transaction("rw", db.cards, async () => {
    const card = await db.cards.get(cardId)
    if (!card) throw new Error("Card not found.")
    const current = marksOf(card)
    const next: CardMarks = {
      ...current,
      ...patch,
      markedAt: Math.max(now, current.markedAt + 1),
    }
    if (sameMarks({ ...next, markedAt: current.markedAt }, current)) return
    await db.cards.put({ ...card, ...next })
  })
}

/** Sets the card's flag: 0 clears it, 1-7 pick a colour. */
export async function setFlag(
  cardId: string,
  flag: number,
  now = Date.now()
): Promise<void> {
  if (!isFlag(flag)) throw new Error("Unknown flag.")
  await updateMarks(cardId, { flag }, now)
}

/** Suspends or unsuspends a card; a suspended card is never studied or counted. */
export async function setSuspended(
  cardId: string,
  suspended: boolean,
  now = Date.now()
): Promise<void> {
  await updateMarks(cardId, { suspended }, now)
}

/** Hides a card until `until` (default: the start of the next local day). */
export async function buryCard(
  cardId: string,
  now = Date.now(),
  until = nextDayStart(now)
): Promise<void> {
  await updateMarks(cardId, { buriedUntil: until }, now)
}

export async function unburyCard(
  cardId: string,
  now = Date.now()
): Promise<void> {
  await updateMarks(cardId, { buriedUntil: 0 }, now)
}

/** Puts a card's marks back as they were (the study session's undo of a suspend or bury). */
export async function restoreMarks(
  cardId: string,
  marks: CardMarks,
  now = Date.now()
): Promise<void> {
  await updateMarks(
    cardId,
    {
      flag: marks.flag,
      suspended: marks.suspended,
      buriedUntil: marks.buriedUntil,
    },
    now
  )
}
