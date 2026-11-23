import type { MergeStats } from "./types"

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
