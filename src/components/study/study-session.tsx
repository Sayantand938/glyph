import * as React from "react"

import { EditNoteModal } from "@/components/edit-note-modal"
import { Button } from "@/components/ui/button"

import type { StudyScope } from "../deck-tree"
import { EmptyState, FinishedState, GoneState } from "./end-states"
import { ExitDialog } from "./exit-dialog"
import { hintFor } from "./helpers"
import { QuestionView } from "./question-view"
import { SessionToolbar } from "./session-toolbar"
import { useStudyKeys } from "./use-study-keys"
import { useStudyRun } from "./use-study-run"

export function StudySession({
  scope,
  onExit,
}: {
  scope: StudyScope
  onExit: () => void
}) {
  const s = useStudyRun(scope)
  const { run, data } = s
  const [editing, setEditing] = React.useState(false)
  const [confirmExit, setConfirmExit] = React.useState(false)

  function requestExit() {
    if (!run || s.empty || s.finished) onExit()
    else setConfirmExit(true)
  }

  useStudyKeys({
    active: run !== null && !editing && !confirmExit,
    phase: run?.phase.kind ?? null,
    empty: s.empty,
    finished: s.finished,
    gone: s.gone,
    hasCard: data !== null,
    onExitRequest: requestExit,
    onLeave: onExit,
    onUndo: () => void s.undo(),
    onEdit: () => setEditing(true),
    onPick: s.pick,
    onNext: s.next,
    onSkipGone: s.skipGone,
    onGrade: (rating) => void s.gradeRight(rating),
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
  if (!run) {
    return (
      <p className="py-8 text-sm text-muted-foreground" role="status">
        Loading...
      </p>
    )
  }

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
        canEdit={!!data && !s.finished && !s.empty}
        onExit={requestExit}
        onToggleShuffle={() => s.setShuffle(!s.shuffle)}
        onUndo={() => void s.undo()}
        onEdit={() => setEditing(true)}
      />

      {s.message && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {s.message}
        </p>
      )}

      {s.empty ? (
        <EmptyState scopeName={scope.name} onExit={onExit} />
      ) : s.finished ? (
        <FinishedState summary={s.summary} onExit={onExit} />
      ) : s.gone ? (
        <GoneState onSkip={s.skipGone} />
      ) : !data ? (
        <p className="py-4 text-sm text-muted-foreground" role="status">
          Loading...
        </p>
      ) : (
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
      )}

      {!s.empty && !s.finished && (
        <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
          {hintFor(run.phase.kind)}
        </p>
      )}

      <EditNoteModal
        note={editing && data ? data.note : null}
        onClose={() => setEditing(false)}
        onSaved={(note, resetFsrs) => {
          if (resetFsrs) s.disableUndoFor(note.id)
        }}
      />

      <ExitDialog
        open={confirmExit}
        onOpenChange={setConfirmExit}
        onLeave={onExit}
      />
    </div>
  )
}
