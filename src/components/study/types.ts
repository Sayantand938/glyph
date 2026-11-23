import type { LeechOutcome } from "@/db/repo"
import type { CardRow } from "@/db/types"
import type { Grade } from "@/db/scheduler"
import type { OptionIndex } from "@/lib/answer"
import type { CardMarks } from "@/lib/card-marks"
import type { SessionRecord } from "@/lib/session"

export type Phase =
  | { kind: "question" }
  /** Picked a wrong option; the Again review is already saved. */
  | { kind: "wrong"; picked: OptionIndex }
  /** Picked the right option; waiting for Pass/Fail. Nothing saved yet. */
  | { kind: "right"; picked: OptionIndex; pickedAt: number }

/** A saved review plus what is needed to take it back. */
export interface UndoEntry extends SessionRecord {
  logId: string
  previousRow: CardRow
  /** Queue and position from before the answer (so any re-queued copy goes too). */
  queue: string[]
  index: number
  /** False once the card's progress was reset by an edit. */
  undoable: boolean
  /** Set when this review made the card a leech (tagged and maybe suspended). */
  leech?: LeechOutcome
  /** What was answered, so a redo can do the same again. */
  rating: Grade
  /** The option that was picked. */
  picked: OptionIndex
  /** True for a wrong pick (saved at once); false for a Pass/Fail on a right pick. */
  wrongPick: boolean
  /** When the right option was picked (a Pass/Fail entry; 0 for a wrong pick). */
  pickedAt: number
  /** Time to answer, as saved in the review. */
  answerMs: number
}

/** A suspend or bury made in this session, with what is needed to take it back. */
export interface MarkUndo {
  cardId: string
  /** Which one it was, so a redo can do it again. */
  kind: "suspend" | "bury"
  /** The card's marks from before. */
  previous: CardMarks
  /** Queue, position and phase from before the card left the session. */
  queue: string[]
  index: number
  phase: Phase
  /** `history.length` at that moment: the undo only applies while no review came after. */
  historyLength: number
}

/** Something Undo took back, which Redo can do again. */
export type RedoItem =
  { kind: "review"; entry: UndoEntry } | { kind: "mark"; mark: MarkUndo }

export interface Run {
  queue: string[]
  index: number
  phase: Phase
  history: UndoEntry[]
  /** Cards suspended or buried in this session; they never come back via an undo. */
  hidden: string[]
  /** The latest suspend or bury, which Undo takes back before older reviews. */
  lastMark?: MarkUndo
  /**
   * What Undo has taken back, newest last. Any new answer, suspend, bury,
   * delete or move on empties it (like any editor).
   */
  redo?: RedoItem[]
}
