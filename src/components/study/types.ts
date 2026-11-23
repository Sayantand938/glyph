import type { CardRow } from "@/db/types"
import type { OptionIndex } from "@/lib/answer"
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
}

export interface Run {
  queue: string[]
  index: number
  phase: Phase
  history: UndoEntry[]
}
