import * as React from "react"
import { PlusIcon, UploadIcon } from "lucide-react"

import { CreateDeckPage } from "@/components/deck-pages"
import { DeckTree, type StudyScope } from "@/components/deck-tree"
import { Button } from "@/components/ui/button"
import { LoadingBlock } from "@/components/ui/spinner"
import { useLiveQuery } from "@/hooks/use-live-query"
import { loadDashboard } from "@/db/queries"
import { useStoredState } from "@/hooks/use-stored-state"

const TICK_MS = 60_000

function parseIds(stored: unknown): string[] | null {
  return Array.isArray(stored) && stored.every((v) => typeof v === "string")
    ? (stored as string[])
    : null
}

export function Dashboard({
  onOpen,
  onImportJson,
  onImportBackup,
}: {
  /** A deck was clicked: open its screen (study, browse, add, rename, delete). */
  onOpen: (scope: StudyScope) => void
  onImportJson: () => void
  onImportBackup: () => void
}) {
  // Re-read every minute so cards that become due show up without a reload.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const data = useLiveQuery(
    () => loadDashboard(now),
    [now],
    ["decks", "notes", "cards"]
  )

  const [collapsedIds, setCollapsedIds] = useStoredState<string[]>(
    "glyph.collapsed",
    [],
    parseIds
  )
  const collapsed = React.useMemo(() => new Set(collapsedIds), [collapsedIds])

  const [creating, setCreating] = React.useState(false)

  if (!data) return <LoadingBlock label="Loading your decks" />

  const topLevel = data.children.get(null) ?? []

  if (creating) {
    return (
      <CreateDeckPage
        parent={null}
        siblings={topLevel}
        onClose={() => setCreating(false)}
      />
    )
  }

  if (topLevel.length === 0) {
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
          <Button variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New deck
          </Button>
          <Button variant="outline" onClick={onImportBackup}>
            Import Backup
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <DeckTree
        data={data}
        collapsed={collapsed}
        onToggle={(id) =>
          setCollapsedIds(
            collapsed.has(id)
              ? collapsedIds.filter((x) => x !== id)
              : [...collapsedIds, id]
          )
        }
        onOpen={onOpen}
      />
      <div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <PlusIcon data-icon="inline-start" />
          New deck
        </Button>
      </div>
    </div>
  )
}
