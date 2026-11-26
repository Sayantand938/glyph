/**
 * Glyph MCP server.
 *
 * Exposes the desktop app's own data and scheduling to an MCP client such as
 * the OpenCode CLI. It opens the same SQLite file the Tauri app uses and calls
 * the app's real repo/scheduler/importer code, so an MCP review is
 * indistinguishable from a review made in the UI (same FSRS state, same
 * revlog row, same backup).
 *
 * Run it with:
 *   npx tsx mcp/server.ts --db ~/.local/share/app.glyph.desktop/glyph.db
 * (no --db: the app's default data file, see mcp/db.ts)
 */
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { db } from "@/db/database"
import {
  loadBrowseItems,
  loadCardHistory,
  loadDashboard,
  loadDecks,
  loadSettings,
  loadStudyCard,
  loadStudyCounts,
  loadStudyQueueIds,
  readBackupSnapshot,
} from "@/db/queries"
import {
  addNote,
  applyReview,
  buryCard,
  createDeckPath,
  deleteNote,
  saveNote,
  saveSetting,
  setFlag,
  setSuspended,
  softDeleteDeck,
  undoReview,
  unburyCard,
} from "@/db/repo"
import {
  DEFAULT_RETENTION,
  Rating,
  State,
  previewIntervals,
  type Grade,
  type Weights,
} from "@/db/scheduler"
import { NOTES, getRows } from "@/db/tables"
import type { CardRow, Deck, Note } from "@/db/types"
import { exportBackup, serializeBackup, backupFilename } from "@/lib/backup"
import {
  childrenOf,
  deckPath,
  findDeckByPath,
  liveDecks,
  parseDeckPath,
  pathLabel,
  rollupCounts,
  subtreeIds,
} from "@/lib/deck-tree"
import { clampRetention } from "@/lib/retention"
import { validateDraft, cleanDraft, type NoteDraft } from "@/lib/note-edit"
import { leechRule } from "@/lib/leech"
import { resolveSettings } from "@/lib/settings"
import { assembleQueue, endOfLocalDay } from "@/lib/queue"
import { noteId } from "@/lib/hash"
import { parseImportText, validateRows } from "@/lib/importer"
import { commitImport } from "@/db/repo/import-notes"
import type { LeechOutcome } from "@/db/repo/reviews"

import { dbPathFromArgs, openGlyphDb } from "./db"

type TextResult = {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

function text(value: unknown): TextResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

function failure(error: unknown): TextResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true }
}

/** Wraps a tool body so a thrown repo/scheduler error becomes a readable result. */
function tool<A>(fn: (args: A) => Promise<TextResult>) {
  return async (args: A): Promise<TextResult> => {
    try {
      return await fn(args)
    } catch (error) {
      return failure(error)
    }
  }
}

interface DeckRef {
  decks: Deck[]
  live: Deck[]
}

async function deckRef(): Promise<DeckRef> {
  const decks = await loadDecks()
  return { decks, live: liveDecks(decks) }
}

/** A deck id, or a path typed as "WBCS > Mains > 2018". */
function findDeck(live: readonly Deck[], ref: string): Deck | null {
  const byId = live.find((d) => d.id === ref)
  return byId ?? findDeckByPath(live, parseDeckPath(ref))
}

async function requireDeck(ref: string): Promise<Deck> {
  const { live } = await deckRef()
  const deck = findDeck(live, ref)
  if (!deck) {
    const paths = live
      .map((d) => pathLabel(deckPath(live, d.id)))
      .sort()
      .slice(0, 20)
    throw new Error(
      `Deck not found: ${JSON.stringify(ref)}. Known decks include: ${paths.join(" | ") || "(none)"}`
    )
  }
  return deck
}

function cardView(note: Note, card: CardRow) {
  const interval =
    card.state === State.New
      ? null
      : previewIntervals(card, Date.now(), DEFAULT_RETENTION)
  return {
    id: note.id,
    deckId: note.topicId,
    question: note.question,
    options: note.options,
    correctIndex: note.correctIndex,
    extra: note.extra,
    tags: note.tags,
    card: {
      state: State[card.state],
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      flag: card.flag,
      suspended: card.suspended,
      buriedUntil: card.buriedUntil,
    },
    next: interval,
  }
}

async function notesFor(ids: readonly string[]): Promise<Map<string, Note>> {
  const rows = await db.transaction((tx) => getRows(tx, NOTES, ids))
  return new Map(rows.map((note) => [note.id, note]))
}

/** Reviews made through this process, so `glyph_undo_review` can take one back. */
const lastReviews = new Map<
  string,
  { logId: string; previous: CardRow; leech: LeechOutcome | null }
>()


const server = new McpServer({
  name: "glyph",
  version: "0.5.0",
})

server.registerTool(
  "glyph_status",
  {
    title: "Glyph status",
    description:
      "Database path, schema version, deck/note/card/review counts, and how many cards are due today.",
    inputSchema: z.object({}),
  },
  tool(async () => {
    const now = Date.now()
    const [dash, decks, settingsRows, counts, log] = await Promise.all([
      loadDashboard(now),
      loadDecks(),
      loadSettings(),
      db.select(
        `SELECT
           (SELECT COUNT(*) FROM cards) AS cards,
           (SELECT COUNT(*) FROM notes WHERE deletedAt IS NULL) AS notes,
           (SELECT COUNT(*) FROM revlog) AS reviews,
           (SELECT MAX(reviewedAt) FROM revlog) AS lastReview,
           (SELECT user_version FROM pragma_user_version) AS schemaVersion`
      ),
      db.select(
        "SELECT COUNT(*) AS n, SUM(correct) AS correct FROM revlog WHERE reviewedAt >= ?",
        [now - 30 * 86_400_000]
      ),
    ])
    const totals = { new: 0, learning: 0, due: 0 }
    for (const c of dash.counts.values()) {
      totals.new += c.new
      totals.learning += c.learning
      totals.due += c.due
    }
    const row = counts[0] ?? {}
    const recent = log[0] ?? {}
    return text({
      database: process.env.GLYPH_DB || undefined,
      schemaVersion: Number(row.schemaVersion ?? 0),
      liveDecks: liveDecks(decks).length,
      notes: Number(row.notes ?? 0),
      cards: Number(row.cards ?? 0),
      reviews: Number(row.reviews ?? 0),
      lastReviewAt: row.lastReview ? new Date(Number(row.lastReview)).toISOString() : null,
      dueToday: totals,
      reviewsLast30Days: Number(recent.n ?? 0),
      correctLast30Days: Number(recent.correct ?? 0),
      settings: resolveSettings(settingsRows),
    })
  })
)

server.registerTool(
  "glyph_list_decks",
  {
    title: "List decks",
    description: "The live deck tree with each deck's own and rolled-up study counts.",
    inputSchema: z.object({}),
  },
  tool(async () => {
    const now = Date.now()
    const [dash, { live }] = await Promise.all([loadDashboard(now), deckRef()])
    const total = rollupCounts(childrenOf(live), dash.counts)
    return text({
      decks: live.map((deck) => ({
        id: deck.id,
        name: deck.name,
        parentId: deck.parentId,
        path: pathLabel(deckPath(live, deck.id)),
        own: dash.counts.get(deck.id) ?? { new: 0, learning: 0, due: 0 },
        total: total.get(deck.id) ?? { new: 0, learning: 0, due: 0 },
      })),
    })
  })
)

server.registerTool(
  "glyph_create_deck",
  {
    title: "Create deck",
    description:
      "Create a deck (or a nested path such as 'WBCS > Mains > 2018'). Missing levels are created; an existing path is an error.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Deck path, levels separated by '>'."),
    }),
  },
  tool(async ({ path }) => {
    const deck = await createDeckPath(parseDeckPath(path))
    const { live } = await deckRef()
    return text({ deck: { id: deck.id, path: pathLabel(deckPath(live, deck.id)) } })
  })
)

server.registerTool(
  "glyph_list_cards",
  {
    title: "List / search cards",
    description:
      "List cards (questions) in a deck subtree or with a tag, optionally filtered by study state and search text.",
    inputSchema: z.object({
      deck: z.string().optional().describe("Deck id or path; omitted = every deck."),
      tag: z.string().optional().describe("Tag to filter by (spans decks)."),
      state: z.enum(["new", "learning", "due", "all"]).default("all"),
      search: z.string().optional().describe("Case-insensitive text in question, options, extra or tags."),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  },
  tool(async ({ deck, tag, state, search, limit, offset }) => {
    let scope: { kind: "deck" | "tag"; id: string } | null = null
    if (tag) scope = { kind: "tag", id: tag }
    else if (deck) scope = { kind: "deck", id: (await requireDeck(deck)).id }

    const items = await loadBrowseItems(scope)
    const now = Date.now()
    const endOfDay = endOfLocalDay(now)
    const needle = search?.toLowerCase().trim()
    const wanted = state
    const filtered = items.filter(({ row }) => {
      if (needle && !row.search.includes(needle)) return false
      if (wanted === "new") return row.state === State.New
      if (wanted === "learning")
        return row.state === State.Learning || row.state === State.Relearning
      if (wanted === "due") return row.state === State.Review && row.due <= endOfDay
      return true
    })
    const page = filtered.slice(offset, offset + limit)
    return text({
      total: filtered.length,
      offset,
      limit,
      cards: page.map(({ note, row }) => ({
        id: note.id,
        deck: row.deckPath,
        deckId: note.topicId,
        question: note.question,
        preview: row.preview,
        options: note.options,
        correctIndex: note.correctIndex,
        tags: note.tags,
        state: State[row.state],
        due: row.due,
        reps: row.reps,
        lapses: row.lapses,
        suspended: row.suspended,
        flag: row.flag,
      })),
    })
  })
)

server.registerTool(
  "glyph_get_card",
  {
    title: "Get card",
    description: "One question with its note, scheduling state, interval previews and review history.",
    inputSchema: z.object({ id: z.string().min(1) }),
  },
  tool(async ({ id }) => {
    const view = await loadStudyCard(id)
    if (!view) throw new Error("Card not found (or its note is deleted).")
    const history = await loadCardHistory(id)
    return text({
      ...cardView(view.note, view.card),
      history: history.logs.map((log) => ({
        reviewedAt: log.reviewedAt,
        rating: log.rating === Rating.Again ? "again" : log.rating === Rating.Good ? "good" : log.rating,
        stateBefore: State[log.state],
        correct: log.correct,
        stabilityAfter: log.stabilityAfter,
        scheduledDaysAfter: log.scheduledDaysAfter,
        dueAfter: log.dueAfter,
      })),
    })
  })
)

server.registerTool(
  "glyph_add_note",
  {
    title: "Add question",
    description:
      "Add one four-option MCQ to a deck. The id is deterministic, so adding the same question twice is refused.",
    inputSchema: z.object({
      deck: z.string().min(1).describe("Deck id or path."),
      question: z.string().min(1),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      extra: z.string().default(""),
      tags: z.array(z.string()).default([]),
    }),
  },
  tool(async ({ deck, question, options, correctIndex, extra, tags }) => {
    const target = await requireDeck(deck)
    const draft = cleanDraft({
      question,
      options: options as NoteDraft["options"],
      correctIndex: correctIndex as NoteDraft["correctIndex"],
      extra,
      tags,
    })
    const { valid, errors } = validateDraft(draft)
    if (!valid) {
      throw new Error(
        [
          errors.question,
          ...errors.options,
          errors.tags,
        ]
          .filter(Boolean)
          .join(" ")
      )
    }
    const note = await addNote(target.id, draft)
    return text({ id: note.id, question: note.question, deckId: note.topicId })
  })
)

server.registerTool(
  "glyph_update_note",
  {
    title: "Edit question",
    description:
      "Edit a question's text, options, answer, explanation or tags. FSRS progress is kept unless resetFsrs is true.",
    inputSchema: z.object({
      id: z.string().min(1),
      question: z.string().optional(),
      options: z.array(z.string()).length(4).optional(),
      correctIndex: z.number().int().min(0).max(3).optional(),
      extra: z.string().optional(),
      tags: z.array(z.string()).optional(),
      resetFsrs: z.boolean().default(false),
    }),
  },
  tool(async ({ id, question, options, correctIndex, extra, tags, resetFsrs }) => {
    const view = await loadStudyCard(id)
    if (!view) throw new Error("Card not found (or its note is deleted).")
    const draft = cleanDraft({
      question: question ?? view.note.question,
      options: (options ?? view.note.options) as NoteDraft["options"],
      correctIndex: (correctIndex ?? view.note.correctIndex) as NoteDraft["correctIndex"],
      extra: extra ?? view.note.extra,
      tags: tags ?? view.note.tags,
    })
    const { valid, errors } = validateDraft(draft)
    if (!valid) {
      throw new Error(
        [errors.question, ...errors.options, errors.tags].filter(Boolean).join(" ")
      )
    }
    const note: Note = {
      ...view.note,
      question: draft.question,
      options: draft.options,
      correctIndex: draft.correctIndex,
      extra: draft.extra,
      tags: draft.tags,
    }
    const saved = await saveNote(note, { resetFsrs })
    return text({ id: saved.id, question: saved.question, resetFsrs })
  })
)

server.registerTool(
  "glyph_delete_note",
  {
    title: "Delete question",
    description: "Soft-delete a question. Its card and review history stay, so a re-import revives its progress.",
    inputSchema: z.object({ id: z.string().min(1) }),
  },
  tool(async ({ id }) => {
    await deleteNote(id)
    return text({ deleted: id })
  })
)

server.registerTool(
  "glyph_delete_deck",
  {
    title: "Delete deck",
    description: "Soft-delete a deck, every deck below it and their questions.",
    inputSchema: z.object({ deck: z.string().min(1) }),
  },
  tool(async ({ deck }) => {
    const target = await requireDeck(deck)
    await softDeleteDeck(target.id)
    return text({ deleted: target.id })
  })
)

server.registerTool(
  "glyph_import_json",
  {
    title: "Import questions from JSON",
    description:
      "Import an array of {questions, op1..op4, answer, extra?, tags?} rows into a deck path. Existing questions are updated without losing FSRS progress.",
    inputSchema: z.object({
      deck: z.string().min(1).describe("Deck path, e.g. 'WBCS > Mains'."),
      json: z.string().optional().describe("The JSON array as text."),
      file: z.string().optional().describe("Path to a JSON file (used when json is omitted)."),
    }),
  },
  tool(async ({ deck, json, file }) => {
    if (!json && !file) throw new Error("Pass either json or file.")
    const source = json ?? (await import("node:fs")).readFileSync(resolve(file as string), "utf8")
    const parsed = parseImportText(source)
    if (!parsed.ok) throw new Error(parsed.error)
    const { valid, invalid } = validateRows(parsed.rows)
    if (valid.length === 0) {
      throw new Error(`No valid rows. First problems: ${JSON.stringify(invalid.slice(0, 5))}`)
    }
    const summary = await commitImport(
      { path: parseDeckPath(deck) },
      valid,
      invalid.length
    )
    return text({
      summary,
      invalid: invalid.slice(0, 20),
      invalidTotal: invalid.length,
    })
  })
)

server.registerTool(
  "glyph_study_queue",
  {
    title: "Build a study queue",
    description:
      "The ordering the app's study screen would use: learning due now, then due reviews (least stable first), then new cards, optionally mixed. Returns card ids and questions so they can be reviewed with glyph_review_card.",
    inputSchema: z.object({
      deck: z.string().optional().describe("Deck id or path; omitted = every deck."),
      now: z.number().int().optional().describe("ms epoch; default now."),
      seed: z.string().default("mcp"),
      mixed: z.boolean().default(false),
      newLimit: z.number().int().min(0).optional().describe("Cap new cards; omitted = all."),
      limit: z.number().int().min(1).max(500).default(20).describe("How many cards to return."),
    }),
  },
  tool(async ({ deck, now, seed, mixed, newLimit, limit }) => {
    const at = now ?? Date.now()
    const scope = deck ? { kind: "deck" as const, id: (await requireDeck(deck)).id } : null
    const [ids, counts] = await Promise.all([
      loadStudyQueueIds(scope, at, { newLimit: newLimit ?? null }),
      loadStudyCounts(scope, at),
    ])
    const queue = assembleQueue(ids, seed, mixed)
    const pageIds = queue.slice(0, limit)
    const notes = await notesFor(pageIds)
    return text({
      counts,
      queueLength: queue.length,
      cards: pageIds.map((id) => {
        const note = notes.get(id)
        return {
          id,
          question: note?.question ?? null,
          options: note?.options ?? null,
          correctIndex: note?.correctIndex ?? null,
          extra: note?.extra ?? null,
        }
      }),
    })
  })
)

server.registerTool(
  "glyph_review_card",
  {
    title: "Review a card",
    description:
      "Grade a card exactly like the study screen: 'again' (fail) or 'good' (pass). Writes the card and a review log row atomically and returns the next interval.",
    inputSchema: z.object({
      cardId: z.string().min(1),
      rating: z.enum(["again", "good"]),
      durationMs: z.number().int().min(0).default(0),
      correct: z.boolean().optional().describe("Was the picked option right? Default: pass = right."),
      answerMs: z.number().int().min(0).optional(),
      now: z.number().int().optional(),
    }),
  },
  tool(async ({ cardId, rating, durationMs, correct, answerMs, now }) => {
    const view = await loadStudyCard(cardId)
    if (!view) throw new Error("Card not found (or its note is deleted).")
    if (view.card.suspended) throw new Error("This card is suspended; unsuspend it first.")
    const settings = resolveSettings(await loadSettings())
    const weights = (settings.fit.weights ?? undefined) as Weights | undefined
    const rule = leechRule(settings.leechThreshold, settings.leechAction)
    const grade: Grade = rating === "again" ? Rating.Again : Rating.Good
    const at = now ?? Date.now()
    const result = await applyReview(
      view.card,
      grade,
      durationMs,
      settings.retention,
      weights,
      at,
      {
        correct: correct ?? grade === Rating.Good,
        answerMs: answerMs ?? durationMs,
      },
      rule ?? undefined
    )
    lastReviews.set(cardId, {
      logId: result.log.id,
      previous: view.card,
      leech: result.leech,
    })
    return text({
      cardId,
      rating,
      stateBefore: State[view.card.state],
      stateAfter: State[result.row.state],
      due: result.row.due,
      stability: result.row.stability,
      difficulty: result.row.difficulty,
      scheduledDays: result.row.scheduledDays,
      lapses: result.row.lapses,
      leech: result.leech,
      interval: previewIntervals(result.row, at, settings.retention, weights),
    })
  })
)

server.registerTool(
  "glyph_undo_review",
  {
    title: "Undo the last review",
    description:
      "Take back the most recent review this server made on a card: restores the previous card row and deletes its log row.",
    inputSchema: z.object({ cardId: z.string().min(1) }),
  },
  tool(async ({ cardId }) => {
    const last = lastReviews.get(cardId)
    if (!last) throw new Error("No review from this server to undo for that card.")
    const ok = await undoReview(last.logId, last.previous, last.leech)
    if (!ok) throw new Error("That review is no longer the latest; it was not undone.")
    lastReviews.delete(cardId)
    return text({ undone: cardId, restored: last.previous })
  })
)

server.registerTool(
  "glyph_set_card_mark",
  {
    title: "Flag / suspend / bury a card",
    description: "Set or clear a card's flag, suspend/unsuspend it, or bury/unbury it until tomorrow.",
    inputSchema: z.object({
      cardId: z.string().min(1),
      action: z.enum(["flag", "suspend", "unsuspend", "bury", "unbury"]),
      flag: z.number().int().min(0).max(7).optional().describe("Colour for action=flag; 0 clears."),
    }),
  },
  tool(async ({ cardId, action, flag }) => {
    if (action === "flag") await setFlag(cardId, flag ?? 0)
    else if (action === "suspend") await setSuspended(cardId, true)
    else if (action === "unsuspend") await setSuspended(cardId, false)
    else if (action === "bury") await buryCard(cardId)
    else await unburyCard(cardId)
    const view = await loadStudyCard(cardId)
    return text({
      cardId,
      action,
      card: view
        ? {
            suspended: view.card.suspended,
            flag: view.card.flag,
            buriedUntil: view.card.buriedUntil,
          }
        : null,
    })
  })
)

server.registerTool(
  "glyph_stats",
  {
    title: "Study statistics",
    description:
      "Card states, due counts, reviews and true-recall rate over the last 30 days, plus per-deck totals.",
    inputSchema: z.object({}),
  },
  tool(async () => {
    const now = Date.now()
    const [dash, { live }, states, recent] = await Promise.all([
      loadDashboard(now),
      deckRef(),
      db.select("SELECT state, COUNT(*) AS n FROM cards GROUP BY state"),
      db.select(
        `SELECT COUNT(*) AS reviews, SUM(correct) AS correct, AVG(durationMs) AS meanMs
         FROM revlog WHERE reviewedAt >= ?`,
        [now - 30 * 86_400_000]
      ),
    ])
    const total = rollupCounts(childrenOf(live), dash.counts)
    const byState: Record<string, number> = {}
    for (const row of states) byState[State[Number(row.state)] ?? String(row.state)] = Number(row.n)
    const r = recent[0] ?? {}
    return text({
      cardsByState: byState,
      reviewsLast30Days: Number(r.reviews ?? 0),
      correctLast30Days: Number(r.correct ?? 0),
      meanAnswerMsLast30Days: r.meanMs === null ? null : Math.round(Number(r.meanMs)),
      decks: live.map((deck) => ({
        id: deck.id,
        path: pathLabel(deckPath(live, deck.id)),
        total: total.get(deck.id) ?? { new: 0, learning: 0, due: 0 },
      })),
    })
  })
)

server.registerTool(
  "glyph_get_settings",
  {
    title: "Get settings",
    description: "The synced study settings: retention, fitted FSRS weights, leech rule.",
    inputSchema: z.object({}),
  },
  tool(async () => text(resolveSettings(await loadSettings())))
)

server.registerTool(
  "glyph_set_retention",
  {
    title: "Set desired retention",
    description: "Set the FSRS target retention (0.70-0.97; 70-97 also accepted). Applies to future reviews.",
    inputSchema: z.object({ retention: z.number() }),
  },
  tool(async ({ retention }) => {
    const value = clampRetention(retention > 1 ? retention / 100 : retention)
    await saveSetting("retention", value)
    return text({ retention: value })
  })
)

server.registerTool(
  "glyph_export_backup",
  {
    title: "Export backup",
    description:
      "Write the app's JSON backup (decks, notes, cards, review log, used images, settings) to a file.",
    inputSchema: z.object({
      path: z.string().optional().describe("Destination .json path; default in the current directory."),
    }),
  },
  tool(async ({ path }) => {
    const now = Date.now()
    const snapshot = await readBackupSnapshot()
    const file = exportBackup(snapshot.data, now, snapshot.images, snapshot.settings)
    const target = resolve(path ?? backupFilename(now))
    const json = serializeBackup(file)
    writeFileSync(target, json)
    return text({
      path: target,
      bytes: Buffer.byteLength(json),
      decks: file.decks.length,
      notes: file.notes.length,
      cards: file.cards.length,
      reviews: file.revlog.length,
      images: file.images.length,
      settings: file.settings.length,
    })
  })
)

server.registerTool(
  "glyph_resolve_path",
  {
    title: "Resolve a deck path",
    description: "Look a deck up by id or path and return its id, path, subtree and counts.",
    inputSchema: z.object({ deck: z.string().min(1) }),
  },
  tool(async ({ deck }) => {
    const { live } = await deckRef()
    const found = findDeck(live, deck)
    if (!found) return text({ found: false })
    const ids = new Set(subtreeIds(childrenOf(live), found.id))
    const dash = await loadDashboard(Date.now())
    let newCount = 0
    let learning = 0
    let due = 0
    for (const [id, counts] of dash.counts) {
      if (!ids.has(id)) continue
      newCount += counts.new
      learning += counts.learning
      due += counts.due
    }
    return text({
      found: true,
      id: found.id,
      path: pathLabel(deckPath(live, found.id)),
      decksInSubtree: ids.size,
      counts: { new: newCount, learning, due },
    })
  })
)

server.registerTool(
  "glyph_card_id",
  {
    title: "Preview a note id",
    description:
      "The deterministic id a question would get in a deck. Use it to check whether a question already exists before adding it.",
    inputSchema: z.object({
      deck: z.string().min(1),
      question: z.string().min(1),
    }),
  },
  tool(async ({ deck, question }) => {
    const target = await requireDeck(deck)
    const id = noteId(target.id, question)
    const rows = await notesFor([id])
    return text({ id, deckId: target.id, exists: rows.has(id) })
  })
)

async function main() {
  const opened = await openGlyphDb(dbPathFromArgs(process.argv.slice(2)))
  // The tools read the path env var for display; keep it in sync with --db.
  process.env.GLYPH_DB = opened.path
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stderr only: stdout carries the MCP protocol.
  console.error(`glyph MCP server ready: ${opened.path}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
