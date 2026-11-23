import { useLiveQuery } from "dexie-react-hooks"

import { loadImageView } from "@/db/queries"
import { cn } from "@/lib/utils"

/**
 * A picture stored in the app, shown by its id. Built as an <img> element
 * (never an HTML string, CLAUDE.md rule 10) from a `data:` URL, so there is no
 * object URL to create and revoke. The stored width and height are set so the
 * layout does not jump while it loads.
 */
export function NoteImage({
  id,
  alt,
  className,
}: {
  id: string
  alt: string
  className?: string
}) {
  // undefined while loading, null when there is no such image.
  const image = useLiveQuery(() => loadImageView(id), [id])

  if (image === null) {
    return (
      <span className="text-xs text-muted-foreground italic">
        [missing image{alt ? `: ${alt}` : ""}]
      </span>
    )
  }
  if (!image) return null

  return (
    <img
      src={image.src}
      alt={alt}
      width={image.width}
      height={image.height}
      draggable={false}
      className={cn("my-1 block h-auto max-w-full rounded-md", className)}
    />
  )
}
