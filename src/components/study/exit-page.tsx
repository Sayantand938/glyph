import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import type { SessionRecord, SessionSummary } from "@/lib/session"

import { SessionStats } from "./end-states"

/**
 * Asks before leaving a study session that still has cards to go, with the
 * stats of the answers given so far.
 */
export function ExitPage({
  summary,
  records,
  scopeName,
  onStay,
  onLeave,
}: {
  summary: SessionSummary
  records: readonly SessionRecord[]
  scopeName: string
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <PageShell
      title="Leave this session?"
      description={scopeName}
      onBack={onStay}
      footer={
        <>
          <Button variant="outline" onClick={onStay}>
            Keep studying
          </Button>
          <Button onClick={onLeave}>Leave</Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Every answer so far is already saved. The remaining cards will be
        waiting next time.
      </p>

      {summary.answers > 0 && (
        <SessionStats summary={summary} records={records} />
      )}
    </PageShell>
  )
}
