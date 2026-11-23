import * as React from "react"
import {
  ChevronRightIcon,
  ListIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import {
  CreateDeckPage,
  DeleteDeckPage,
  RenameDeckPage,
} from "@/components/deck-pages"
import type { StudyScope } from "@/components/deck-tree"
import { EditNotePage } from "@/components/edit-note-page"
import { StudyOptionsPage } from "@/components/study/study-options-page"
import { loadDeckInfo } from "@/db/queries"
import { useLiveQuery } from "@/hooks/use-live-query"
import { useScrollRestore } from "@/hooks/use-scroll-restore"
import { pathLabel } from "@/lib/deck-tree"
import type { StudyOptions } from "@/lib/study-options"

type SubView = "rename" | "delete" | "add" | "subdeck"

function ActionRow({
  icon,
  title,
  description,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3 bg-card p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted transition-colors group-hover:bg-background [&_svg]:size-4 ${
          danger ? "text-destructive" : "text-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm font-medium ${danger ? "text-destructive" : ""}`}
        >
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  )
}

/**
 * A deck's own screen, opened by clicking it on the home screen: the study
 * options with the Start button (`StudyOptionsPage`), and under them what used
 * to be the row's menu: browse its questions, add a question, add a sub-deck,
 * rename, delete. A deck covers everything inside it. Rename, delete, add and
 * new sub-deck are full pages in place of this one, like elsewhere.
 */
export function DeckPage({
  scope,
  locked,
  onBack,
  onStart,
  onBrowse,
}: {
  scope: StudyScope
  locked: boolean
  onBack: () => void
  /** Both get the scope with the deck's current name (it may have been renamed here). */
  onStart: (scope: StudyScope, options: StudyOptions) => void
  onBrowse: (scope: StudyScope) => void
}) {
  const isDeck = scope.kind !== "tag"
  const info = useLiveQuery(() => loadDeckInfo(scope.id), [scope.id], ["decks"])
  const [view, setView] = React.useState<SubView | null>(null)
  useScrollRestore(view !== null)

  // Deleting the deck (here, or from a synced device) leaves nothing to show.
  const gone = isDeck && info === null
  React.useEffect(() => {
    if (gone) onBack()
  }, [gone, onBack])

  const close = () => setView(null)
  const live: StudyScope = {
    ...scope,
    name: info?.deck.name ?? scope.name,
    mixed: info ? info.children.length > 0 : scope.mixed,
  }

  if (info && view === "rename") {
    return (
      <RenameDeckPage
        key={info.deck.id}
        deck={info.deck}
        siblings={info.siblings}
        onClose={close}
      />
    )
  }
  if (info && view === "delete") {
    return (
      <DeleteDeckPage
        key={info.deck.id}
        deck={info.deck}
        descendants={info.descendants}
        onClose={close}
      />
    )
  }
  if (info && view === "subdeck") {
    return (
      <CreateDeckPage
        key={info.deck.id}
        parent={info.deck}
        siblings={info.children}
        onClose={close}
      />
    )
  }
  if (info && view === "add") {
    return <EditNotePage create={{ topicId: info.deck.id }} onClose={close} />
  }

  // "WBCS > Mains" above a deck called "2018": where it sits.
  const above = info ? info.path.slice(0, -1) : []
  return (
    <StudyOptionsPage
      scope={live}
      locked={locked}
      description={
        above.length > 0
          ? `In ${pathLabel(above)}. Choose what to include in this session.`
          : undefined
      }
      onBack={onBack}
      onStart={(options) => onStart(live, options)}
    >
      {isDeck && info && (
        <div className="flex flex-col divide-y overflow-hidden rounded-lg border">
          <ActionRow
            icon={<ListIcon aria-hidden />}
            title="Browse questions"
            description={
              info.children.length > 0
                ? "Search and edit the questions in this deck and the decks inside it."
                : "Search and edit the questions in this deck."
            }
            onClick={() => onBrowse(live)}
          />
          <ActionRow
            icon={<PlusIcon aria-hidden />}
            title="Add new question"
            description="Write a question with four options, in this deck."
            onClick={() => setView("add")}
          />
          <ActionRow
            icon={<FolderPlusIcon aria-hidden />}
            title="Add sub-deck"
            description="Make a deck inside this one, to any depth."
            onClick={() => setView("subdeck")}
          />
          <ActionRow
            icon={<PencilIcon aria-hidden />}
            title="Rename deck"
            description="Questions and study progress are kept."
            onClick={() => setView("rename")}
          />
          <ActionRow
            icon={<Trash2Icon aria-hidden />}
            title="Delete deck"
            description={
              info.descendants > 0
                ? "Removes it, the decks inside it and all their questions from the app."
                : "Removes it and all its questions from the app."
            }
            danger
            onClick={() => setView("delete")}
          />
        </div>
      )}
    </StudyOptionsPage>
  )
}
