import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData } from "@/db/queries"
import type { Deck } from "@/db/types"
import {
  ZERO_COUNTS,
  addCounts,
  totalCount,
  type DeckCounts,
} from "@/lib/queue"

export interface StudyScope {
  kind: "subject" | "topic"
  id: string
  name: string
}

const cell = "w-9 shrink-0 text-right tabular-nums"

function CountCells({ counts }: { counts: DeckCounts }) {
  const show = (n: number) => (
    <span className={n === 0 ? "text-muted-foreground/60" : "font-semibold"}>
      {n}
    </span>
  )
  return (
    <>
      <span className={cell}>{show(counts.new)}</span>
      <span className={cell}>{show(counts.learning)}</span>
      <span className={cell}>{show(counts.due)}</span>
    </>
  )
}

function DeckRow({
  deck,
  counts,
  scope,
  expanded,
  onToggle,
  onStudy,
  onRename,
  onDelete,
}: {
  deck: Deck
  counts: DeckCounts
  scope: StudyScope
  /** undefined for a Topic (no chevron). */
  expanded?: boolean
  onToggle?: () => void
  onStudy: (scope: StudyScope) => void
  onRename: (deck: Deck) => void
  onDelete: (deck: Deck) => void
}) {
  const isSubject = scope.kind === "subject"
  const label = isSubject ? "subject" : "topic"
  const available = totalCount(counts) > 0

  return (
    <div
      className={`flex items-center gap-1 py-1.5 ${isSubject ? "" : "pl-6"}`}
    >
      {isSubject ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {expanded ? (
            <ChevronDownIcon className="size-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
          )}
          <span className="truncate font-semibold">{deck.name}</span>
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate py-1">{deck.name}</span>
      )}

      <CountCells counts={counts} />

      <Button
        variant={available ? "default" : "outline"}
        size="sm"
        className="ml-1 w-14"
        disabled={!available}
        aria-label={`Study ${label} ${deck.name}`}
        onClick={() => onStudy(scope)}
      >
        Study
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Actions for ${label} ${deck.name}`}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onRename(deck)}>
            <PencilIcon aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDelete(deck)}>
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function DeckTree({
  data,
  collapsed,
  onToggle,
  onStudy,
  onRename,
  onDelete,
}: {
  data: DashboardData
  collapsed: ReadonlySet<string>
  onToggle: (subjectId: string) => void
  onStudy: (scope: StudyScope) => void
  onRename: (deck: Deck) => void
  onDelete: (deck: Deck) => void
}) {
  return (
    <div className="flex flex-col text-sm">
      <div
        aria-hidden
        className="flex items-center gap-1 border-b pb-1 text-[0.7rem] text-muted-foreground uppercase"
      >
        <span className="flex-1" />
        <span className={cell}>New</span>
        <span className={cell}>Lrn</span>
        <span className={cell}>Due</span>
        {/* Matches the Study button (ml-1 + w-14) and the actions button. */}
        <span className="ml-1 w-14 shrink-0" />
        <span className="w-7 shrink-0" />
      </div>

      {data.subjects.map((subject) => {
        const topics = data.topics.get(subject.id) ?? []
        const topicCounts = (id: string) => data.counts.get(id) ?? ZERO_COUNTS
        const subjectCounts = topics.reduce(
          (sum, t) => addCounts(sum, topicCounts(t.id)),
          ZERO_COUNTS
        )
        const isOpen = !collapsed.has(subject.id)

        return (
          <div key={subject.id} className="border-b last:border-b-0">
            <DeckRow
              deck={subject}
              counts={subjectCounts}
              scope={{ kind: "subject", id: subject.id, name: subject.name }}
              expanded={isOpen}
              onToggle={() => onToggle(subject.id)}
              onStudy={onStudy}
              onRename={onRename}
              onDelete={onDelete}
            />
            {isOpen &&
              (topics.length === 0 ? (
                <p className="pb-2 pl-6 text-xs text-muted-foreground">
                  No topics yet. Import a JSON file into this subject.
                </p>
              ) : (
                topics.map((topic) => (
                  <DeckRow
                    key={topic.id}
                    deck={topic}
                    counts={topicCounts(topic.id)}
                    scope={{ kind: "topic", id: topic.id, name: topic.name }}
                    onStudy={onStudy}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                ))
              ))}
          </div>
        )
      })}
    </div>
  )
}
