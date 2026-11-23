import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/page-shell"

import { SHORTCUT_GROUPS } from "./helpers"

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((key, i) => (
        <span key={key} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-xs text-muted-foreground" aria-hidden>
              /
            </span>
          )}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs whitespace-nowrap">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  )
}

/**
 * Every study-session shortcut, as a full page in place of the session (the
 * run behind it keeps its state). Back, Escape and the footer button close it.
 */
export function ShortcutsPage({ onClose }: { onClose: () => void }) {
  return (
    <PageShell
      title="Keyboard shortcuts"
      description="For a computer keyboard. Every action also has a button."
      onBack={onClose}
      footer={
        <Button type="button" onClick={onClose} autoFocus>
          Back to the session
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {group.title}
            </h3>
            <dl className="divide-y overflow-hidden rounded-xl border">
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1.5 bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <dt className="text-sm">{item.label}</dt>
                  <dd>
                    <Keys keys={item.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </PageShell>
  )
}
