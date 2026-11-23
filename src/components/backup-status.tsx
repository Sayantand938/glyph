import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { BackupStatus } from "@/hooks/use-backup-status"

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** "Last backup: yesterday. 120 reviews and edits since." */
export function BackupStatusLine({ status }: { status: BackupStatus }) {
  const Icon = status.due ? ShieldAlertIcon : ShieldCheckIcon
  return (
    <p
      className={`flex items-start gap-2 text-sm ${
        status.due ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Last backup: {status.age}.
        {status.changes !== null &&
          (status.changes === 0
            ? " Nothing has changed since."
            : ` ${plural(status.changes, "review")} and edit${
                status.changes === 1 ? "" : "s"
              } since.`)}
        {status.due &&
          " Your data lives only in this browser, so save a backup file."}
      </span>
    </p>
  )
}

/** Shown on the dashboard when a backup is due; nothing otherwise. */
export function BackupReminder({
  status,
  busy,
  onExport,
}: {
  status: BackupStatus
  busy: boolean
  onExport: () => void
}) {
  if (!status.due) return null
  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
    >
      <BackupStatusLine status={status} />
      <Button size="sm" disabled={busy} onClick={onExport}>
        Export backup
      </Button>
    </div>
  )
}
