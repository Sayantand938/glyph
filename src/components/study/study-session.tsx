import * as React from "react"

import { DeleteNotePage } from "@/components/delete-note-page"
import { EditNotePage } from "@/components/edit-note-page"
import { flagBorder } from "@/components/flag-style"
import { Button } from "@/components/ui/button"
import { LoadingBlock } from "@/components/ui/spinner"
import { useHistoryLayer } from "@/hooks/use-history-layer"
import type { StudyOptions } from "@/lib/study-options"

import type { StudyScope } from "../deck-tree"
import { EmptyState, FinishedState, GoneState } from "./end-states"
import { ExitPage } from "./exit-page"
import { hintFor } from "./helpers"
import { QuestionView } from "./question-view"
import { SessionToolbar } from "./session-toolbar"
import { ShortcutsPage } from "./shortcuts-page"
import { useStudyKeys } from "./use-study-keys"
import { useStudyRun } from "./use-study-run"

export function StudySession({
  scope,
  options,
  locked = false,
  onExit,
}: {
  scope: StudyScope
  options: StudyOptions
  /** A device sync is running: shortcuts are off until it ends. */
  locked?: boolean
  onExit: () => void
}) {
  const s = useStudyRun(scope, options)
  const { run, data } = s
  const [editing, setEditing] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmExit, setConfirmExit] = React.useState(false)
  const [help, setHelp] = React.useState(false)
  // While the flag menu is open it handles its own keys (Escape closes it).
  const [menuOpen, setMenuOpen] = React.useState(false)

  /** Leaves at once when nothing is in progress; otherwise asks first. */
  function requestExit(): boolean {
    if (!run || s.empty || s.finished) {
      onExit()
      return true
    }
    setConfirmExit(true)
    return false
  }

  // Back asks before leaving a session in progress (the prompt is its own
  // page, which Back then dismisses).
  useHistoryLayer(requestExit)

  useStudyKeys({
    active:
      run !== null &&
      !locked &&
      !editing &&
      !deleting &&
      !confirmExit &&
      !help &&
      !menuOpen,
    phase: run?.phase.kind ?? null,
    empty: s.empty,
    finished: s.finished,
    gone: s.gone,
    hasCard: data !== null,
    onExitRequest: requestExit,
    onLeave: onExit,
    onUndo: () => void s.undo(),
    onRedo: () => void s.redo(),
    onEdit: () => setEditing(true),
    onPick: s.pick,
    onNext: s.next,
    onSkipGone: s.skipGone,
    onGrade: (rating) => void s.gradeRight(rating),
    onSuspend: () => void s.hideCurrent("suspend"),
    onBury: () => void s.hideCurrent("bury"),
    onFlag: (flag) => void s.flagCurrent(flag),
    onHelp: () => setHelp(true),
  })

  if (s.loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-8">
        <p role="alert">{s.loadError}</p>
        <Button variant="outline" onClick={onExit}>
          Back
        </Button>
      </div>
    )
  }
  if (!run) return <LoadingBlock label="Loading cards" />

  // Editing, deleting and the leave prompt are full pages in place of the
  // session. This component (and so the run's state) stays mounted behind them.
  if (editing && data) {
    return (
      <EditNotePage
        key={data.note.id}
        note={data.note}
        onClose={() => setEditing(false)}
        onSaved={(note, resetFsrs) => {
          if (resetFsrs) s.disableUndoFor(note.id)
        }}
      />
    )
  }
  if (deleting && data) {
    return (
      <DeleteNotePage
        key={data.note.id}
        note={data.note}
        onClose={() => setDeleting(false)}
        onDeleted={(note) => s.dropDeleted(note.id)}
      />
    )
  }
  if (confirmExit) {
    return (
      <ExitPage
        summary={s.summary}
        records={run.history}
        scopeName={scope.name}
        onStay={() => setConfirmExit(false)}
        onLeave={onExit}
      />
    )
  }
  if (help) return <ShortcutsPage onClose={() => setHelp(false)} />

  const counter = s.empty
    ? scope.name
    : `${Math.min(run.index + 1, run.queue.length)} / ${run.queue.length}`

  return (
    <div className="flex flex-1 flex-col gap-4 py-4">
      <SessionToolbar
        scopeName={scope.name}
        counter={counter}
        shuffle={s.shuffle}
        canUndo={s.canUndo}
        canRedo={s.canRedo}
        canEdit={!!data && !s.finished && !s.empty}
        flag={data?.card.flag ?? 0}
        suspended={data?.card.suspended ?? false}
        onExit={requestExit}
        onToggleShuffle={() => s.setShuffle(!s.shuffle)}
        onUndo={() => void s.undo()}
        onRedo={() => void s.redo()}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        onFlag={(flag) => void s.flagCurrent(flag)}
        onSuspend={() => void s.hideCurrent("suspend")}
        onBury={() => void s.hideCurrent("bury")}
        onHelp={() => setHelp(true)}
        onMenuOpenChange={setMenuOpen}
      />

      {s.message && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {s.message}
        </p>
      )}

      {s.notice && (
        <p role="status" className="rounded-lg border px-3 py-2 text-xs">
          {s.notice}
        </p>
      )}

      {s.empty ? (
        <EmptyState scopeName={scope.name} onExit={onExit} />
      ) : s.finished ? (
        <FinishedState
          summary={s.summary}
          records={run.history}
          scopeName={scope.name}
          onExit={onExit}
        />
      ) : s.gone ? (
        <GoneState onSkip={s.skipGone} />
      ) : !data ? (
        <LoadingBlock label="Loading the question" />
      ) : (
        <div
          className={
            data.card.flag > 0
              ? `border-l-4 pl-3 ${flagBorder(data.card.flag)}`
              : undefined
          }
        >
          <QuestionView
            key={run.index}
            data={data}
            order={s.order}
            phase={run.phase}
            intervals={s.intervals}
            onPick={s.pick}
            onNext={s.next}
            onGrade={(rating) => void s.gradeRight(rating)}
          />
        </div>
      )}

      {!s.empty && !s.finished && data && (
        <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
          {hintFor(run.phase.kind)}
        </p>
      )}
    </div>
  )
}
