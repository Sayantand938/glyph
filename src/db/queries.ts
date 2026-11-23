/** Read-only queries. Writes live in repo.ts. Call these from `useLiveQuery`. */
import type { BackupData } from "@/lib/backup"
import { makeBrowseRow, type BrowseRow } from "@/lib/browse"
import type { ReviewRecord } from "@/lib/fsrs"
import { bytesToBase64, imageIdsInNotes } from "@/lib/image"
import { ZERO_COUNTS, countCards, type DeckCounts } from "@/lib/queue"

import { db } from "./database"
import type {
  BackupImage,
  CardRow,
  Deck,
  ImageRow,
  Note,
  RevlogRow,
  SettingRow,
} from "./types"

/**
 * What a study session or the browse list covers: one Subject, one Topic, or
 * every question carrying one tag (`id` is then the tag).
 */
export interface QueryScope {
  kind: "subject" | "topic" | "tag"
  id: string
}

export interface TagSummary {
  tag: string
  counts: DeckCounts
}

export interface DashboardData {
  /** Live Subjects, sorted by name. */
  subjects: Deck[]
  /** Live Topics by Subject id, sorted by name. Topics of deleted Subjects are left out. */
  topics: Map<string, Deck[]>
  /** Counts by Topic id. */
  counts: Map<string, DeckCounts>
  /** Tags used by at least one live question, sorted by name. */
  tags: TagSummary[]
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

    // One index lookup per distinct tag; tags only on deleted questions or in
    // deleted decks have no live cards and are left out.
    const liveTopics = new Set(topicIds)
    const tags: TagSummary[] = []
    for (const tag of (await db.notes
      .orderBy("tags")
      .uniqueKeys()) as string[]) {
      const notes = (await db.notes.where("tags").equals(tag).toArray()).filter(
        (n) => n.deletedAt === null && liveTopics.has(n.topicId)
      )
      if (notes.length === 0) continue
      const tagged = (await db.cards.bulkGet(notes.map((n) => n.id))).filter(
        (card): card is CardRow => card !== undefined
      )
      tags.push({ tag, counts: countCards(tagged, now) })
    }

    return { subjects, topics, counts, tags }
  })
}

/** Live Subjects, and live Topics under them, as ids and names. */
async function liveDecks(): Promise<{
  subjects: Map<string, Deck>
  topics: Deck[]
}> {
  const decks = (await db.decks.toArray()).filter((d) => d.deletedAt === null)
  const subjects = new Map(
    decks.filter((d) => d.parentId === null).map((d) => [d.id, d])
  )
  const topics = decks.filter(
    (d) => d.parentId !== null && subjects.has(d.parentId)
  )
  return { subjects, topics }
}

/** The live Topics a scope covers (all of them for a tag, which spans decks). */
function topicsInScope(topics: Deck[], scope: QueryScope | null): Deck[] {
  if (scope === null || scope.kind === "tag") return topics
  return topics.filter((t) =>
    scope.kind === "subject" ? t.parentId === scope.id : t.id === scope.id
  )
}

/** The live notes of `topics`; with a tag scope only those carrying the tag. */
async function liveNotesIn(
  topics: Deck[],
  scope: QueryScope | null
): Promise<Note[]> {
  const ids = topics.map((t) => t.id)
  const notes =
    scope?.kind === "tag"
      ? await db.notes.where("tags").equals(scope.id).toArray()
      : await db.notes.where("topicId").anyOf(ids).toArray()
  const topicIds = new Set(ids)
  return notes.filter((n) => n.deletedAt === null && topicIds.has(n.topicId))
}

/**
 * The cards a study session can draw from: cards of live notes in live Topics
 * (under live Subjects) within `scope`. Feed the result to `buildQueue`.
 */
export async function loadStudyCards(scope: QueryScope): Promise<CardRow[]> {
  return db.transaction("r", [db.decks, db.notes, db.cards], async () => {
    const { topics } = await liveDecks()
    const notes = await liveNotesIn(topicsInScope(topics, scope), scope)
    const cards = await db.cards.bulkGet(notes.map((n) => n.id))
    return cards.filter((card): card is CardRow => card !== undefined)
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
  scope: QueryScope | null
): Promise<BrowseItem[]> {
  return db.transaction("r", [db.decks, db.notes, db.cards], async () => {
    const { subjects, topics: allTopics } = await liveDecks()
    const topics = topicsInScope(allTopics, scope)
    const topicById = new Map(topics.map((t) => [t.id, t]))

    const notes = await liveNotesIn(topics, scope)
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

/** A card with every review of it (oldest first), for the History page. */
export async function loadCardHistory(
  cardId: string
): Promise<{ card: CardRow | null; logs: RevlogRow[] }> {
  return db.transaction("r", [db.cards, db.revlog], async () => ({
    card: (await db.cards.get(cardId)) ?? null,
    logs: await db.revlog.where("cardId").equals(cardId).sortBy("reviewedAt"),
  }))
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
  settings: SettingRow[]
}> {
  const { data, rows, settings } = await db.transaction(
    "r",
    [db.decks, db.notes, db.cards, db.revlog, db.images, db.settings],
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
        settings: await db.settings.toArray(),
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
  return { data, images, settings }
}

/**
 * How many reviews and question edits (or deletions) were made after `since`
 * (every one when null): the work a backup made then would not contain. Index
 * counts only, so it is cheap on a big log.
 */
export async function countChangesSince(since: number | null): Promise<number> {
  if (since === null) {
    return (await db.revlog.count()) + (await db.notes.count())
  }
  const [reviews, edited, deleted] = await Promise.all([
    db.revlog.where("reviewedAt").above(since).count(),
    db.notes.where("contentUpdatedAt").above(since).count(),
    db.notes.where("deletedAt").above(since).count(),
  ])
  return reviews + edited + deleted
}

/** How many reviews the log holds; the automatic refit paces itself by this. */
export async function countReviews(): Promise<number> {
  return db.revlog.count()
}

/**
 * The whole review log, reduced to what the FSRS optimizer reads. Reviews of
 * deleted questions are kept: they are still real evidence of how memory works.
 */
export async function loadReviewRecords(): Promise<ReviewRecord[]> {
  const rows = await db.revlog.toArray()
  return rows.map(({ cardId, reviewedAt, rating, state }) => ({
    cardId,
    reviewedAt,
    rating,
    state,
  }))
}

/** Every tag used by any note (deleted ones included), sorted, for suggestions. */
export async function loadTagNames(): Promise<string[]> {
  return (await db.notes.orderBy("tags").uniqueKeys()) as string[]
}
