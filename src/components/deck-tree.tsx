import * as React from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"

import type { DashboardData } from "@/db/queries"
import { flattenTree, rollupCounts, type TreeRow } from "@/lib/deck-tree"
import { ZERO_COUNTS, type DeckCounts } from "@/lib/queue"

export interface StudyScope {
  /** A deck covers everything below it too. A tag spans every deck: `id` is then the tag itself and `name` is "#tag". */
  kind: "deck" | "tag"
  id: string
  name: string
  /** A deck with sub-decks mixes their cards in one session (set by the deck screen). */
  mixed?: boolean
}

export const cell = "w-9 shrink-0 text-right tabular-nums"

/** Width of one level of the tree (and of the chevron column), and where its line runs. */
const LEVEL = "w-6"
const LINE = "border-muted-foreground/40"

export function CountCells({ counts }: { counts: DeckCounts }) {
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

/**
 * The connector lines to the left of a row, like a file tree: a vertical line
 * wherever an ancestor has more siblings below, and this row's own elbow (a
 * line down from its parent, with a stub to the right; it carries on down when
 * the row has later siblings).
 */
function Gutter({ row }: { row: TreeRow }) {
  if (row.depth === 0) return null
  const cells: React.ReactNode[] = row.lines.map((through, i) => (
    <span key={i} className={`relative self-stretch ${LEVEL} shrink-0`}>
      {through && (
        <span
          className={`absolute inset-y-0 left-3 border-l ${LINE}`}
          aria-hidden
        />
      )}
    </span>
  ))
  cells.push(
    <span key="elbow" className={`relative self-stretch ${LEVEL} shrink-0`}>
      <span
        className={`absolute top-0 left-3 border-l ${LINE} ${
          row.isLast ? "h-1/2" : "bottom-0"
        }`}
        aria-hidden
      />
      <span
        className={`absolute top-1/2 left-3 border-t ${LINE} ${
          row.hasChildren ? "w-3" : "w-6"
        }`}
        aria-hidden
      />
    </span>
  )
  return <>{cells}</>
}

function DeckRow({
  row,
  counts,
  onToggle,
  onOpen,
}: {
  row: TreeRow
  counts: DeckCounts
  onToggle: (id: string) => void
  onOpen: (scope: StudyScope) => void
}) {
  const { deck } = row
  return (
    <div
      className={`flex items-stretch ${row.depth === 0 ? "border-t first:border-t-0" : ""}`}
    >
      <Gutter row={row} />

      {row.hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(deck.id)}
          aria-expanded={row.expanded}
          aria-label={`${row.expanded ? "Collapse" : "Expand"} ${deck.name}`}
          className={`flex ${LEVEL} shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50`}
        >
          {row.expanded ? (
            <ChevronDownIcon className="size-4" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-4" aria-hidden />
          )}
        </button>
      ) : (
        <span className={`${LEVEL} shrink-0`} aria-hidden />
      )}

      {/* The whole row (name and counts) opens the deck. */}
      <button
        type="button"
        onClick={() => onOpen({ kind: "deck", id: deck.id, name: deck.name })}
        aria-label={`Open deck ${deck.name}`}
        className="group my-0.5 flex min-w-0 flex-1 items-center gap-1 rounded-lg py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={`min-w-0 flex-1 truncate pl-1 ${row.depth === 0 ? "font-semibold" : ""}`}
        >
          {deck.name}
        </span>
        <CountCells counts={counts} />
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
    </div>
  )
}

export function DeckTree({
  data,
  collapsed,
  onToggle,
  onOpen,
}: {
  data: DashboardData
  collapsed: ReadonlySet<string>
  onToggle: (deckId: string) => void
  onOpen: (scope: StudyScope) => void
}) {
  // A deck's numbers include everything below it, whether or not it is open.
  const totals = React.useMemo(
    () => rollupCounts(data.children, data.counts),
    [data.children, data.counts]
  )
  const rows = React.useMemo(
    () => flattenTree(data.children, collapsed),
    [data.children, collapsed]
  )

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
        {/* Matches the arrow at the end of each row. */}
        <span className="size-4 shrink-0" />
      </div>

      {rows.map((row) => (
        <DeckRow
          key={row.deck.id}
          row={row}
          counts={totals.get(row.deck.id) ?? ZERO_COUNTS}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
