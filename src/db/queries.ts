/**
 * Read-only queries. Writes live in repo/. Call these from `useLiveQuery`, and
 * list the tables a query reads there so it re-runs when they change.
 */
import type { BackupData } from "@/lib/backup"
import { makeBrowseRow, type BrowseRow } from "@/lib/browse"
import type { ReviewRecord } from "@/lib/fsrs"
import { imageIdsInNotes } from "@/lib/image"
import { ZERO_COUNTS, countCards, type DeckCounts } from "@/lib/queue"

import { db } from "./database"
import type { SqlRunner } from "./sql"
import {
  CARDS,
  DECKS,
  IDS,
  IMAGES,
  NOTES,
  REVLOG,
  SETTINGS,
  allRows,
  getRow,
  getRows,
  queryRows,
} from "./tables"
import type {
  BackupImage,
  CardRow,
  Deck,
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
  return db.transaction(async (tx) => {
    const decks = (await allRows(tx, DECKS)).filter((d) => d.deletedAt === null)
    const subjects = decks.filter((d) => d.parentId === null).sort(byName)
    const subjectIds = new Set(subjects.map((s) => s.id))

    const topics = new Map<string, Deck[]>(subjects.map((s) => [s.id, []]))
    for (const deck of decks) {
      if (deck.parentId !== null && subjectIds.has(deck.parentId)) {
        topics.get(deck.parentId)?.push(deck)
      }
    }
    for (const list of topics.values()) list.sort(byName)

    const topicIds = [...topics.values()].flat().map((t) => t.id)
    // A card is not tombstoned with its note, so cards of deleted notes are
    // left out here.
    const cards = await queryRows(
      tx,
      CARDS,
      `WHERE topicId ${IDS}
         AND noteId NOT IN (SELECT id FROM notes WHERE deletedAt IS NOT NULL)`,
      [JSON.stringify(topicIds)]
    )

    const byTopic = new Map<string, CardRow[]>()
    for (const card of cards) {
      const list = byTopic.get(card.topicId)
      if (list) list.push(card)
      else byTopic.set(card.topicId, [card])
    }
    const counts = new Map<string, DeckCounts>()
    for (const id of topicIds) {
      const list = byTopic.get(id)
      counts.set(id, list ? countCards(list, now) : ZERO_COUNTS)
    }

    // The cards of live notes in live Topics, by tag; tags only on deleted
    // questions or in deleted decks have none and are left out.
    const tagged = await tx.select(
      `SELECT t.tag AS tag, c.*
         FROM note_tags t
         JOIN notes n ON n.id = t.noteId
         JOIN cards c ON c.cardId = n.id
        WHERE n.deletedAt IS NULL AND n.topicId ${IDS}
        ORDER BY t.tag`,
      [JSON.stringify(topicIds)]
    )
    const tags: TagSummary[] = []
    let currentTag: string | null = null
    let group: CardRow[] = []
    const flush = () => {
      if (currentTag !== null) {
        tags.push({ tag: currentTag, counts: countCards(group, now) })
      }
    }
    for (const row of tagged) {
      const tag = String(row.tag)
      if (tag !== currentTag) {
        flush()
        currentTag = tag
        group = []
      }
      group.push(CARDS.fromRow(row))
    }
    flush()

    return { subjects, topics, counts, tags }
  })
}

/** Live Subjects, and live Topics under them, as ids and names. */
async function liveDecks(tx: SqlRunner): Promise<{
  subjects: Map<string, Deck>
  topics: Deck[]
}> {
  const decks = (await allRows(tx, DECKS)).filter((d) => d.deletedAt === null)
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
  tx: SqlRunner,
  topics: Deck[],
  scope: QueryScope | null
): Promise<Note[]> {
  const ids = topics.map((t) => t.id)
  const notes =
    scope?.kind === "tag"
      ? await queryRows(
          tx,
          NOTES,
          "WHERE id IN (SELECT noteId FROM note_tags WHERE tag = ?)",
          [scope.id]
        )
      : await queryRows(tx, NOTES, `WHERE topicId ${IDS}`, [
          JSON.stringify(ids),
        ])
  const topicIds = new Set(ids)
  return notes.filter((n) => n.deletedAt === null && topicIds.has(n.topicId))
}

/**
 * The cards a study session can draw from: cards of live notes in live Topics
 * (under live Subjects) within `scope`. Feed the result to `buildQueue`.
 */
export async function loadStudyCards(scope: QueryScope): Promise<CardRow[]> {
  return db.transaction(async (tx) => {
    const { topics } = await liveDecks(tx)
    const notes = await liveNotesIn(tx, topicsInScope(topics, scope), scope)
    return getRows(
      tx,
      CARDS,
      notes.map((n) => n.id)
    )
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
  return db.transaction(async (tx) => {
    const { subjects, topics: allTopics } = await liveDecks(tx)
    const topics = topicsInScope(allTopics, scope)
    const topicById = new Map(topics.map((t) => [t.id, t]))

    const notes = await liveNotesIn(tx, topics, scope)
    const cardById = new Map(
      (
        await getRows(
          tx,
          CARDS,
          notes.map((n) => n.id)
        )
      ).map((card) => [card.cardId, card])
    )

    return notes.map((note) => {
      const topic = topicById.get(note.topicId)
      const subject = topic?.parentId ? subjects.get(topic.parentId) : undefined
      return {
        note,
        row: makeBrowseRow(
          note,
          cardById.get(note.id),
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
  return db.transaction(async (tx) => {
    const card = await getRow(tx, CARDS, cardId)
    if (!card) return null
    const note = await getRow(tx, NOTES, card.noteId)
    if (!note || note.deletedAt !== null) return null
    return { card, note }
  })
}

/** A card with every review of it (oldest first), for the History page. */
export async function loadCardHistory(
  cardId: string
): Promise<{ card: CardRow | null; logs: RevlogRow[] }> {
  return db.transaction(async (tx) => ({
    card: (await getRow(tx, CARDS, cardId)) ?? null,
    logs: await queryRows(tx, REVLOG, "WHERE cardId = ? ORDER BY reviewedAt", [
      cardId,
    ]),
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
  const row = await db.transaction((tx) => getRow(tx, IMAGES, id))
  if (!row) return null
  return {
    src: `data:${row.mime};base64,${row.data}`,
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
  return db.transaction(async (tx) => {
    const data: BackupData = {
      decks: await allRows(tx, DECKS),
      notes: await allRows(tx, NOTES),
      cards: await allRows(tx, CARDS),
      revlog: await allRows(tx, REVLOG),
    }
    const used = imageIdsInNotes(data.notes)
    return {
      data,
      images: await getRows(tx, IMAGES, [...used]),
      settings: await allRows(tx, SETTINGS),
    }
  })
}

async function count(sql: string, params: (string | number)[] = []) {
  const rows = await db.select(sql, params)
  return Number(rows[0]?.n ?? 0)
}

/**
 * How many reviews and question edits (or deletions) were made after `since`
 * (every one when null): the work a backup made then would not contain. Index
 * counts only, so it is cheap on a big log.
 */
export async function countChangesSince(since: number | null): Promise<number> {
  if (since === null) {
    return (
      (await count("SELECT COUNT(*) AS n FROM revlog")) +
      (await count("SELECT COUNT(*) AS n FROM notes"))
    )
  }
  const [reviews, edited, deleted] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM revlog WHERE reviewedAt > ?", [since]),
    count("SELECT COUNT(*) AS n FROM notes WHERE contentUpdatedAt > ?", [
      since,
    ]),
    count("SELECT COUNT(*) AS n FROM notes WHERE deletedAt > ?", [since]),
  ])
  return reviews + edited + deleted
}

/** How many reviews the log holds; the automatic refit paces itself by this. */
export async function countReviews(): Promise<number> {
  return count("SELECT COUNT(*) AS n FROM revlog")
}

/**
 * The whole review log, reduced to what the FSRS optimizer reads. Reviews of
 * deleted questions are kept: they are still real evidence of how memory works.
 */
export async function loadReviewRecords(): Promise<ReviewRecord[]> {
  const rows = await db.select(
    "SELECT cardId, reviewedAt, rating, state FROM revlog"
  )
  return rows.map((row) => ({
    cardId: String(row.cardId),
    reviewedAt: Number(row.reviewedAt),
    rating: Number(row.rating),
    state: Number(row.state),
  }))
}

/** Every tag used by any note (deleted ones included), sorted, for suggestions. */
export async function loadTagNames(): Promise<string[]> {
  const rows = await db.select(
    "SELECT DISTINCT tag FROM note_tags ORDER BY tag"
  )
  return rows.map((row) => String(row.tag))
}

/** Every deck, tombstones included (the import page filters them itself). */
export async function loadDecks(): Promise<Deck[]> {
  return db.transaction((tx) => allRows(tx, DECKS))
}

/** The stored notes of one topic, tombstones included, for the import preview. */
export async function loadTopicNotes(topicId: string): Promise<Note[]> {
  return db.transaction((tx) =>
    queryRows(tx, NOTES, "WHERE topicId = ?", [topicId])
  )
}

/** Every stored setting row. */
export async function loadSettings(): Promise<SettingRow[]> {
  return db.transaction((tx) => allRows(tx, SETTINGS))
}
