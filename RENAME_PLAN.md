# Rename plan: Note / CardRow / Revlog -> Question / Progress / Review

Status: **not started** (saved for later). Drafted 2026-11-23.

## Why

The code says "note" for the question content and "card" for the scheduling
row, while the UI says "card" for the thing you study. The app only has MCQ
questions and the relation is strictly 1:1 (`cardId === noteId`), so the Anki
vocabulary adds confusion. Name each thing for what it is.

| Now | Rename to |
|---|---|
| `Note` / `notes` / `noteId` | `Question` / `questions` / `questionId` |
| `CardRow` / `cards` / `cardId` | `Progress` / `progress`, keyed by `questionId` (drop the redundant `cardId`) |
| `RevlogRow` / `revlog` (`cardId`) | `Review` / `reviews` (`questionId`) |

Keep two entities (do not merge question and progress into one row): they
merge on different timestamps (`contentUpdatedAt` vs `updatedAt`), and "re-import
never touches progress" is easiest to enforce with separate tables.

## Defaults (confirm before starting)

1. **Local data:** add `db.version(2)` that copies `notes`, `cards`, `revlog`
   into `questions`, `progress`, `reviews` and drops the old tables. Keeps the
   browser's existing data and respects rule 6 (never edit `version(1)`).
2. **Old backup files:** bump the backup `schemaVersion`; the parser rejects old
   files with a clear message.
3. **UI wording:** "question" for the content; "card" stays as casual wording
   (e.g. "Next Card").
4. **`Deck`:** leave as is (Subject/Topic share one self-referencing table).

## Steps (typecheck + tests after each)

1. **Types and schema** (`src/db/types.ts`, `src/db/database.ts`): rename the
   types, tables and indexes, key `Progress` by `questionId`, add the v2
   migration, rename `BackupFile` fields and bump `schemaVersion`.
2. **Pure logic in `src/lib/`:** `backup/` (types, parse, read-rows, merge, pick,
   summary, export), `queue.ts`, `session.ts`, `hash.ts` (`noteId` ->
   `questionId`), `importer/`, `note-edit.ts` -> `question-edit.ts`, plus their
   tests. Update summary strings such as `notesAdded`.
3. **Database layer in `src/db/`:** `scheduler.ts` (`emptyCardRow`, `rowToCard`,
   `cardToRow` -> progress-named helpers), `queries.ts`, `seed.ts`, and in
   `repo/`: `notes.ts` -> `questions.ts`, `import-notes.ts` ->
   `import-questions.ts`, then `reviews.ts`, `import-backup.ts`, `decks.ts`.
4. **Components:** `edit-note-modal.tsx` -> `edit-question-modal.tsx`; study
   session files (`use-study-run`, `question-view`, `study-session`,
   `end-states`, `types`), `import-form`, `dashboard`.
5. **Docs:** CLAUDE.md (glossary, layout, rule 7 `noteId` -> `questionId`) and
   STATUS.md (add a "Naming" note).
6. **Verification:**
   - `npm run typecheck`, `lint`, `test`, `build`.
   - `grep -ri "noteId\|cardId\|CardRow\|revlog" src` has no hits except the
     v2 migration.
   - Browser: load the app on old v1 data, confirm dashboard counts survive,
     answer a card, check the new tables.
   - Browser: export a backup, re-import it, confirm it is a no-op.

## Risks

- The v2 migration is the only step that can lose data; test it against the
  existing local database before pushing.
- `src/lib/backup/merge.ts` has the most references (about 59 lines) and the
  most tests; its idempotence tests should catch `cardId` -> `questionId`
  mistakes.
- Do it as one commit: a half-renamed tree does not compile.

## Scope

About 40 files under `src/` reference the old names (24 for schema and types,
the rest components and tests).
