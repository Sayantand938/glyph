import { CheckIcon, XIcon } from "lucide-react"

import { RichText } from "@/components/rich-text"

export type OptionStatus =
  /** Not answered yet. */
  | "idle"
  /** The correct option, revealed. */
  | "correct"
  /** The option picked, recorded as wrong. */
  | "wrong"
  /** The option picked while the recorded result was right but the key has since changed. */
  | "picked"
  /** Any other option once answered. */
  | "dim"

const STATUS_CLASS: Record<OptionStatus, string> = {
  idle: "border-border bg-background hover:bg-muted",
  correct:
    "border-green-600 bg-green-600/10 text-foreground dark:border-green-500 dark:bg-green-500/15",
  wrong:
    "border-red-600 bg-red-600/10 text-foreground dark:border-red-500 dark:bg-red-500/15",
  picked: "border-foreground bg-muted text-foreground",
  dim: "border-border bg-background text-muted-foreground",
}

/**
 * One answer option: a large tap target with its A-D key label. Once locked it
 * stays focusable (aria-disabled, not disabled) and ignores clicks. State is
 * shown with an icon as well as colour.
 */
export function OptionButton({
  label,
  text,
  status,
  locked,
  onPick,
}: {
  label: string
  text: string
  status: OptionStatus
  locked: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-disabled={locked}
      onClick={() => {
        if (!locked) onPick()
      }}
      className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${STATUS_CLASS[status]} ${locked ? "cursor-default" : ""}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded border text-xs font-semibold">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">
        <RichText text={text} />
      </span>
      {status === "correct" && (
        <>
          <CheckIcon className="size-5 shrink-0" aria-hidden />
          <span className="sr-only">Correct answer</span>
        </>
      )}
      {status === "wrong" && (
        <>
          <XIcon className="size-5 shrink-0" aria-hidden />
          <span className="sr-only">Your answer, incorrect</span>
        </>
      )}
      {status === "picked" && <span className="sr-only">Your answer</span>}
    </button>
  )
}
