import type { MergeStats } from "./types"

export function emptyMergeStats(): MergeStats {
  return {
    decksAdded: 0,
    decksUpdated: 0,
    notesAdded: 0,
    notesUpdated: 0,
    cardsUpdated: 0,
    cardsDropped: 0,
    reviewsAdded: 0,
    notesMissingTopic: 0,
    imagesAdded: 0,
    settingsUpdated: 0,
  }
}

/** Adds two sets of stats, for a backup merged in several parts. */
export function addMergeStats(a: MergeStats, b: MergeStats): MergeStats {
  const sum = { ...a }
  for (const key of Object.keys(b) as (keyof MergeStats)[]) {
    sum[key] = a[key] + b[key]
  }
  return sum
}

function plural(n: number, singular: string, many = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : many}`
}

/** "Merged: +4 notes, 2 notes updated, +4 cards updated, +20 reviews." */
export function formatMergeSummary(stats: MergeStats): string {
  const parts: string[] = []
  if (stats.decksAdded > 0) parts.push(`+${plural(stats.decksAdded, "deck")}`)
  if (stats.notesAdded > 0) parts.push(`+${plural(stats.notesAdded, "note")}`)
  if (stats.notesUpdated > 0) {
    parts.push(`${plural(stats.notesUpdated, "note")} updated`)
  }
  if (stats.cardsUpdated > 0) {
    parts.push(`+${plural(stats.cardsUpdated, "card")} updated`)
  }
  if (stats.reviewsAdded > 0) {
    parts.push(`+${plural(stats.reviewsAdded, "review")}`)
  }
  if (stats.imagesAdded > 0) {
    parts.push(`+${plural(stats.imagesAdded, "image")}`)
  }
  if (stats.settingsUpdated > 0) {
    parts.push(`${plural(stats.settingsUpdated, "setting")} updated`)
  }

  let text =
    parts.length > 0 ? `Merged: ${parts.join(", ")}.` : "Nothing new to merge."
  if (stats.cardsDropped > 0) {
    text += ` Skipped ${plural(stats.cardsDropped, "card")} with no matching note.`
  }
  if (stats.notesMissingTopic > 0) {
    text += ` ${plural(stats.notesMissingTopic, "note")} belong to a deck missing from the backup and won't show on the dashboard.`
  }
  return text
}

/** Whether a merge changed (or would change) anything on this device. */
export function hasChanges(stats: MergeStats): boolean {
  return (
    stats.decksAdded +
      stats.decksUpdated +
      stats.notesAdded +
      stats.notesUpdated +
      stats.cardsUpdated +
      stats.reviewsAdded +
      stats.imagesAdded +
      stats.settingsUpdated >
    0
  )
}

const TABLE_LABELS: Record<string, [string, string]> = {
  decks: ["deck", "decks"],
  notes: ["question", "questions"],
  cards: ["card", "cards"],
  revlog: ["review", "reviews"],
  images: ["image", "images"],
  settings: ["setting", "settings"],
}

/**
 * "Left out 2 rows that were not valid (1 question, 1 review): notes[3] in part
 * 2, ..." for a lenient import; "" when nothing was left out.
 */
export function formatSkipped(
  skipped: Record<string, number>,
  examples: readonly string[]
): string {
  const total = Object.values(skipped).reduce((a, b) => a + b, 0)
  if (total === 0) return ""
  const kinds = Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => {
      const [one, many] = TABLE_LABELS[table] ?? [table, table]
      return plural(n, one, many)
    })
  const more = total > examples.length ? ", ..." : ""
  const where = examples.length > 0 ? `: ${examples.join(", ")}${more}` : ""
  return `Left out ${plural(total, "row")} that ${total === 1 ? "was" : "were"} not valid (${kinds.join(", ")})${where}.`
}
