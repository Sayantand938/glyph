import {
  ArrowLeftIcon,
  KeyboardIcon,
  PencilIcon,
  ShuffleIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

import { KEYBOARD_HELP } from "./helpers"

export function SessionToolbar({
  scopeName,
  counter,
  shuffle,
  canUndo,
  canEdit,
  onExit,
  onToggleShuffle,
  onUndo,
  onEdit,
  onDelete,
}: {
  scopeName: string
  counter: string
  shuffle: boolean
  canUndo: boolean
  canEdit: boolean
  onExit: () => void
  onToggleShuffle: () => void
  onUndo: () => void
  onEdit: () => void
  onDelete: () => void
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
        aria-label="Undo last answer"
        title="Undo (Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2Icon />
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
      <span
        className="flex size-8 items-center justify-center text-muted-foreground"
        title={KEYBOARD_HELP}
      >
        <KeyboardIcon className="size-4" aria-label="Keyboard shortcuts" />
      </span>
    </div>
  )
}
