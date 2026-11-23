import {
  ArrowLeftIcon,
  FlagIcon,
  KeyboardIcon,
  PencilIcon,
  Redo2Icon,
  ShuffleIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"

import { CardMarkItems } from "@/components/card-mark-items"
import { FlagGlyph } from "@/components/flag-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { flagName } from "@/lib/card-marks"

import { KEYBOARD_HELP } from "./helpers"

export function SessionToolbar({
  scopeName,
  counter,
  shuffle,
  canUndo,
  canRedo,
  canEdit,
  flag,
  suspended,
  onExit,
  onToggleShuffle,
  onUndo,
  onRedo,
  onEdit,
  onDelete,
  onFlag,
  onSuspend,
  onBury,
  onHelp,
  onMenuOpenChange,
}: {
  scopeName: string
  counter: string
  shuffle: boolean
  canUndo: boolean
  canRedo: boolean
  canEdit: boolean
  /** The current card's flag (0 = none) and whether it is suspended. */
  flag: number
  suspended: boolean
  onExit: () => void
  onToggleShuffle: () => void
  onUndo: () => void
  onRedo: () => void
  onEdit: () => void
  onDelete: () => void
  onFlag: (flag: number) => void
  onSuspend: () => void
  onBury: () => void
  onHelp: () => void
  /** The flag menu opened or closed; the session's shortcuts pause while it is open. */
  onMenuOpenChange: (open: boolean) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Exit session"
        title="Exit (Esc)"
        onClick={onExit}
      >
        <ArrowLeftIcon />
      </Button>
      <div className="min-w-0 flex-1 text-center text-sm tabular-nums">
        <span className="sr-only">{scopeName}: </span>
        {counter}
      </div>
      <Button
        variant={shuffle ? "secondary" : "ghost"}
        size="icon"
        aria-label="Shuffle options"
        aria-pressed={shuffle}
        title={shuffle ? "Option shuffle: on" : "Option shuffle: off"}
        onClick={(e) => {
          e.currentTarget.blur()
          onToggleShuffle()
        }}
      >
        <ShuffleIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Undo last action"
        title="Undo (Z or Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Redo"
        title="Redo (Y or Ctrl+Y)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Edit question"
        title="Edit (E)"
        disabled={!canEdit}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" />}
          disabled={!canEdit}
          aria-label={
            flag > 0
              ? `Flag, suspend or bury (flagged ${flagName(flag)})`
              : "Flag, suspend or bury"
          }
          title="Flag, suspend or bury"
        >
          {flag > 0 ? <FlagGlyph flag={flag} labelled={false} /> : <FlagIcon />}
        </DropdownMenuTrigger>
        {/* Focus is not handed back to the button, or Space would reopen the menu. */}
        <DropdownMenuContent finalFocus={false}>
          <CardMarkItems
            shortcuts
            flag={flag}
            suspended={suspended}
            buried={false}
            onFlag={onFlag}
            onSuspend={onSuspend}
            onBury={onBury}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete question"
        title="Delete question"
        disabled={!canEdit}
        onClick={onDelete}
      >
        <Trash2Icon />
      </Button>
      {/* Shortcuts are for a physical keyboard, so the button is for wider screens. */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden sm:inline-flex"
        aria-label="Keyboard shortcuts"
        title={KEYBOARD_HELP}
        onClick={(e) => {
          e.currentTarget.blur()
          onHelp()
        }}
      >
        <KeyboardIcon />
      </Button>
    </div>
  )
}
