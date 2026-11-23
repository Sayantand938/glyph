import * as React from "react"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { ImportSummary } from "@/lib/importer"

import { ImportForm } from "./import-form"

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (summary: ImportSummary) => void
}) {
  const [busy, setBusy] = React.useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let a click-away or Esc close the dialog mid-write.
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent>
        <ImportForm
          busy={busy}
          setBusy={setBusy}
          onClose={() => onOpenChange(false)}
          onImported={onImported}
        />
      </DialogContent>
    </Dialog>
  )
}
