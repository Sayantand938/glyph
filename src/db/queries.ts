/** Read-only queries. Writes live in repo.ts. Call these from `useLiveQuery`. */
import type { BackupData } from "@/lib/backup"
import { makeBrowseRow, type BrowseRow } from "@/lib/browse"
import { bytesToBase64, imageIdsInNotes } from "@/lib/image"
import { ZERO_COUNTS, countCards, type DeckCounts } from "@/lib/queue"

import { db } from "./database"
import type { BackupImage, CardRow, Deck, ImageRow, Note } from "./types"

export interface DashboardData {
  /** Live Subjects, sorted by name. */
  subjects: Deck[]
  /** Live Topics by Subject id, sorted by name. Topics of deleted Subjects are left out. */
  topics: Map<string, Deck[]>
  /** Counts by Topic id. */
  counts: Map<string, DeckCounts>
}

function byName(a: Deck, b: Deck): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
}

/**
 * Everything the dashboard shows. Counts only include cards of live notes in
 * live Topics under live Subjects (a card is not tombstoned with its note).
 */
export async function loadDashboard(now: number): Promise<DashboardData> {
  return db.transaction("r", [db.decks, db.notes, db.cards], async () => {
    const decks = (await db.decks.toArray()).filter((d) => d.deletedAt === null)
    const subjects = decks.filter((d) => d.parentId === null).sort(byName)
    const subjectIds = new Set(subjects.map((s) => s.id))

    const topics = new Map<string, Deck[]>(subjects.map((s) => [s.id, []]))
    for (const deck of decks) {
      if (deck.parentId !== null && subjectIds.has(deck.parentId)) {
        topics.get(deck.parentId)?.push(deck)
      }
    }
    for (const list of topics.values()) list.sort(byName)

    // Only tombstones carry a numeric deletedAt, so this index lookup is small.
    const deadNotes = new Set(
      await db.notes.where("deletedAt").above(0).primaryKeys()
    )
    const topicIds = [...topics.values()].flat().map((t) => t.id)
    const cards = await db.cards.where("topicId").anyOf(topicIds).toArray()

    const byTopic = new Map<string, typeof cards>()
    for (const card of cards) {
      if (deadNotes.has(card.noteId)) continue
      const list = byTopic.get(card.topicId)
      if (list) list.push(card)
      else byTopic.set(card.topicId, [card])
    }
    const counts = new Map<string, DeckCounts>()
    for (const id of topicIds) {
      const list = byTopic.get(id)
      counts.set(id, list ? countCards(list, now) : ZERO_COUNTS)
    }

    return { subjects, topics, counts }
  })
}

/**
 * The cards a study session can draw from: cards of live notes in live Topics
 * (under live Subjects) within `scope`. Feed the result to `buildQueue`.
 */
export async function loadStudyCards(scope: {
  kind: "subject" | "topic"
  id: string
}): Promise<CardRow[]> {
  return db.transaction("r", [db.decks, db.notes, db.cards], async () => {
    const decks = (await db.decks.toArray()).filter((d) => d.deletedAt === null)
    const liveSubjects = new Set(
      decks.filter((d) => d.parentId === null).map((d) => d.id)
    )
    const topicIds = decks
      .filter(
        (d) =>
          d.parentId !== null &&
          liveSubjects.has(d.parentId) &&
          (scope.kind === "subject"
            ? d.parentId === scope.id
            : d.id === scope.id)
      )
      .map((d) => d.id)

    const deadNotes = new Set(
      await db.notes.where("deletedAt").above(0).primaryKeys()
    )
    const cards = await db.cards.where("topicId").anyOf(topicIds).toArray()
    return cards.filter((card) => !deadNotes.has(card.noteId))
  })
}

export interface BrowseItem {
  row: BrowseRow
  /** The full note, so the editor can open straight from the list. */
  note: Note
}

/**
 * Every live question in `scope` (all decks when null) with its progress, for
 * the browse list: live notes in live Topics under live Subjects.
 */
export async function loadBrowseItems(
  scope: { kind: "subject" | "topic"; id: string } | null
): Promise<BrowseItem[]> {
  return db.transaction("r", [db.decks, db.notes, db.cards], async () => {
    const decks = (await db.decks.toArray()).filter((d) => d.deletedAt === null)
    const subjects = new Map(
      decks.filter((d) => d.parentId === null).map((d) => [d.id, d])
    )
    const topics = decks.filter(
      (d) =>
        d.parentId !== null &&
        subjects.has(d.parentId) &&
        (scope === null ||
          (scope.kind === "subject"
            ? d.parentId === scope.id
            : d.id === scope.id))
    )
    const topicById = new Map(topics.map((t) => [t.id, t]))

    const notes = (
      await db.notes
        .where("topicId")
        .anyOf([...topicById.keys()])
        .toArray()
    ).filter((n) => n.deletedAt === null)
    const cards = await db.cards.bulkGet(notes.map((n) => n.id))

    return notes.map((note, i) => {
      const topic = topicById.get(note.topicId)
      const subject = topic?.parentId ? subjects.get(topic.parentId) : undefined
      return {
        note,
        row: makeBrowseRow(
          note,
          cards[i],
          topic?.name ?? "",
          subject?.name ?? ""
        ),
      }
    })
  })
}

export interface StudyCardView {
  card: CardRow
  note: Note
}

/** A card and its live note for display, or null if either is gone or deleted. */
export async function loadStudyCard(
  cardId: string
): Promise<StudyCardView | null> {
  return db.transaction("r", [db.notes, db.cards], async () => {
    const card = await db.cards.get(cardId)
    if (!card) return null
    const note = await db.notes.get(card.noteId)
    if (!note || note.deletedAt !== null) return null
    return { card, note }
  })
}

export interface ImageView {
  /** A `data:` URL, so there is no object URL to revoke. */
  src: string
  width: number
  height: number
}

/** A stored image ready for an <img>, or null if there is none with that id. */
export async function loadImageView(id: string): Promise<ImageView | null> {
  const row = await db.images.get(id)
  if (!row) return null
  const bytes = new Uint8Array(await row.blob.arrayBuffer())
  return {
    src: `data:${row.mime};base64,${bytesToBase64(bytes)}`,
    width: row.width,
    height: row.height,
  }
}

/**
 * Everything a backup file holds, read in one snapshot: the four tables plus
 * the images that notes use (tombstoned notes included), as base64.
 */
export async function readBackupSnapshot(): Promise<{
  data: BackupData
  images: BackupImage[]
}> {
  const { data, rows } = await db.transaction(
    "r",
    [db.decks, db.notes, db.cards, db.revlog, db.images],
    async () => {
      const data: BackupData = {
        decks: await db.decks.toArray(),
        notes: await db.notes.toArray(),
        cards: await db.cards.toArray(),
        revlog: await db.revlog.toArray(),
      }
      const used = imageIdsInNotes(data.notes)
      const found = await db.images.bulkGet([...used])
      return {
        data,
        rows: found.filter((row): row is ImageRow => row !== undefined),
      }
    }
  )
  // Blob -> bytes is not an IndexedDB call, so it stays outside the transaction.
  const images: BackupImage[] = []
  for (const row of rows) {
    images.push({
      id: row.id,
      mime: row.mime,
      width: row.width,
      height: row.height,
      data: bytesToBase64(new Uint8Array(await row.blob.arrayBuffer())),
    })
  }
  return { data, images }
}
