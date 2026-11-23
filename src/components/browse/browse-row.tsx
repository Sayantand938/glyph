import {
  CopyIcon,
  EllipsisVerticalIcon,
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
import { formatDue, stateLabel, type BrowseRow } from "@/lib/browse"

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

const cell = "px-1.5 py-2 align-middle"

/** One question as a table row. Edit, Copy and Delete live in the Actions menu. */
export function BrowseListRow({
  row,
  where,
  now,
  onEdit,
  onCopy,
  onDelete,
}: {
  row: BrowseRow
  /** "Physics > Mechanics" for a mixed list, the topic name inside one Subject or Topic. */
  where: string
  now: number
  onEdit: (id: string) => void
  onCopy: (id: string) => void
  onDelete: (id: string) => void
}) {
  const preview = row.preview || "(empty question)"

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/40">
      <td className={`${cell} text-xs whitespace-nowrap text-muted-foreground`}>
        {row.sl === "" ? "-" : row.sl}
      </td>
      <td className={`${cell} min-w-56 text-sm`}>
        <span className="line-clamp-2 break-words">{preview}</span>
      </td>
      <td className={`${cell} text-xs whitespace-nowrap text-muted-foreground`}>
        {where}
      </td>
      <td className={cell}>
        <StateBadge state={row.state} />
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
            <DropdownMenuItem onClick={() => onCopy(row.id)}>
              <CopyIcon aria-hidden />
              Copy as JSON
            </DropdownMenuItem>
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
