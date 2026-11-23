import type { ImportSummary, InvalidRow } from "@/lib/importer"

const MAX_INVALID_SHOWN = 200

/** What the import would do, plus a collapsible list of rejected rows. */
export function ImportPreview({
  valid,
  invalid,
  summary,
}: {
  valid: number
  invalid: readonly InvalidRow[]
  summary: ImportSummary
}) {
  return (
    <div className="flex flex-col gap-2 text-sm" aria-live="polite">
      <p>
        <strong>{valid}</strong> valid ({summary.added} new, {summary.updated}{" "}
        will update, {summary.unchanged} unchanged),{" "}
        <strong>{invalid.length}</strong> invalid
        {summary.duplicates > 0 &&
          `; ${summary.duplicates} duplicate question${summary.duplicates === 1 ? "" : "s"} in the file will be merged (last one wins)`}
        .
      </p>

      {invalid.length > 0 && (
        <details className="rounded-lg border p-2 text-xs">
          <summary className="cursor-pointer select-none">
            Show invalid rows
          </summary>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {invalid.slice(0, MAX_INVALID_SHOWN).map((item) => (
              <li key={item.row}>
                <span className="font-medium">
                  Row {item.row}
                  {item.sl !== "" && ` (sl ${item.sl})`}:
                </span>{" "}
                {item.reasons.join(" ")}
              </li>
            ))}
            {invalid.length > MAX_INVALID_SHOWN && (
              <li className="text-muted-foreground">
                ...and {invalid.length - MAX_INVALID_SHOWN} more.
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  )
}
