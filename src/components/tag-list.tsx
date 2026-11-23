import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ListIcon,
} from "lucide-react"

import { CountCells, cell, type StudyScope } from "@/components/deck-tree"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TagSummary } from "@/db/queries"
import { totalCount } from "@/lib/queue"

/** The scope that studies or browses every question carrying `tag`. */
function tagScope(tag: string): StudyScope {
  return { kind: "tag", id: tag, name: `#${tag}` }
}

function TagRow({
  summary,
  onStudy,
  onBrowse,
}: {
  summary: TagSummary
  onStudy: (scope: StudyScope) => void
  onBrowse: (scope: StudyScope) => void
}) {
  const { tag, counts } = summary
  const scope = tagScope(tag)
  const available = totalCount(counts) > 0

  return (
    <div className="flex items-center gap-1 py-1.5 pl-6">
      <span className="min-w-0 flex-1 truncate py-1">{scope.name}</span>

      <CountCells counts={counts} />

      <Button
        variant={available ? "default" : "outline"}
        size="sm"
        className="ml-1 w-14"
        disabled={!available}
        aria-label={`Study tag ${tag}`}
        onClick={() => onStudy(scope)}
      >
        Study
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Actions for tag ${tag}`}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onBrowse(scope)}>
            <ListIcon aria-hidden />
            Browse
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Every tag in use with its New / Learning / Due counts, laid out like the
 * deck tree. A tag spans Subjects and Topics, so studying one mixes them.
 * Renders nothing when no question has a tag.
 */
export function TagList({
  tags,
  collapsed,
  onToggle,
  onStudy,
  onBrowse,
}: {
  tags: readonly TagSummary[]
  collapsed: boolean
  onToggle: () => void
  onStudy: (scope: StudyScope) => void
  onBrowse: (scope: StudyScope) => void
}) {
  if (tags.length === 0) return null

  const open = !collapsed
  return (
    <section aria-label="Tags" className="flex flex-col text-sm">
      <div className="flex items-center gap-1 border-b pb-1 text-[0.7rem] text-muted-foreground uppercase">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {open ? (
            <ChevronDownIcon className="size-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
          )}
          Tags ({tags.length})
        </button>
        <span aria-hidden className={cell}>
          New
        </span>
        <span aria-hidden className={cell}>
          Lrn
        </span>
        <span aria-hidden className={cell}>
          Due
        </span>
        {/* Matches the Study button (ml-1 + w-14) and the actions button. */}
        <span aria-hidden className="ml-1 w-14 shrink-0" />
        <span aria-hidden className="w-7 shrink-0" />
      </div>

      {open &&
        tags.map((summary) => (
          <TagRow
            key={summary.tag}
            summary={summary}
            onStudy={onStudy}
            onBrowse={onBrowse}
          />
        ))}
    </section>
  )
}
