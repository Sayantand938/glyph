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
