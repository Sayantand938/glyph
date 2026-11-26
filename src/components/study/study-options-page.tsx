import * as React from "react"

import { useLiveQuery } from "@/hooks/use-live-query"
import { loadStudyCounts } from "@/db/queries"
import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { LoadingBlock } from "@/components/ui/spinner"
import { useStoredState } from "@/hooks/use-stored-state"
import {
  DEFAULT_STUDY_OPTIONS,
  parseStudyOptions,
  sessionSize,
  type StudyOptions,
} from "@/lib/study-options"

import type { StudyScope } from "../deck-tree"
import { currentTime } from "./helpers"

/**
 * Shown before a session: pick which groups of card to study (due, learning,
 * new). The choice is remembered on this device.
 */
export function StudyOptionsPage({
  scope,
  onBack,
  onStart,
  locked = false,
  description = "Choose what to include in this session.",
  children,
}: {
  scope: StudyScope
  onBack: () => void
  onStart: (options: StudyOptions) => void
  /** A device sync is running (in another tab): studying waits until it ends. */
  locked?: boolean
  /** The line under the title. */
  description?: string
  /** Shown under the options (the deck screen puts its actions here). */
  children?: React.ReactNode
}) {
  const [options, setOptions] = useStoredState(
    "glyph.studyOptions",
    DEFAULT_STUDY_OPTIONS,
    parseStudyOptions
  )
  const counts = useLiveQuery(
    () => loadStudyCounts(scope, currentTime()),
    [scope],
    ["decks", "notes", "cards"]
  )

  if (!counts) return <LoadingBlock label="Loading" />

  const total = sessionSize(counts, options)

  function toggle(key: "due" | "learning" | "new") {
    setOptions({ ...options, [key]: !options[key] })
  }

  return (
    <PageShell
      title={scope.name}
      description={description}
      onBack={onBack}
      onSubmit={(event) => {
        event.preventDefault()
        if (total > 0 && !locked) onStart(options)
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" autoFocus disabled={total === 0 || locked}>
            {total === 0
              ? "Nothing to study"
              : locked
                ? "Sync running..."
                : `Start (${total} card${total === 1 ? "" : "s"})`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col divide-y rounded-lg border">
        <GroupRow
          label="Due"
          hint="Reviews of cards you already know, due today."
          count={counts.due}
          checked={options.due}
          onChange={() => toggle("due")}
        />
        <GroupRow
          label="Learning"
          hint="Cards you got wrong or are still learning, due now."
          count={counts.learning}
          checked={options.learning}
          onChange={() => toggle("learning")}
        />
        <GroupRow
          label="New"
          hint="Questions you have never answered."
          count={counts.new}
          checked={options.new}
          onChange={() => toggle("new")}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Cards you leave out are not lost; they stay due until you study them.
      </p>

      {children}
    </PageShell>
  )
}

function GroupRow({
  label,
  hint,
  count,
  checked,
  onChange,
}: {
  label: string
  hint: string
  count: number
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="font-semibold tabular-nums">{count}</span>
    </label>
  )
}
