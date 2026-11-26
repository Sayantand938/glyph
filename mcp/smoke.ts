/**
 * End-to-end smoke test for the Glyph MCP server: starts it over stdio, then
 * drives the full loop an OpenCode client would (create deck, add a question,
 * build the queue, review, undo, import, back up).
 *
 *   npx tsx mcp/smoke.ts
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const dir = mkdtempSync(join(tmpdir(), "glyph-mcp-"))
const dbPath = join(dir, "glyph.db")

function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text?: string }[] }).content
  const first = content?.find((part) => part.type === "text")?.text
  if (!first) throw new Error("Tool returned no text")
  return JSON.parse(first) as Record<string, unknown>
}

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts", "--db", dbPath],
    cwd: process.cwd(),
    stderr: "pipe",
  })
  const client = new Client({ name: "glyph-smoke", version: "1.0.0" })
  await client.connect(transport)

  const list = await client.listTools()
  console.log(`tools (${list.tools.length}): ${list.tools.map((t) => t.name).join(", ")}`)

  const status = payload(await client.callTool({ name: "glyph_status", arguments: {} }))
  console.log("status:", JSON.stringify({ liveDecks: status.liveDecks, notes: status.notes, due: status.dueToday }))

  const created = payload(
    await client.callTool({
      name: "glyph_create_deck",
      arguments: { path: "MCP Test > Sub Deck" },
    })
  )
  console.log("created deck:", created.deck)

  const added = payload(
    await client.callTool({
      name: "glyph_add_note",
      arguments: {
        deck: "MCP Test > Sub Deck",
        question: "What does MCP stand for?",
        options: ["Model Context Protocol", "Multi Chat Program", "Main Control Port", "Managed Context Pool"],
        correctIndex: 0,
        extra: "A protocol for exposing tools to models.",
        tags: ["mcp", "test"],
      },
    })
  )
  console.log("added note:", added.id)

  const cards = payload(
    await client.callTool({
      name: "glyph_list_cards",
      arguments: { deck: "MCP Test", state: "new" },
    })
  )
  console.log("new cards in MCP Test:", cards.total)

  const queue = payload(
    await client.callTool({
      name: "glyph_study_queue",
      arguments: { deck: "MCP Test", limit: 5 },
    })
  )
  console.log("queue:", {
    length: queue.queueLength,
    counts: queue.counts,
    first: (queue.cards as { id: string; question: string }[])[0],
  })

  const reviewed = payload(
    await client.callTool({
      name: "glyph_review_card",
      arguments: { cardId: added.id, rating: "good", durationMs: 4200, correct: true },
    })
  )
  console.log("reviewed:", {
    stateBefore: reviewed.stateBefore,
    stateAfter: reviewed.stateAfter,
    interval: reviewed.interval,
    leech: reviewed.leech,
  })

  const card = payload(
    await client.callTool({ name: "glyph_get_card", arguments: { id: added.id } })
  )
  console.log("history rows after review:", (card.history as unknown[]).length)

  const undone = payload(
    await client.callTool({ name: "glyph_undo_review", arguments: { cardId: added.id } })
  )
  console.log("undo restored state:", (undone.restored as { state: number }).state)

  const imported = payload(
    await client.callTool({
      name: "glyph_import_json",
      arguments: {
        deck: "MCP Test > Imported",
        json: JSON.stringify([
          { questions: "2 + 2?", op1: "4", op2: "3", op3: "5", op4: "22", answer: "4" },
          { questions: "Capital of France?", op1: "Paris", op2: "Rome", op3: "Madrid", op4: "Berlin", answer: "Paris", tags: ["geo"] },
        ]),
      },
    })
  )
  console.log("import:", imported.summary)

  const backupPath = join(dir, "backup.json")
  const backup = payload(
    await client.callTool({
      name: "glyph_export_backup",
      arguments: { path: backupPath },
    })
  )
  console.log("backup:", { bytes: backup.bytes, notes: backup.notes, reviews: backup.reviews })
  if (!existsSync(backupPath)) throw new Error("Backup file was not written")
  const parsed = JSON.parse(readFileSync(backupPath, "utf8")) as { app: string; notes: unknown[] }
  if (parsed.app !== "mcq-srs") throw new Error("Backup envelope is wrong")

  const stats = payload(await client.callTool({ name: "glyph_stats", arguments: {} }))
  console.log("stats:", { cardsByState: stats.cardsByState, reviewsLast30Days: stats.reviewsLast30Days })

  await client.close()
  rmSync(dir, { recursive: true, force: true })
  console.log("\nMCP smoke test passed")
}

main().catch((error) => {
  console.error(error)
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
  process.exit(1)
})
