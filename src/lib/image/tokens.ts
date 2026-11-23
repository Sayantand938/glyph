/**
 * The image token that note text uses to point at a stored image:
 * `![alt](img:<id>)`. Pure: no DOM, no DB.
 *
 * Only `img:` plus a 32-digit hex id is recognised, so a token can never point
 * at a URL (the app makes no network calls) and anything else that looks like
 * Markdown image syntax stays plain text.
 */

/** Image ids are the first 32 hex digits of the SHA-256 of the stored bytes. */
export const IMAGE_ID_PATTERN = "[0-9a-f]{32}"

export const IMAGE_ID_RE = new RegExp(`^${IMAGE_ID_PATTERN}$`)

const TOKEN_SOURCE = `!\\[([^\\]\\n]*)\\]\\(img:(${IMAGE_ID_PATTERN})\\)`

/** A fresh global regex (they carry `lastIndex` state). Groups: 1 = alt, 2 = id. */
export function imageTokenRegex(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g")
}

/** `![alt](img:<id>)`. Brackets and newlines are dropped from the alt text. */
export function imageToken(id: string, alt = ""): string {
  const safe = alt.replace(/[[\]\n\r]/g, "").trim()
  return `![${safe}](img:${id})`
}

/** The distinct image ids in `text`, in order of first use. */
export function imageIdsIn(text: string): string[] {
  const ids = new Set<string>()
  for (const m of text.matchAll(imageTokenRegex())) ids.add(m[2])
  return [...ids]
}

/** Every image id used by any text of the given notes. */
export function imageIdsInNotes(
  notes: Iterable<{
    question: string
    options: readonly string[]
    extra: string
  }>
): Set<string> {
  const ids = new Set<string>()
  const scan = (text: string) => {
    // Cheap pre-check: most notes have no images.
    if (!text.includes("img:")) return
    for (const id of imageIdsIn(text)) ids.add(id)
  }
  for (const note of notes) {
    scan(note.question)
    for (const option of note.options) scan(option)
    scan(note.extra)
  }
  return ids
}

/**
 * Replaces `value[start, end)` with `text`, putting `sep` between `text` and
 * any neighbouring non-space character so a token never glues onto a word.
 * Returns the new value and the caret position just after `text`.
 */
export function insertAt(
  value: string,
  start: number,
  end: number,
  text: string,
  sep: string
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length))
  const to = Math.max(from, Math.min(end, value.length))
  const before = value.slice(0, from)
  const after = value.slice(to)
  const lead = before !== "" && !/\s$/.test(before) ? sep : ""
  const tail = after !== "" && !/^\s/.test(after) ? sep : ""
  const inserted = lead + text + tail
  return {
    value: before + inserted + after,
    caret: before.length + lead.length + text.length + tail.length,
  }
}
