import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"

/** Asks before leaving a study session that still has cards to go. */
export function ExitPage({
  onStay,
  onLeave,
}: {
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <PageShell
      title="Leave this session?"
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
    </PageShell>
  )
}
