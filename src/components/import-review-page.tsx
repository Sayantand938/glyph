import { AlertTriangleIcon } from "lucide-react"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import type { ImportReview } from "@/hooks/use-backup-controls"

/**
 * The step between choosing a backup file and changing anything: what a small
 * file would change, an offer to import the valid rows of a file with some bad
 * ones, or the confirmation for putting a saved copy back.
 */
export function ImportReviewPage({
  review,
  onConfirm,
  onCancel,
}: {
  review: ImportReview
  onConfirm: () => void
  onCancel: () => void
}) {
  if (review.kind === "restore") {
    const { meta } = review
    return (
      <PageShell
        title="Put back this copy?"
        onBack={onCancel}
        footer={
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              Replace my data with this copy
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The copy was saved {new Date(meta.at).toLocaleString()}, {meta.reason}
          . It holds {meta.notes} questions and {meta.reviews} reviews.
        </p>
        <p className="text-sm text-muted-foreground">
          Everything on this device is replaced by the copy, so reviews and
          edits made since then are gone from here. The data as it is now is
          saved as another copy first, so this can be undone too.
        </p>
      </PageShell>
    )
  }

  if (review.kind === "rows") {
    return (
      <PageShell
        title="Some rows in this file are not valid"
        description={review.file.name}
        onBack={onCancel}
        footer={
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>Import the valid rows</Button>
          </>
        }
      >
        <p role="alert" className="flex items-start gap-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {review.error}
        </p>
        <p className="text-sm text-muted-foreground">
          The file itself is whole (its checksum matches), but it holds rows
          Glyph cannot read, maybe from a hand-edited file. You can import
          everything else; the rows that cannot be read are left out and listed
          afterwards. A safety copy of your data is saved first, so the import
          can be undone.
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Import this backup?"
      description={review.file.name}
      onBack={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Import</Button>
        </>
      }
    >
      <p className="text-sm">This would change your data like this:</p>
      <p className="rounded-lg border p-3 text-sm">{review.summary}</p>
      {review.skipped && (
        <p className="text-sm text-muted-foreground">{review.skipped}</p>
      )}
      <p className="text-sm text-muted-foreground">
        Rows are merged by the time they were last changed: whichever device
        changed a question or a card more recently wins, and nothing is ever
        removed. A safety copy of your data is saved first, so the import can be
        undone from Settings.
      </p>
    </PageShell>
  )
}
