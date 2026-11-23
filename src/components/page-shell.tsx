import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useHistoryLayer } from "@/hooks/use-history-layer"

/**
 * Frame for a full-page task (editing, importing, confirming a delete), used
 * instead of a modal so it works the same on a phone: a back button and title
 * on top, the content, and a footer of actions that stays pinned to the bottom
 * of the screen. Escape goes back. Pass `onSubmit` to make the page one form.
 */
export function PageShell({
  title,
  description,
  onBack,
  backDisabled = false,
  onSubmit,
  footer,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  onBack: () => void
  /** Blocks the back button and Escape, e.g. while a write is running. */
  backDisabled?: boolean
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void
  /** Action buttons; an optional hint goes first. */
  footer?: React.ReactNode
  children?: React.ReactNode
}) {
  useHistoryLayer(onBack, backDisabled)

  // A new page starts at the top, whatever the page before it was scrolled to.
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const latest = React.useRef({ onBack, backDisabled })
  React.useEffect(() => {
    latest.current = { onBack, backDisabled }
  })
  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (!latest.current.backDisabled) latest.current.onBack()
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  const className = "flex flex-1 flex-col gap-4 py-4"
  const body = (
    <>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Back"
          disabled={backDisabled}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="min-w-0 flex-1 text-base font-semibold tracking-tight">
          {title}
        </h2>
      </div>
      {description && (
        <p className="-mt-2 text-xs text-muted-foreground">{description}</p>
      )}

      {children}

      {footer && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col-reverse gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {footer}
        </div>
      )}
    </>
  )

  return onSubmit ? (
    <form onSubmit={onSubmit} className={className}>
      {body}
    </form>
  ) : (
    <div className={className}>{body}</div>
  )
}
