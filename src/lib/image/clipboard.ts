/**
 * Reading images out of pasted HTML: pure (no DOM, no network).
 *
 * Copying a picture in a web page ("Copy image") normally puts the picture
 * itself on the clipboard as a file. Some sources only put HTML such as
 * `<img src="...">` there. An inline `data:` image carries its bytes and can be
 * stored; an `http(s):` or `blob:` source is just a reference to somewhere
 * else, and the app never downloads from the network, so it is left out.
 */
import { base64ToBytes, looksLikeBase64 } from "./base64"

/** Every `src` of an `<img>` tag in `html`, in order. */
export function imageSourcesInHtml(html: string): string[] {
  const out: string[] = []
  const tag = /<img\b[^>]*>/gi
  for (const m of html.matchAll(tag)) {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0])
    const value = (src?.[1] ?? src?.[2] ?? "").trim()
    if (value !== "") out.push(value)
  }
  return out
}

/**
 * Decodes a base64 `data:image/...` URL. Returns null for anything else,
 * including non-image types and non-base64 data URLs.
 */
export function parseDataUrl(
  src: string
): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(src)
  if (!m) return null
  const payload = m[2].replace(/\s+/g, "")
  if (!looksLikeBase64(payload)) return null
  try {
    return { mime: m[1].toLowerCase(), bytes: base64ToBytes(payload) }
  } catch {
    return null
  }
}
