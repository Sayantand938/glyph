/**
 * Read-only queries. Writes live in repo/. Call these from `useLiveQuery`, and
 * list the tables a query reads there so it re-runs when they change.
 */
import type { BackupData } from "@/lib/backup"
import { makeBrowseRow, type BrowseRow } from "@/lib/browse"
import type { ReviewRecord } from "@/lib/fsrs"
import { imageIdsInNotes } from "@/lib/image"
import {
  childrenOf,
  deckPath,
  liveDecks,
  pathLabel,
  subtreeIds,
} from "@/lib/deck-tree"
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
 * What a study session or the browse list covers: one deck together with
 * everything below it, or every question carrying one tag (`id` is then the tag).
 */
export interface QueryScope {
  kind: "deck" | "tag"
  id: string
}

export interface DashboardData {
  /** Live decks by parent id (`null` = the top level), each list in name order. */
  children: Map<string | null, Deck[]>
  /** Counts of each live deck's own cards (not those of the decks below it). */
  counts: Map<string, DeckCounts>
}

/** The live decks (not deleted, every ancestor live too). */
async function liveDeckList(tx: SqlRunner): Promise<Deck[]> {
  return liveDecks(await allRows(tx, DECKS))
}

/**
 * Everything the dashboard shows. Counts only include cards of live notes in
 * live decks (a card is not tombstoned with its note); rolling them up the tree
 * is `rollupCounts`.
 */
export async function loadDashboard(now: number): Promise<DashboardData> {
  return db.transaction(async (tx) => {
    const decks = await liveDeckList(tx)
    const deckIds = decks.map((d) => d.id)
    // A card is not tombstoned with its note, so cards of deleted notes are
    // left out here.
    const cards = await queryRows(
      tx,
      CARDS,
      `WHERE topicId ${IDS}
         AND noteId NOT IN (SELECT id FROM notes WHERE deletedAt IS NOT NULL)`,
      [JSON.stringify(deckIds)]
    )

    const byDeck = new Map<string, CardRow[]>()
    for (const card of cards) {
      const list = byDeck.get(card.topicId)
      if (list) list.push(card)
      else byDeck.set(card.topicId, [card])
    }
    const counts = new Map<string, DeckCounts>()
    for (const id of deckIds) {
      const list = byDeck.get(id)
      counts.set(id, list ? countCards(list, now) : ZERO_COUNTS)
    }

    return { children: childrenOf(decks), counts }
  })
}

/** The live decks a scope covers (all of them for a tag, which spans decks). */
function decksInScope(decks: Deck[], scope: QueryScope | null): Deck[] {
  if (scope === null || scope.kind === "tag") return decks
  const covered = new Set(subtreeIds(childrenOf(decks), scope.id))
  return decks.filter((d) => covered.has(d.id))
}

/** The live notes of `decks`; with a tag scope only those carrying the tag. */
async function liveNotesIn(
  tx: SqlRunner,
  decks: Deck[],
  scope: QueryScope | null
): Promise<Note[]> {
  const ids = decks.map((d) => d.id)
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
  const deckIds = new Set(ids)
  return notes.filter((n) => n.deletedAt === null && deckIds.has(n.topicId))
}

/**
 * The cards a study session can draw from: cards of live notes in live decks
 * within `scope` (a deck and everything below it). Feed the result to `buildQueue`.
 */
export async function loadStudyCards(scope: QueryScope): Promise<CardRow[]> {
  return db.transaction(async (tx) => {
    const decks = await liveDeckList(tx)
    const notes = await liveNotesIn(tx, decksInScope(decks, scope), scope)
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
 * the browse list: live notes in live decks, each with its deck's full path.
 */
export async function loadBrowseItems(
  scope: QueryScope | null
): Promise<BrowseItem[]> {
  return db.transaction(async (tx) => {
    const live = await liveDeckList(tx)
    const decks = decksInScope(live, scope)
    const deckById = new Map(decks.map((d) => [d.id, d]))

    const notes = await liveNotesIn(tx, decks, scope)
    const cardById = new Map(
      (
        await getRows(
          tx,
          CARDS,
          notes.map((n) => n.id)
        )
      ).map((card) => [card.cardId, card])
    )

    const labels = new Map<string, string>()
    const label = (id: string): string => {
      let found = labels.get(id)
      if (found === undefined) {
        found = pathLabel(deckPath(live, id))
        labels.set(id, found)
      }
      return found
    }

    return notes.map((note) => ({
      note,
      row: makeBrowseRow(
        note,
        cardById.get(note.id),
        deckById.get(note.topicId)?.name ?? "",
        label(note.topicId)
      ),
    }))
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

/** How many reviews the log holds; the "time to refit" reminder counts from this. */
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

/** What a deck's own screen needs. */
export interface DeckInfo {
  deck: Deck
  /** The decks from the top one down to `deck` (itself last). */
  path: Deck[]
  /** Live decks with the same parent, `deck` included (to catch duplicate names). */
  siblings: Deck[]
  /** Its live sub-decks, in name order. */
  children: Deck[]
  /** How many live decks are below it, at any depth. */
  descendants: number
}

/** The live deck `id`, or null when it is gone (deleted, or under a deleted deck). */
export async function loadDeckInfo(id: string): Promise<DeckInfo | null> {
  const live = liveDecks(await loadDecks())
  const deck = live.find((d) => d.id === id)
  if (!deck) return null
  const children = childrenOf(live)
  return {
    deck,
    path: deckPath(live, id),
    siblings: children.get(deck.parentId) ?? [],
    children: children.get(id) ?? [],
    descendants: subtreeIds(children, id).length - 1,
  }
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
