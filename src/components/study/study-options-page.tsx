import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { loadStudyCards } from "@/db/queries"
import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { useStoredState } from "@/hooks/use-stored-state"
import { countCards } from "@/lib/queue"
import {
  DEFAULT_STUDY_OPTIONS,
  parseNewLimit,
  parseStudyOptions,
  sessionSize,
  type StudyOptions,
} from "@/lib/study-options"

import type { StudyScope } from "../deck-tree"
import { currentTime } from "./helpers"

/**
 * Shown before a session: pick which groups of card to study (due, learning,
 * new) and cap the new cards. The choice is remembered on this device.
 */
export function StudyOptionsPage({
  scope,
  onBack,
  onStart,
}: {
  scope: StudyScope
  onBack: () => void
  onStart: (options: StudyOptions) => void
}) {
  const [options, setOptions] = useStoredState(
    "glyph.studyOptions",
    DEFAULT_STUDY_OPTIONS,
    parseStudyOptions
  )
  // The limit box is text so it can be empty (= no limit) or half typed.
  const [limitText, setLimitText] = React.useState(
    options.newLimit === null ? "" : String(options.newLimit)
  )
  const cards = useLiveQuery(() => loadStudyCards(scope), [scope])

  if (!cards) {
    return (
      <p className="py-8 text-sm text-muted-foreground" role="status">
        Loading...
      </p>
    )
  }

  const counts = countCards(cards, currentTime())
  const limit = parseNewLimit(limitText)
  const effective: StudyOptions = {
    ...options,
    newLimit: limit === undefined ? options.newLimit : limit,
  }
  const total = sessionSize(counts, effective)
  const newShown = Math.min(
    counts.new,
    effective.newLimit === null ? counts.new : effective.newLimit
  )

  function toggle(key: "due" | "learning" | "new") {
    setOptions({ ...options, [key]: !options[key] })
  }

  function changeLimit(text: string) {
    setLimitText(text)
    const parsed = parseNewLimit(text)
    if (parsed !== undefined) setOptions({ ...options, newLimit: parsed })
  }

  return (
    <PageShell
      title={`Study ${scope.name}`}
      description="Choose what to include in this session."
      onBack={onBack}
      onSubmit={(event) => {
        event.preventDefault()
        if (total > 0 && limit !== undefined) onStart(effective)
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            type="submit"
            autoFocus
            disabled={total === 0 || limit === undefined}
          >
            {total === 0
              ? "Nothing to study"
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
        <div className="flex flex-col gap-3 p-3">
          <GroupRow
            bare
            label="New"
            hint="Questions you have never answered."
            count={options.new ? newShown : counts.new}
            countSuffix={
              options.new && newShown < counts.new ? ` of ${counts.new}` : ""
            }
            checked={options.new}
            onChange={() => toggle("new")}
          />
          <label
            className={`flex items-center justify-between gap-3 pl-7 text-sm ${
              options.new ? "" : "opacity-50"
            }`}
          >
            <span>Max new cards</span>
            <input
              type="text"
              inputMode="numeric"
              value={limitText}
              disabled={!options.new}
              placeholder="No limit"
              aria-label="Maximum new cards"
              aria-invalid={limit === undefined}
              onChange={(event) => changeLimit(event.target.value)}
              className="h-8 w-24 rounded-lg border bg-background px-2 text-right tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
          </label>
          {limit === undefined && (
            <p role="alert" className="pl-7 text-xs text-destructive">
              Enter a whole number, or leave it empty for no limit.
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        New cards are taken oldest first, so the rest follow on later days.
        Cards you leave out are not lost; they stay due until you study them.
      </p>
    </PageShell>
  )
}

function GroupRow({
  label,
  hint,
  count,
  countSuffix = "",
  checked,
  onChange,
  bare = false,
}: {
  label: string
  hint: string
  count: number
  countSuffix?: string
  checked: boolean
  onChange: () => void
  /** No padding or border of its own (the caller supplies them). */
  bare?: boolean
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 ${bare ? "" : "p-3"}`}
    >
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
      <span className="font-semibold tabular-nums">
        {count}
        <span className="font-normal text-muted-foreground">{countSuffix}</span>
      </span>
    </label>
  )
}
