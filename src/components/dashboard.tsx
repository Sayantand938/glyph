import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { UploadIcon } from "lucide-react"

import { DeleteDeckDialog, RenameDeckDialog } from "@/components/deck-dialogs"
import { DeckTree, type StudyScope } from "@/components/deck-tree"
import { Button } from "@/components/ui/button"
import { loadDashboard } from "@/db/queries"
import type { Deck } from "@/db/types"
import { useStoredState } from "@/hooks/use-stored-state"
import {
  DEFAULT_NEW_LIMIT,
  remainingNew as remainingNewToday,
  studyDayStart,
} from "@/lib/queue"

const MAX_NEW_LIMIT = 9999
const TICK_MS = 60_000

function parseLimit(stored: unknown): number | null {
  return typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= 0 &&
    stored <= MAX_NEW_LIMIT
    ? stored
    : null
}

function parseIds(stored: unknown): string[] | null {
  return Array.isArray(stored) && stored.every((v) => typeof v === "string")
    ? (stored as string[])
    : null
}

export function Dashboard({
  onStudy,
  onImportJson,
  onImportBackup,
}: {
  onStudy: (scope: StudyScope, newLimit: number) => void
  onImportJson: () => void
  onImportBackup: () => void
}) {
  // Re-read every minute so cards that become due, and the 04:00 day rollover,
  // show up without a reload.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const dayStart = studyDayStart(now)
  const data = useLiveQuery(() => loadDashboard(now, dayStart), [now, dayStart])

  const [limit, setLimit] = useStoredState(
    "glyph.newLimit",
    DEFAULT_NEW_LIMIT,
    parseLimit
  )
  const [limitDraft, setLimitDraft] = React.useState(String(limit))
  const [collapsedIds, setCollapsedIds] = useStoredState<string[]>(
    "glyph.collapsed",
    [],
    parseIds
  )
  const collapsed = React.useMemo(() => new Set(collapsedIds), [collapsedIds])

  const [renaming, setRenaming] = React.useState<Deck | null>(null)
  const [deleting, setDeleting] = React.useState<Deck | null>(null)

  if (!data) {
    return (
      <p className="py-8 text-sm text-muted-foreground" role="status">
        Loading...
      </p>
    )
  }

  const remaining = remainingNewToday(limit, data.introducedToday)

  if (data.subjects.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p className="text-lg font-semibold tracking-tight">No decks yet.</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Import a JSON file of questions, or restore a backup.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onImportJson}>
            <UploadIcon data-icon="inline-start" />
            Import JSON
          </Button>
          <Button variant="outline" onClick={onImportBackup}>
            Import Backup
          </Button>
        </div>
      </div>
    )
  }

  const siblings = renaming
    ? renaming.parentId === null
      ? data.subjects
      : (data.topics.get(renaming.parentId) ?? [])
    : []

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <p>
          {data.introducedToday} new today
          {" \u00b7 "}
          {remaining} left
        </p>
        <label className="flex items-center gap-2">
          New cards/day
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_NEW_LIMIT}
            value={limitDraft}
            onChange={(e) => {
              setLimitDraft(e.target.value)
              const next = parseLimit(Number(e.target.value))
              if (e.target.value.trim() !== "" && next !== null) setLimit(next)
            }}
            onBlur={() => setLimitDraft(String(limit))}
            className="h-7 w-16 rounded-lg border border-input bg-background px-2 text-right text-sm text-foreground tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      </div>

      <DeckTree
        data={data}
        remainingNew={remaining}
        collapsed={collapsed}
        onToggle={(id) =>
          setCollapsedIds(
            collapsed.has(id)
              ? collapsedIds.filter((x) => x !== id)
              : [...collapsedIds, id]
          )
        }
        onStudy={(scope) => onStudy(scope, remaining)}
        onRename={setRenaming}
        onDelete={setDeleting}
      />

      <RenameDeckDialog
        deck={renaming}
        siblings={siblings}
        onClose={() => setRenaming(null)}
      />
      <DeleteDeckDialog
        deck={deleting}
        topicCount={deleting ? (data.topics.get(deleting.id)?.length ?? 0) : 0}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
