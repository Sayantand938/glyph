import { OptionButton, type OptionStatus } from "@/components/option-button"
import { RichText } from "@/components/rich-text"
import { Button } from "@/components/ui/button"
import type { StudyCardView } from "@/db/queries"
import { Rating, type Grade, type previewIntervals } from "@/db/scheduler"
import type { OptionIndex } from "@/lib/answer"

import { LABELS } from "./helpers"
import type { Phase } from "./types"

/** One card: question, options, the explanation after answering, and the buttons for the phase. */
export function QuestionView({
  data,
  order,
  phase,
  intervals,
  onPick,
  onNext,
  onGrade,
}: {
  data: StudyCardView
  /** Original option indexes in display order. */
  order: readonly OptionIndex[]
  phase: Phase
  intervals: ReturnType<typeof previewIntervals> | null
  onPick: (slot: number) => void
  onNext: () => void
  onGrade: (rating: Grade) => void
}) {
  const answered = phase.kind !== "question"

  const statusFor = (original: OptionIndex): OptionStatus => {
    if (phase.kind === "question") return "idle"
    if (original === data.note.correctIndex) return "correct"
    if (original === phase.picked) {
      return phase.kind === "wrong" ? "wrong" : "picked"
    }
    return "dim"
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-medium break-words whitespace-pre-wrap">
        <RichText text={data.note.question} />
      </p>

      <div className="flex flex-col gap-2" role="group" aria-label="Options">
        {order.map((original, slot) => (
          <OptionButton
            key={original}
            label={LABELS[slot]}
            text={data.note.options[original]}
            status={statusFor(original)}
            locked={answered}
            onPick={() => onPick(slot)}
          />
        ))}
      </div>

      {answered && data.note.extra.trim() !== "" && (
        <div
          className="rounded-lg border bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap"
          aria-live="polite"
        >
          <RichText text={data.note.extra} />
        </div>
      )}

      {phase.kind === "wrong" && (
        <Button size="lg" className="w-full" onClick={onNext}>
          Next Card (Space)
        </Button>
      )}

      {phase.kind === "right" && intervals && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="lg"
            className="h-auto flex-col gap-0 py-2"
            onClick={() => onGrade(Rating.Again)}
          >
            <span>Fail</span>
            <span className="text-xs text-muted-foreground">
              {intervals.again} &middot; F
            </span>
          </Button>
          <Button
            size="lg"
            className="h-auto flex-col gap-0 py-2"
            onClick={() => onGrade(Rating.Good)}
          >
            <span>Pass</span>
            <span className="text-xs opacity-80">
              {intervals.good} &middot; P
            </span>
          </Button>
        </div>
      )}
    </div>
  )
}
