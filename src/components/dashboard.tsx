import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { UploadIcon } from "lucide-react"

import { DeleteDeckPage, RenameDeckPage } from "@/components/deck-pages"
import { DeckTree, type StudyScope } from "@/components/deck-tree"
import { TagList } from "@/components/tag-list"
import { Button } from "@/components/ui/button"
import { loadDashboard } from "@/db/queries"
import type { Deck } from "@/db/types"
import { useScrollRestore } from "@/hooks/use-scroll-restore"
import { useStoredState } from "@/hooks/use-stored-state"

const TICK_MS = 60_000

function parseFlag(stored: unknown): boolean | null {
  return typeof stored === "boolean" ? stored : null
}

function parseIds(stored: unknown): string[] | null {
  return Array.isArray(stored) && stored.every((v) => typeof v === "string")
    ? (stored as string[])
    : null
}

export function Dashboard({
  onStudy,
  onBrowse,
  onImportJson,
  onImportBackup,
}: {
  onStudy: (scope: StudyScope) => void
  onBrowse: (scope: StudyScope) => void
  onImportJson: () => void
  onImportBackup: () => void
}) {
  // Re-read every minute so cards that become due show up without a reload.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const data = useLiveQuery(() => loadDashboard(now), [now])

  const [collapsedIds, setCollapsedIds] = useStoredState<string[]>(
    "glyph.collapsed",
    [],
    parseIds
  )
  const collapsed = React.useMemo(() => new Set(collapsedIds), [collapsedIds])

  const [tagsCollapsed, setTagsCollapsed] = useStoredState(
    "glyph.tagsCollapsed",
    false,
    parseFlag
  )

  const [renaming, setRenaming] = React.useState<Deck | null>(null)
  const [deleting, setDeleting] = React.useState<Deck | null>(null)
  useScrollRestore(renaming !== null || deleting !== null)

  if (!data) {
    return (
      <p className="py-8 text-sm text-muted-foreground" role="status">
        Loading...
      </p>
    )
  }

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

  if (renaming) {
    return (
      <RenameDeckPage
        key={renaming.id}
        deck={renaming}
        siblings={siblings}
        onClose={() => setRenaming(null)}
      />
    )
  }
  if (deleting) {
    return (
      <DeleteDeckPage
        key={deleting.id}
        deck={deleting}
        topicCount={data.topics.get(deleting.id)?.length ?? 0}
        onClose={() => setDeleting(null)}
      />
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
        onStudy={onStudy}
        onBrowse={onBrowse}
        onRename={setRenaming}
        onDelete={setDeleting}
      />

      <TagList
        tags={data.tags}
        collapsed={tagsCollapsed}
        onToggle={() => setTagsCollapsed(!tagsCollapsed)}
        onStudy={onStudy}
        onBrowse={onBrowse}
      />
    </div>
  )
}
