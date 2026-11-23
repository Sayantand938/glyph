import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/** A spinning ring; decorative, so pair it with text for screen readers. */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon aria-hidden className={cn("size-4 animate-spin", className)} />
  )
}

/**
 * A loading state for a screen or a block. It reserves its space at once (so
 * the page does not jump when the content arrives) but shows the spinner only
 * after `delayMs`: a load that finishes sooner never flashes a spinner.
 */
export function LoadingBlock({
  label = "Loading",
  delayMs = 200,
  className,
}: {
  label?: string
  delayMs?: number
  className?: string
}) {
  const [shown, setShown] = React.useState(delayMs <= 0)

  React.useEffect(() => {
    if (shown) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [shown, delayMs])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-40 items-center justify-center gap-2 py-8 text-sm text-muted-foreground",
        className
      )}
    >
      {shown ? (
        <>
          <Spinner />
          <span>{label}...</span>
        </>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  )
}
