/**
 * Tags on questions: parsing, validation and comparison. Pure (no DB, no
 * React).
 *
 * A tag is a short lowercase word without spaces, like Anki's: "physics",
 * "exam-2024", "organic-chem". Input is forgiving ("Physics", "#physics",
 * "organic chem" as one array entry) and is always normalized to that form.
 * A note's tags are unique and sorted, so two lists can be compared directly.
 */

export const MAX_TAG_LENGTH = 40
export const MAX_TAGS_PER_NOTE = 30

/** One tag from loose text: trimmed, one leading "#" dropped, lowercase, inner spaces become "-". */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, "-")
}

/**
 * Turns user input into a clean tag list: unique, sorted, no empties.
 *
 *  - A string is split on whitespace, commas and semicolons ("a, b  c").
 *  - An array has each text entry normalized on its own (so an entry may
 *    contain spaces, which become "-"); anything that is not text is ignored.
 */
export function parseTags(input: string | readonly unknown[]): string[] {
  const parts =
    typeof input === "string"
      ? input.split(/[\s,;]+/)
      : input.filter((v): v is string => typeof v === "string")
  const tags = new Set<string>()
  for (const part of parts) {
    const tag = normalizeTag(part)
    if (tag !== "") tags.add(tag)
  }
  return [...tags].sort()
}

/** Why `tags` cannot be saved, or null if they are fine. */
export function tagsError(tags: readonly string[]): string | null {
  if (tags.length > MAX_TAGS_PER_NOTE) {
    return `Use at most ${MAX_TAGS_PER_NOTE} tags.`
  }
  const long = tags.find((tag) => tag.length > MAX_TAG_LENGTH)
  if (long !== undefined) {
    return `A tag can be at most ${MAX_TAG_LENGTH} characters: "${long.slice(0, 12)}...".`
  }
  return null
}

export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

/** The tags as editable text: "a b c". */
export function formatTags(tags: readonly string[]): string {
  return tags.join(" ")
}

/** Every distinct tag in `lists` with how many lists carry it, sorted by name. */
export function tagCounts(
  lists: Iterable<readonly string[]>
): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const tags of lists) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
}
