import {
  CopyIcon,
  EllipsisVerticalIcon,
  HistoryIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

import { CardMarkItems } from "@/components/card-mark-items"
import { FlagGlyph } from "@/components/flag-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDue, stateLabel, type BrowseRow } from "@/lib/browse"
import { isBuried } from "@/lib/card-marks"

const STATE_STYLE: Record<number, string> = {
  0: "border-border",
  1: "border-amber-500/60 text-amber-700 dark:text-amber-400",
  2: "border-emerald-600/50 text-emerald-700 dark:text-emerald-400",
  3: "border-amber-500/60 text-amber-700 dark:text-amber-400",
}

function StateBadge({ state }: { state: number }) {
  return (
    <span
      className={`rounded border px-1 text-[0.7rem] leading-4 ${STATE_STYLE[state] ?? "border-border"}`}
    >
      {stateLabel(state)}
    </span>
  )
}

/** Suspended / buried: why a card is not being studied, next to its state. */
function HiddenBadge({ label }: { label: string }) {
  return (
    <span className="rounded border border-amber-500/60 px-1 text-[0.7rem] leading-4 text-amber-700 dark:text-amber-400">
      {label}
    </span>
  )
}

const cell = "px-1.5 py-2 align-middle"

const MAX_CHIPS = 3

/** Up to three tags as small buttons that filter the list; the rest as "+n". */
function TagChips({
  tags,
  active,
  onTag,
}: {
  tags: readonly string[]
  active: readonly string[]
  onTag: (tag: string) => void
}) {
  if (tags.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, MAX_CHIPS).map((tag) => (
        <button
          key={tag}
          type="button"
          aria-pressed={active.includes(tag)}
          title={`Filter by ${tag}`}
          onClick={() => onTag(tag)}
          className={`max-w-28 truncate rounded border px-1 text-[0.7rem] leading-4 hover:bg-muted ${
            active.includes(tag) ? "border-foreground" : "text-muted-foreground"
          }`}
        >
          {tag}
        </button>
      ))}
      {tags.length > MAX_CHIPS && (
        <span
          className="text-[0.7rem] leading-4 text-muted-foreground"
          title={tags.slice(MAX_CHIPS).join(", ")}
        >
          +{tags.length - MAX_CHIPS}
        </span>
      )}
    </span>
  )
}

/** One question as a table row. Edit, Copy and Delete live in the Actions menu. */
export function BrowseListRow({
  row,
  where,
  now,
  activeTags,
  onTag,
  onEdit,
  onHistory,
  onCopy,
  onDelete,
  onFlag,
  onSuspend,
  onBury,
}: {
  row: BrowseRow
  /** The deck's full path, "Physics > Mechanics". */
  where: string
  now: number
  /** Tags currently used as a filter, shown highlighted. */
  activeTags: readonly string[]
  /** A tag chip was clicked: toggle it as a filter. */
  onTag: (tag: string) => void
  onEdit: (id: string) => void
  /** Open the question's review history page. */
  onHistory: (id: string) => void
  onCopy: (id: string) => void
  onDelete: (id: string) => void
  /** 0 clears the flag. */
  onFlag: (id: string, flag: number) => void
  /** Suspends the card, or unsuspends it if it is suspended. */
  onSuspend: (id: string) => void
  /** Buries the card until tomorrow, or unburies it if it is buried. */
  onBury: (id: string) => void
}) {
  const preview = row.preview || "(empty question)"
  const buried = isBuried(row, now)

  return (
    <tr
      className={`border-b last:border-b-0 hover:bg-muted/40 ${
        row.suspended ? "bg-amber-500/10" : buried ? "bg-muted/50" : ""
      }`}
    >
      <td className={`${cell} w-8`}>
        {row.flag > 0 ? (
          <FlagGlyph flag={row.flag} className="size-4" />
        ) : (
          <span className="text-xs text-muted-foreground" aria-label="No flag">
            -
          </span>
        )}
      </td>
      <td className={`${cell} text-xs whitespace-nowrap text-muted-foreground`}>
        {row.sl === "" ? "-" : row.sl}
      </td>
      <td className={`${cell} min-w-56 text-sm`}>
        <span className="line-clamp-2 break-words">{preview}</span>
      </td>
      <td className={`${cell} text-xs whitespace-nowrap text-muted-foreground`}>
        {where}
      </td>
      <td className={`${cell} max-w-44`}>
        <TagChips tags={row.tags} active={activeTags} onTag={onTag} />
      </td>
      <td className={cell}>
        <span className="flex flex-wrap gap-1">
          <StateBadge state={row.state} />
          {row.suspended && <HiddenBadge label="Suspended" />}
          {buried && <HiddenBadge label="Buried" />}
        </span>
      </td>
      <td className={`${cell} text-xs whitespace-nowrap`}>
        {formatDue(row, now)}
      </td>
      <td className={`${cell} text-right text-xs tabular-nums`}>{row.reps}</td>
      <td className={`${cell} text-right text-xs tabular-nums`}>
        {row.lapses}
      </td>
      <td className={`${cell} text-right text-xs tabular-nums`}>
        {row.reps === 0 ? "-" : row.difficulty.toFixed(1)}
      </td>
      {/* Stays in view while the table scrolls sideways. */}
      <td
        className={`${cell} sticky right-0 border-l bg-background text-center`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label={`Actions for question: ${preview}`}
          >
            <EllipsisVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onEdit(row.id)}>
              <PencilIcon aria-hidden />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onHistory(row.id)}>
              <HistoryIcon aria-hidden />
              Review history
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCopy(row.id)}>
              <CopyIcon aria-hidden />
              Copy as JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <CardMarkItems
              flag={row.flag}
              suspended={row.suspended}
              buried={buried}
              onFlag={(flag) => onFlag(row.id, flag)}
              onSuspend={() => onSuspend(row.id)}
              onBury={() => onBury(row.id)}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(row.id)}>
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}
