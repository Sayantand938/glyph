import type { LeechOutcome } from "@/db/repo"
import type { CardRow } from "@/db/types"
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
}

/** A suspend or bury made in this session, with what is needed to take it back. */
export interface MarkUndo {
  cardId: string
  /** The card's marks from before. */
  previous: CardMarks
  /** Queue, position and phase from before the card left the session. */
  queue: string[]
  index: number
  phase: Phase
  /** `history.length` at that moment: the undo only applies while no review came after. */
  historyLength: number
}

export interface Run {
  queue: string[]
  index: number
  phase: Phase
  history: UndoEntry[]
  /** Cards suspended or buried in this session; they never come back via an undo. */
  hidden: string[]
  /** The latest suspend or bury, which Undo takes back before older reviews. */
  lastMark?: MarkUndo
}
