# Glyph MCP server

This exposes a Glyph database to an MCP client (OpenCode CLI, Claude Desktop,
etc.). It is not a second implementation: it opens the same SQLite file the
desktop app uses and calls Glyph's real `src/db` repo, `ts-fsrs` scheduler and
importer, so a review made over MCP writes the same card row and revlog entry as
a review in the UI.

## Run it

```bash
npm install --legacy-peer-deps
npm run mcp -- --db ~/.local/share/app.glyph.desktop/glyph.db
```

Without `--db` it uses the app's data file for the platform:

| Platform | Default |
| --- | --- |
| Linux | `$XDG_DATA_HOME/app.glyph.desktop/glyph.db` or `~/.local/share/app.glyph.desktop/glyph.db` |
| macOS | `~/Library/Application Support/app.glyph.desktop/glyph.db` |
| Windows | `%APPDATA%\app.glyph.desktop\glyph.db` |

`GLYPH_DB` works too. A missing file is created, migrated and seeded exactly
like the app's first start. The server speaks MCP over stdio; logs go to stderr.

The database is opened in WAL mode with a 5 s busy timeout, so it can share the
file with a running app. Close Glyph, or finish a session, before a long import
or backup if the app reports a busy database.

## OpenCode

The repo ships `opencode.json`, which starts the server in this project:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "glyph": {
      "type": "local",
      "command": ["npx", "tsx", "mcp/server.ts"],
      "enabled": true
    }
  }
}
```

To point at another file add an environment entry:

```json
{ "environment": { "GLYPH_DB": "/path/to/glyph.db" } }
```

Then an OpenCode agent can call `glyph_*` tools directly.

## Tools

| Tool | What it does |
| --- | --- |
| `glyph_status` | DB path, schema version, counts, due today, last-30-day reviews |
| `glyph_list_decks` | Deck tree with own and rolled-up new/learning/due counts |
| `glyph_create_deck` | Create a deck or nested path (`A > B > C`) |
| `glyph_list_cards` | Search/filter cards by deck, tag, state, text |
| `glyph_get_card` | One card with interval previews and full review history |
| `glyph_add_note` | Add a four-option MCQ |
| `glyph_update_note` | Edit text/options/answer/tags; optional FSRS reset |
| `glyph_delete_note` | Soft-delete a question (progress kept for re-import) |
| `glyph_delete_deck` | Soft-delete a deck subtree |
| `glyph_import_json` | Import the app's JSON array into a deck path |
| `glyph_study_queue` | Build the app's study order (learning, due, new) |
| `glyph_review_card` | Grade `again`/`good`; writes card + revlog atomically |
| `glyph_undo_review` | Undo the last review this server made |
| `glyph_set_card_mark` | Flag, suspend/unsuspend, bury/unbury |
| `glyph_stats` | Card states, 30-day reviews/recall, per-deck totals |
| `glyph_get_settings` / `glyph_set_retention` | Synced study settings |
| `glyph_export_backup` | Write the app's JSON backup |
| `glyph_resolve_path` | Resolve a deck path to id/subtree/counts |
| `glyph_card_id` | Preview the deterministic id of a question |

## Check it

```bash
npm run mcp:smoke
```

The smoke test starts the server on a temporary database and exercises create
deck -> add note -> queue -> review -> history -> undo -> import -> backup.

There is also a read-path performance probe:

```bash
npx tsx mcp/bench.ts 150000
```
