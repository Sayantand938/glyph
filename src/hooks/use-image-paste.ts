import * as React from "react"

import { addImage } from "@/db/repo"
import {
  imageSourcesInHtml,
  imageToken,
  insertAt,
  parseDataUrl,
} from "@/lib/image"
import { encodeImage } from "@/lib/image/encode"

type Field = HTMLInputElement | HTMLTextAreaElement

const LINK_ONLY =
  "That is a link to an image on a website, not the picture itself, so it was left out. Right-click the image, choose Copy image, and paste again."

/**
 * Paste-an-image support for text fields. `paste` goes on a field's `onPaste`.
 * Every image ends up stored in the app; nothing is linked and nothing is
 * downloaded:
 *  - image files on the clipboard (what "Copy image" in a browser, a
 *    screenshot tool or an image editor puts there) are used first;
 *  - otherwise inline `data:` images in pasted HTML are decoded locally;
 *  - an HTML image that only points at a URL cannot be stored, so it is left
 *    out and the user is told how to copy the picture itself.
 * Each stored image becomes an `![](img:<id>)` token at the caret through
 * `apply`. Plain-text pastes are left alone. `pending` is the number of pastes
 * still being processed, and `pasted` turns true once any image was stored (so
 * the caller knows there may be orphans to prune if the edit is cancelled).
 */
export function useImagePaste(onError: (message: string | null) => void) {
  const [pending, setPending] = React.useState(0)
  const pasted = React.useRef(false)

  const paste = React.useCallback(
    (
      event: React.ClipboardEvent<Field>,
      apply: (update: (value: string) => string) => void,
      multiline: boolean
    ) => {
      // The clipboard can only be read during the event, so gather everything
      // synchronously before any await.
      const clip = event.clipboardData
      let sources: Blob[] = Array.from(clip.files).filter((f) =>
        f.type.startsWith("image/")
      )
      let linkOnly = 0
      if (sources.length === 0) {
        for (const src of imageSourcesInHtml(clip.getData("text/html"))) {
          const data = parseDataUrl(src)
          if (data) {
            sources.push(new Blob([data.bytes], { type: data.mime }))
          } else {
            linkOnly += 1
          }
        }
      }
      if (sources.length === 0) {
        // Nothing storable. Let any text paste through, but say why an image
        // did not come along.
        if (linkOnly > 0) onError(LINK_ONLY)
        return
      }
      event.preventDefault()
      sources = sources.slice(0, 10)

      const field = event.currentTarget
      const start = field.selectionStart ?? field.value.length
      const end = field.selectionEnd ?? start
      const sep = multiline ? "\n" : " "

      onError(null)
      setPending((n) => n + 1)
      void (async () => {
        try {
          const ids: string[] = []
          for (const source of sources) {
            const image = await encodeImage(source)
            await addImage(image)
            pasted.current = true
            ids.push(image.id)
          }
          const text = ids.map((id) => imageToken(id)).join(sep)
          apply((value) => insertAt(value, start, end, text, sep).value)
          if (linkOnly > 0) onError(LINK_ONLY)
        } catch (error) {
          onError(
            error instanceof Error ? error.message : "Couldn't add that image."
          )
        } finally {
          setPending((n) => n - 1)
        }
      })()
    },
    [onError]
  )

  return { paste, pending, pasted }
}
