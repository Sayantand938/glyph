import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  SearchIcon,
} from "lucide-react"

import { DeleteNotePage } from "@/components/delete-note-page"
import type { StudyScope } from "@/components/deck-tree"
import { EditNotePage } from "@/components/edit-note-page"
import { Button } from "@/components/ui/button"
import { FlagGlyph } from "@/components/flag-icon"
import { loadBrowseItems } from "@/db/queries"
import { buryCard, setFlag, setSuspended, unburyCard } from "@/db/repo"
import { useHistoryLayer } from "@/hooks/use-history-layer"
import { useScrollRestore } from "@/hooks/use-scroll-restore"
import {
  BROWSE_FILTERS,
  defaultDirection,
  filterCounts,
  filterRows,
  flagCounts,
  noteAsJson,
  sortRows,
  type BrowseFilter,
  type BrowseSort,
  type SortDirection,
} from "@/lib/browse"
import { flagName, isBuried } from "@/lib/card-marks"
import { tagCounts } from "@/lib/tags"

import { BrowseListRow } from "./browse-row"
import { copyText } from "./copy-text"

const PAGE_SIZE = 100
const TICK_MS = 60_000
const MESSAGE_MS = 3_000

const inputClass =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

const COLUMNS: { label: string; sort: BrowseSort; align?: "right" }[] = [
  { label: "Flag", sort: "flag" },
  { label: "No.", sort: "number" },
  { label: "Question", sort: "question" },
  { label: "Topic", sort: "topic" },
  { label: "Tags", sort: "tags" },
  { label: "State", sort: "state" },
  { label: "Due", sort: "due" },
  { label: "Reps", sort: "reps", align: "right" },
  { label: "Lapses", sort: "lapses", align: "right" },
  { label: "Difficulty", sort: "difficulty", align: "right" },
]

function SortHeader({
  label,
  sort,
  active,
  direction,
  align,
  onSort,
}: {
  label: string
  sort: BrowseSort
  active: BrowseSort
  direction: SortDirection
  align?: "right"
  onSort: (sort: BrowseSort) => void
}) {
  const on = active === sort
  return (
    <th
      scope="col"
      className="px-1.5 py-1.5 font-normal"
      aria-sort={
        on ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={`inline-flex w-full items-center gap-0.5 whitespace-nowrap uppercase hover:text-foreground ${align === "right" ? "justify-end" : ""}`}
      >
        {label}
        {on &&
          (direction === "asc" ? (
            <ArrowUpIcon className="size-3" aria-hidden />
          ) : (
            <ArrowDownIcon className="size-3" aria-hidden />
          ))}
      </button>
    </th>
  )
}

/**
 * Browse the questions of a Subject, a Topic or everything (`scope` null):
 * search, filter by state, sort by any column, and edit or delete a question
 * (or copy it as JSON) from its Actions menu. The table scrolls sideways on narrow screens. Rows
 * are read live; editing and deleting open as full pages in place of the list
 * (which keeps its search, filters and scroll position).
 */
export function BrowsePage({
  scope,
  onBack,
}: {
  scope: StudyScope | null
  onBack: () => void
}) {
  useHistoryLayer(onBack)

  // Re-read every minute so due labels and the Due filter stay current.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const scopeKind = scope?.kind ?? null
  const scopeId = scope?.id ?? null
  const items = useLiveQuery(
    () =>
      loadBrowseItems(
        scopeKind && scopeId ? { kind: scopeKind, id: scopeId } : null
      ),
    [scopeKind, scopeId]
  )

  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<BrowseFilter>("all")
  const [sort, setSort] = React.useState<BrowseSort>("number")
  const [direction, setDirection] = React.useState<SortDirection>("asc")
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])
  const [selectedFlags, setSelectedFlags] = React.useState<number[]>([])
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<{
    text: string
    error: boolean
  } | null>(null)

  // A confirmation (or failure) for the last Copy, gone after a few seconds.
  React.useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message])

  const rows = React.useMemo(() => (items ?? []).map((i) => i.row), [items])
  const notes = React.useMemo(
    () => new Map((items ?? []).map((i) => [i.note.id, i.note])),
    [items]
  )
  const editingNote = editingId ? (notes.get(editingId) ?? null) : null
  const deletingNote = deletingId ? (notes.get(deletingId) ?? null) : null
  useScrollRestore(editingNote !== null || deletingNote !== null)
  const counts = React.useMemo(() => filterCounts(rows, now), [rows, now])
  const tags = React.useMemo(() => tagCounts(rows.map((r) => r.tags)), [rows])
  const flags = React.useMemo(() => flagCounts(rows), [rows])
  const rowById = React.useMemo(
    () => new Map(rows.map((r) => [r.id, r])),
    [rows]
  )
  // A selected flag that no question carries any more (cleared) is ignored.
  const activeFlags = React.useMemo(
    () => selectedFlags.filter((f) => flags.some((x) => x.flag === f)),
    [selectedFlags, flags]
  )
  // A selected tag that no question carries any more (edited away) is ignored.
  const activeTags = React.useMemo(
    () => selectedTags.filter((t) => tags.some((x) => x.tag === t)),
    [selectedTags, tags]
  )
  const shown = React.useMemo(
    () =>
      sortRows(
        filterRows(
          rows,
          { query, filter, tags: activeTags, flags: activeFlags },
          now
        ),
        sort,
        direction
      ),
    [rows, query, filter, activeTags, activeFlags, now, sort, direction]
  )

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag]
    )
    setLimit(PAGE_SIZE)
  }

  function toggleFlagFilter(flag: number) {
    setSelectedFlags((current) =>
      current.includes(flag)
        ? current.filter((f) => f !== flag)
        : [...current, flag]
    )
    setLimit(PAGE_SIZE)
  }

  /** Runs a card-mark write; a failure shows in the message line like a failed copy. */
  async function mark(action: () => Promise<void>, failure: string) {
    try {
      await action()
    } catch {
      setMessage({ text: failure, error: true })
    }
  }

  function flagRow(id: string, flag: number) {
    void mark(() => setFlag(id, flag), "Could not set the flag.")
  }

  function suspendRow(id: string) {
    const suspended = rowById.get(id)?.suspended ?? false
    void mark(() => setSuspended(id, !suspended), "Could not update the card.")
  }

  function buryRow(id: string) {
    const row = rowById.get(id)
    const buried = row ? isBuried(row, now) : false
    void mark(
      () => (buried ? unburyCard(id) : buryCard(id)),
      "Could not update the card."
    )
  }

  function chooseSort(next: BrowseSort) {
    if (next === sort) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSort(next)
      setDirection(defaultDirection(next))
    }
    setLimit(PAGE_SIZE)
  }

  async function copyQuestion(id: string) {
    const note = notes.get(id)
    if (!note) return
    try {
      await copyText(noteAsJson(note))
      setMessage({ text: "Copied the question as JSON.", error: false })
    } catch {
      setMessage({
        text: "Couldn't copy to the clipboard. Open the question and copy it by hand.",
        error: true,
      })
    }
  }

  // Inside one Subject or Topic the Subject name is redundant.
  // A tag list spans decks, so it shows the full path like the all-questions list.
  const where = (rowSubject: string, rowTopic: string): string =>
    scope && scope.kind !== "tag" ? rowTopic : `${rowSubject} > ${rowTopic}`

  if (editingNote) {
    return (
      <EditNotePage
        key={editingNote.id}
        note={editingNote}
        onClose={() => setEditingId(null)}
      />
    )
  }
  if (deletingNote) {
    return (
      <DeleteNotePage
        key={deletingNote.id}
        note={deletingNote}
        onClose={() => setDeletingId(null)}
      />
    )
  }

  const title = scope ? scope.name : "All questions"
  const filtering =
    query.trim() !== "" ||
    filter !== "all" ||
    activeTags.length > 0 ||
    activeFlags.length > 0

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {title}
        </h2>
        {items && (
          <span
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {filtering ? `${shown.length} of ${rows.length}` : rows.length}{" "}
            {rows.length === 1 ? "question" : "questions"}
          </span>
        )}
      </div>

      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className="rounded-lg border px-3 py-2 text-xs"
        >
          {message.text}
        </p>
      )}

      {!items ? (
        <p className="py-4 text-sm text-muted-foreground" role="status">
          Loading...
        </p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No questions here yet. Import a JSON file from Settings.
        </p>
      ) : (
        <>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              className={`${inputClass} w-full pl-8`}
              placeholder="Search questions"
              aria-label="Search questions"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(PAGE_SIZE)
              }}
            />
          </div>

          <div
            role="group"
            aria-label="Filter by state"
            className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:hidden"
          >
            {BROWSE_FILTERS.map(({ value, label }) => (
              <Button
                key={value}
                variant={filter === value ? "default" : "outline"}
                size="sm"
                className="shrink-0"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value)
                  setLimit(PAGE_SIZE)
                }}
              >
                {label}
                <span className="tabular-nums opacity-70">{counts[value]}</span>
              </Button>
            ))}
          </div>

          {tags.length > 0 && (
            <div
              role="group"
              aria-label="Filter by tag"
              className="-mx-1 flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:hidden"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                Tags
              </span>
              {tags.map(({ tag, count }) => {
                const on = activeTags.includes(tag)
                return (
                  <Button
                    key={tag}
                    variant={on ? "default" : "outline"}
                    size="sm"
                    className="shrink-0"
                    aria-pressed={on}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </Button>
                )
              })}
            </div>
          )}

          {flags.length > 0 && (
            <div
              role="group"
              aria-label="Filter by flag"
              className="-mx-1 flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:hidden"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                Flags
              </span>
              {flags.map(({ flag, count }) => {
                const on = activeFlags.includes(flag)
                return (
                  <Button
                    key={flag}
                    variant={on ? "default" : "outline"}
                    size="sm"
                    className="shrink-0"
                    aria-pressed={on}
                    aria-label={`${flagName(flag)} flag, ${count}`}
                    title={`${flagName(flag)} flag`}
                    onClick={() => toggleFlagFilter(flag)}
                  >
                    <FlagGlyph flag={flag} labelled={false} />
                    <span className="tabular-nums opacity-70">{count}</span>
                  </Button>
                )
              })}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-4 text-sm">
              <p className="text-muted-foreground">
                No questions match
                {query.trim() ? ` "${query.trim()}"` : " these filters"}.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("")
                  setFilter("all")
                  setSelectedTags([])
                  setSelectedFlags([])
                }}
              >
                Clear search and filters
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[60rem] border-collapse text-left">
                  <thead className="border-b text-[0.7rem] text-muted-foreground">
                    <tr>
                      {COLUMNS.map(({ label, sort: key, align }) => (
                        <SortHeader
                          key={key}
                          label={label}
                          sort={key}
                          active={sort}
                          direction={direction}
                          align={align}
                          onSort={chooseSort}
                        />
                      ))}
                      <th
                        scope="col"
                        className="sticky right-0 border-l bg-background px-1.5 py-1.5 text-center font-normal uppercase"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, limit).map((row) => (
                      <BrowseListRow
                        key={row.id}
                        row={row}
                        where={where(row.subjectName, row.topicName)}
                        now={now}
                        activeTags={activeTags}
                        onTag={toggleTag}
                        onEdit={setEditingId}
                        onCopy={(id) => void copyQuestion(id)}
                        onDelete={setDeletingId}
                        onFlag={flagRow}
                        onSuspend={suspendRow}
                        onBury={buryRow}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {shown.length > limit && (
                <Button
                  variant="outline"
                  className="self-center"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, shown.length - limit)} more (
                  {shown.length - limit} left)
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
