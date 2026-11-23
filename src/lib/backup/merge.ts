import type { CardRow, Deck, Note, RevlogRow } from "@/db/types"

import { pickCard, pickDeck, pickNote } from "./pick"
import type { BackupData, MergeResult, MergeStats } from "./types"

/**
 * Merges an incoming backup into local data. Pure and idempotent: merging the
 * same backup into its own result writes nothing.
 *
 *  - decks: larger `updatedAt`; notes: see `pickNote`; cards: see `pickCard`
 *  - revlog: union by id (entries are immutable, local wins)
 *  - an incoming card whose note is missing from the merged notes is dropped
 *  - each card's `topicId` is repaired to match its winning note
 *  - notes whose topic is missing are written but counted in the stats
 */
export function mergeBackup(
  local: BackupData,
  incoming: BackupData
): MergeResult {
  const stats: MergeStats = {
    decksAdded: 0,
    decksUpdated: 0,
    notesAdded: 0,
    notesUpdated: 0,
    cardsUpdated: 0,
    cardsDropped: 0,
    reviewsAdded: 0,
    notesMissingTopic: 0,
    imagesAdded: 0,
  }

  // decks
  const decks = new Map(local.decks.map((d) => [d.id, d]))
  const writeDecks = new Map<string, Deck>()
  for (const inc of incoming.decks) {
    const cur = decks.get(inc.id)
    if (!cur) {
      stats.decksAdded += 1
      decks.set(inc.id, inc)
      writeDecks.set(inc.id, inc)
      continue
    }
    const winner = pickDeck(cur, inc)
    if (winner !== cur) {
      stats.decksUpdated += 1
      decks.set(inc.id, winner)
      writeDecks.set(inc.id, winner)
    }
  }

  // notes
  const notes = new Map(local.notes.map((n) => [n.id, n]))
  const writeNotes = new Map<string, Note>()
  for (const inc of incoming.notes) {
    const cur = notes.get(inc.id)
    if (!cur) {
      stats.notesAdded += 1
      notes.set(inc.id, inc)
      writeNotes.set(inc.id, inc)
      continue
    }
    const winner = pickNote(cur, inc)
    if (winner !== cur) {
      stats.notesUpdated += 1
      notes.set(inc.id, winner)
      writeNotes.set(inc.id, winner)
    }
  }

  // cards
  const cards = new Map(local.cards.map((c) => [c.cardId, c]))
  const writeCards = new Map<string, CardRow>()
  for (const inc of incoming.cards) {
    if (!notes.has(inc.noteId)) {
      stats.cardsDropped += 1
      continue
    }
    const cur = cards.get(inc.cardId)
    const winner = cur ? pickCard(cur, inc) : inc
    if (winner !== cur) {
      cards.set(inc.cardId, winner)
      writeCards.set(inc.cardId, winner)
    }
  }
  // Keep the denormalized topicId in step with the winning note.
  for (const [cardId, card] of cards) {
    const note = notes.get(card.noteId)
    if (note && note.topicId !== card.topicId) {
      const fixed = { ...card, topicId: note.topicId }
      cards.set(cardId, fixed)
      writeCards.set(cardId, fixed)
    }
  }
  stats.cardsUpdated = writeCards.size

  // revlog
  const revlog = new Map(local.revlog.map((r) => [r.id, r]))
  const writeRevlog: RevlogRow[] = []
  for (const inc of incoming.revlog) {
    if (revlog.has(inc.id)) continue
    revlog.set(inc.id, inc)
    writeRevlog.push(inc)
  }
  stats.reviewsAdded = writeRevlog.length

  for (const note of writeNotes.values()) {
    if (note.deletedAt === null && !decks.has(note.topicId)) {
      stats.notesMissingTopic += 1
    }
  }

  return {
    merged: {
      decks: [...decks.values()],
      notes: [...notes.values()],
      cards: [...cards.values()],
      revlog: [...revlog.values()],
    },
    write: {
      decks: [...writeDecks.values()],
      notes: [...writeNotes.values()],
      cards: [...writeCards.values()],
      revlog: writeRevlog,
    },
    stats,
  }
}
