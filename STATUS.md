# Glyph — MCQ Spaced-Repetition PWA — Status & Build Plan

An offline-first, Anki-style MCQ study app. Single-user, no backend, no auth. Data lives in IndexedDB (Dexie); scheduling uses FSRS (`ts-fsrs`); sync between devices is by JSON backup file transfer.

**Stack (as built):** Vite 8, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui, Dexie + `dexie-react-hooks`, `ts-fsrs`, `lucide-react`, `vite-plugin-pwa`, Vitest (dev only). The project was scaffolded on Next.js and migrated to Vite before Phase 4, so it now matches the plan's stack; see "Deviations".

This file was `PLAN.md`; it is both the plan and the running status. Update the table and checklist at the end of every phase.

---

## Current Status

**Current phase: all seven phases are built.** Phase 7 (PWA offline verification) is done except replacing the placeholder icons. The Next.js → Vite migration is complete.

| Phase | Scope | State |
|---|---|---|
| 1 | Project setup (PWA manifest, icons, Vitest, base layout) | Done |
| 2 | Data layer (Dexie schema, scheduler, seed, repo) | Done |
| 3 | Pure utilities (`normalizeAnswer`, `noteId`, `seededShuffle`) | Done |
| 4 | Bulk JSON importer | Done |
| 5 | Dashboard & backup (includes `buildQueue`, `mergeBackup`) | Done |
| 6 | Study session & inline editor | Done |
| 7 | PWA offline verification (plugin already configured) | Done (placeholder icons still to replace) |

### Done

- **Phase 1:** PWA manifest (in `vite.config.ts`), icons in `public/icons/`, `vitest.config.ts`, base layout with dark mode, mobile-first `max-w-3xl` container.
- **Phase 2:** `src/db/database.ts` (Dexie v1 schema, `initDatabase()` = persist + seed), `types.ts`, `scheduler.ts` (ts-fsrs wrapper, `formatInterval`, `previewIntervals`, `grade`), `seed.ts`, `repo.ts` (decks, `saveNote`, `applyReview`, `undoReview`), `src/components/db-provider.tsx` gating render on startup. Scheduler unit-tested.
- **Phase 3:** `src/lib/answer.ts`, `src/lib/hash.ts` (`cyrb53`, `normalizeQuestion`, `noteId`), `src/lib/shuffle.ts` (`mulberry32`, `seededShuffle`), each with a `*.test.ts`. 53 tests pass in total; typecheck, lint and build clean.
- **Phase 4:** `src/lib/importer.ts` (`parseImportText`, `validateRows`, `planImport`, `resolveDeckRef`, `summarize`, `formatSummary`; pure), `commitImport()` in `src/db/repo.ts` (one transaction: resolve/create Subject + Topic, re-plan against stored notes, `bulkPut` notes, `bulkAdd` cards for new notes only), `src/components/import-modal.tsx` + `src/components/ui/dialog.tsx` (base-ui Dialog), and a temporary "Import JSON" button and result banner in `App.tsx`. 30 new tests (83 total). Verified in the browser: import, idempotent re-import (0 new / 9 unchanged / 1 updated), card progress preserved, case-insensitive Subject/Topic reuse, invalid-file errors, 375px layout.
- **Phase 5:** `src/lib/queue.ts` (`buildQueue`, `countCards`; the daily new-card limit helpers were removed later) and `src/lib/backup.ts` (`exportBackup`, `parseBackup`, pure `mergeBackup`, `formatMergeSummary`, `backupFilename`), 42 new tests (125 total). `src/db/queries.ts` (read-only: `loadDashboard`, `readAllData`) and `importBackup()` in `repo.ts` (one transaction over all four tables, writes only changed rows). UI: `dashboard.tsx`, `deck-tree.tsx`, `deck-dialogs.tsx` (rename / soft-delete with confirm), `header-menu.tsx`, `ui/dropdown-menu.tsx`, `hooks/use-backup-controls.tsx`, `hooks/use-stored-state.ts`; `App.tsx` is now the real shell. Verified in the browser: dashboard counts, collapse state, rename validation, header menu, backup export/parse/merge round trip (no-op re-import), older backup over newer progress keeps the newer rows, and a review/undo moves "new today" 0 -> 1 -> 0. Not exercised in the browser: the actual file download and file-picker import (the same code paths were run from the page without the file dialogs), and the delete dialog's confirm button.
- **Phase 6:** `src/lib/session.ts` (`optionOrder`, `requeueGap`, `requeueAgain`, `summarizeSession`, `formatDuration`) and `src/lib/note-edit.ts` (`validateDraft`, `cleanDraft`, `draftChangesNote`), pure with 20 new tests (146 total). `loadStudyCards` / `loadStudyCard` in `src/db/queries.ts` (read-only). UI: `study-session.tsx`, `option-button.tsx`, `edit-note-modal.tsx`; `App.tsx` now opens the session from the dashboard's Study button (the header menu is hidden during a session). Verified in the browser at ~400px: Topic sessions (10 and 3 cards), wrong answer (red/green with icons, extra, Next, re-queued 3-5 cards later), right answer (Hard/Good/Easy previews, Space = Good, 1/2/3), undo (card row and revlog restored, queue restored, same option order), edit mid-answer (text updates in place, position/phase/order unchanged, correct-index change re-highlights, recorded result kept), edit with "Reset FSRS progress" (card back to New, revlog kept, undo disabled), Esc exit confirm, shuffle toggle off, A-D keys, summary screen, undo from the summary, and the dashboard counts afterwards. Not exercised in the browser: a Subject session with several topics (same code path as a Topic with `mixed: true`), the "question no longer available" screen, and the offline case (Phase 7).

- **Phase 7:** `src/components/pwa-toast.tsx` (`useRegisterSW` from `virtual:pwa-register/react`) shows "Ready to work offline." once the precache is installed and "Update available" with Reload / Later when a new service worker is waiting; mounted in `App.tsx`. `registerType` changed from `autoUpdate` to `prompt` (see below), and `vite-plugin-pwa/react` was added to `tsconfig.json` `types`. The dashboard footer now carries the "data lives only in this browser, export backups, add to Home Screen on iOS" hint. The iOS meta tags (`apple-touch-icon`, `apple-mobile-web-app-capable`, title, status bar) were already in `index.html`. Verified in the browser against `npm run preview`: the service worker installs and precaches 18 entries, the "Ready to work offline" toast appears, then with the preview server stopped (a real offline test, not just DevTools throttling) the page reloads from the cache, a card was answered and rated Good (1 revlog row, card state Learning), and after another offline reload the dashboard showed 1 new today and the revlog row was still there. A changed `sw.js` produced the "Update available" toast and Reload activated the new worker. Not done: replacing the placeholder icons (needs real art); not exercised on a real iOS device or as an installed PWA.

### Settings page (after Phase 7)

The header's Import JSON / Export Backup / Import Backup buttons and menu (`header-menu.tsx`, deleted) were replaced by a gear button that switches `App.tsx` to a full-page `src/components/settings-page.tsx` (a `settingsOpen` view state like `studying`; no router, so the browser back button leaves the app and the page has its own Back arrow). Sections: Appearance (Light / Dark / System via `useTheme`), Data (the three import/export actions; results show in App's notice banner), Statistics (placeholder, "coming soon") and About (app version, imported from `package.json`). `ui/dropdown-menu.tsx` is still used by `deck-tree.tsx`. Verified in the browser: gear opens the page, Export Backup shows its notice, Back returns to the dashboard. Not exercised: Import Backup / Import JSON from the page, theme switching on the page after the move from the dialog, and the mobile layout.

### Configurable retention (after Phase 7)

Settings > Scheduling has a Desired retention slider (70-97%, default 85%, was ts-fsrs's 90%) and a reset button. The value is a per-device preference in localStorage (`glyph.retention`, via `hooks/use-retention.ts`), like the theme, so it is not part of backups and does not sync. `db/scheduler.ts` keeps one `fsrs` instance per retention value (`schedulerFor`) and `grade`, `previewIntervals` and `applyReview` take a trailing `retention` argument that defaults to `DEFAULT_RETENTION`; `use-study-run.ts` passes the stored value. It affects only future reviews; existing due dates are not recomputed. The `src/sim/` runs use the 85% default.

### Refactor: smaller files (after Phase 7)

Pure restructuring, no behavior change. The four largest modules became directories; import paths for `@/lib/backup`, `@/lib/importer` and `@/db/repo` are unchanged (barrel `index.ts`). Phase notes below still name the old single files.

- `src/lib/backup/`: `types`, `export`, `read-rows` (row validators), `parse`, `pick` (conflict rules), `merge`, `summary`.
- `src/lib/importer/`: `types`, `parse` (`parseImportText`, `validateRows`), `plan` (`planImport`, `summarize`, `formatSummary`), `deck-ref`.
- `src/db/repo/`: `decks`, `notes`, `reviews`, `import-notes` (`commitImport`), `import-backup` (`importBackup`), `clean-name`.
- `src/components/study/`: `study-session` (shell), `use-study-run` (queue, answers, undo), `use-study-keys`, `session-toolbar`, `question-view`, `end-states`, `exit-dialog`, `types`, `helpers`. Imported as `@/components/study/study-session`.
- `src/components/import/`: `import-modal` (shell), `import-form`, `file-drop`, `deck-field` (Subject/Topic picker, replaces two near-identical blocks), `import-preview`, `use-import-file`. Imported as `@/components/import/import-modal`.

### Deviations from the plan

- **Migrated from Next.js to Vite** (after Phase 3, before Phase 4). Reason: a fully client-side, offline PWA gains nothing from SSR, Dexie is browser-only, and `vite-plugin-pwa` (in the original plan) makes Phase 7 trivial. Changes: code moved under `src/` (alias `@/*` → `src/`), `index.html` + `src/main.tsx` replace `app/layout.tsx`, the manifest moved into `vite.config.ts`, `next/font` became `@fontsource-variable/jetbrains-mono` (self-hosted, precached), ESLint switched to `typescript-eslint` + react-hooks + react-refresh, and dev runs on port 5173.
- **Custom theme provider instead of `next-themes`.** `next-themes` renders a `<script>` that React 19 logs as a console error on client renders. `src/components/theme-provider.tsx` + `src/hooks/use-theme.ts` reimplement light/dark/system (same `theme` localStorage key, `d` hotkey) and `index.html` applies the theme before first paint. `next-themes` was removed.
- **Removed `scripts/generate-icons.mjs`.** It depended on `next/og`. The generated PNGs in `public/icons/` are committed and still used; they are placeholders to replace with real art.
- **`@vitejs/plugin-react` installed with `--legacy-peer-deps`** (optional Babel peer clashes with shadcn's Babel 7). `@eslint/js` pinned to `^9` to match ESLint 9.
- **`registerType: 'prompt'` instead of `'autoUpdate'`.** With `autoUpdate` the new service worker activates and the page reloads on its own, which would end a study session mid-card. With `prompt` the update waits until the user taps Reload in the toast. Precache is unchanged (js/css/html/svg/png/ico/woff2).
- **Phase 3 scope.** Plan §4.4 (`buildQueue`) and §4.5 (backup merge) only point forward to Phases 5/6, so they are built with their phases, not here. Phase 3 delivered the three standalone utilities.
- **Component paths.** Components in the layout below are `src/components/<name>.tsx` in kebab-case (e.g. `db-provider.tsx`), matching the shadcn convention.
- `noteId` also exports `normalizeQuestion`, and `src/lib/hash.ts` exports `cyrb53`, because the shuffle seeds from the same hash.

### Phase 4 notes

- A re-import refreshes `sl`, `options`, `correctIndex` and `extra` only; the stored question text (and id) is kept, so inline edits to wording are never overwritten.
- Resurrecting a soft-deleted note counts as "updated" and bumps `contentUpdatedAt` so it beats the tombstone in a Phase 5 merge.
- `commitImport` re-matches Subject/Topic names against the database inside its transaction, so a stale preview can't create duplicate decks. The one case where it touches `cards` for an existing note: the card row is missing, then a fresh one is added.
- The modal previews against the live stored notes; for a not-yet-created topic every row is "new".
- Importer rows accept numeric `sl`/options/answer; the key is `questions` (plural), as in the plan.
- The 10 MB cap is checked before reading the file. The commit is not chunked (a single `bulkPut`/`bulkAdd`), which is fine for the few-thousand-row target.

### Phase 5 notes

- **Study button.** The dashboard passes `scope` to `onStudy`. Phase 6 wired it: the session calls `buildQueue` (Topic: `mixed: false`; Subject: `mixed: true`) with cards from `loadStudyCards` (non-tombstoned notes only, like `loadDashboard`).
- **Counts use the `topicId` index plus pure `countCards`**, not the `[topicId+state]` / `[topicId+due]` compound indexes the plan mentions (a topic's cards are loaded once and counted in JS; dead notes are excluded via the `deletedAt` index). The compound indexes are still defined for Phase 6.
- **Learning count = Learning/Relearning cards due now.** The dashboard re-reads every 60 s so cards that become due (and the 04:00 rollover) appear without a reload. A non-due learning card is in neither the count nor the queue.
- **No daily new-card limit (removed after Phase 7, deliberately differs from the plan):** every New card is shown in the counts and included in a session. The old `glyph.newLimit` localStorage key is simply ignored.
- **Queue shuffling:** Topic = learning (most overdue first), then shuffled reviews, then shuffled new; Subject = learning first, then reviews and new blended in one shuffle. When more new cards exist than the allowance, the oldest (by creation `due`) are chosen.
- **Backup parsing is strict:** every row of every table is validated and copied field-by-field (unknown fields are dropped); one bad row rejects the file with its table and index. 100 MB cap.
- **Merge details:** deck ties prefer a tombstone, then local; two tombstoned notes pick newer content then newer `deletedAt`; revlog is local-wins by id; a card follows its winning note's `topicId`. Incoming cards with no note in the merged set are dropped and reported. After merging, `importBackup` gives any live note that has no card a fresh one. As specified, a card reset to New (lastReview 0) loses to an older reviewed copy of the same card from another device.
- **Header menu:** three buttons from the `sm` breakpoint up, a single menu below it. The collapsed-Subjects set is stored in `glyph.collapsed`.
- **Vite dev gotcha:** adding a new `@base-ui/react/*` entry point made the dev server re-optimize deps and load two copies of React ("Invalid hook call", blank page). Stopping the server and deleting `node_modules/.vite` fixed it.

### Phase 6 notes

- **Option order is keyed on the queue position, not an attempt counter.** `optionOrder(seed, cardId, position, shuffle)` uses the card's index in the queue, which is fixed for one card view, differs for a re-queued copy, and returns the same order after an undo. The order depends on option indexes only, so edits never reshuffle.
- **Answer flow.** A wrong pick saves an `Again` review at once and inserts a copy of the card 3-5 positions later (`requeueGap`, deterministic per seed/card/position; appended when fewer cards remain). A right pick saves nothing until **Pass** (`Good`, Space/Enter/P/1) or **Fail** (`Again`, F/2) is chosen, so the preview intervals come from the unreviewed row. The plan's Hard/Good/Easy buttons were replaced by two (Pass/Fail), since a two-grade scale suits FSRS for MCQ. Fail on a right pick (a guess) behaves like a wrong pick: `Again` review, counted as incorrect, copy re-queued 3-5 positions later. Only `Again` re-queues; a Learning card rated Pass is not re-shown in the same session. The scheduler enforces the two-grade scale: `Grade` is `Rating.Again | Rating.Good`, `previewIntervals` returns only `{ again, good }`, and passing Hard/Easy is a compile error. Backup validation still accepts ratings 1-4 so old logs and backups import.
- **Undo** keeps a stack of entries (revlog id, previous card row, the queue and position from before the answer). `undoReview` restores the row and deletes the log, and the queue snapshot removes any re-queued copy. After "Reset FSRS progress" the card's earlier entries are marked not undoable (the saved row would otherwise bring the old progress back); the Undo button is disabled when the top entry is such an entry. Undo also works from the summary screen, and a pending right pick (nothing saved) is discarded by it.
- **Progress** shows `position / queue length`, so the denominator grows by one per re-queue. The summary counts distinct cards, answers, accuracy (correct picks / answers) and the summed answer time.
- **Editor** works on its own copy of the note, trims text on save, skips the write (no `contentUpdatedAt` bump) when nothing changed and Reset is off, and shows inline errors with Save disabled until valid. The correct answer is a radio group in the note's original option order. `sl` and the topic are not editable.
- **Keyboard.** One window `keydown` listener in the capture phase; a handled key gets `preventDefault` (this also stops the global `d` theme hotkey when `D` picks an option) and `stopPropagation` (so an Escape that opens the exit dialog isn't also seen by the dialog's own Escape handler). Shortcuts are ignored while an edit/exit dialog is open, while typing in a field, with modifier keys, and on key repeat. Space/Enter are left to a focused button, and the session drops focus after a click on an option or Undo so Space still means Next/Good.
- **Edge cases.** A card whose note was deleted mid-session shows "This question is no longer available" with a Skip button. If a write fails (for example ts-fsrs rejecting a hand-edited card with an invalid memory state) the error is shown in the session and nothing advances. Between cards there is a brief "Loading..." while the live query resolves.

### Next steps

1. Replace the placeholder PWA icons in `public/icons/` (192, 512, maskable-512, apple-touch-icon) with real art.
2. Install the production build as a PWA on a phone (Android and iOS) and repeat the offline check there; the manual test script's items 14-15 were only checked in the desktop browser pane.
3. Items from "Nice-to-Haves" in section 12, if wanted.

---

## 0. Working Rules for Claude Code

1. Build in the phase order below. **Do not start a phase until the previous phase's checkpoint passes.**
2. TypeScript `strict: true`. No `any`. No `// @ts-ignore`.
3. UI components never import from `ts-fsrs` directly. All FSRS access goes through `src/db/scheduler.ts`.
4. All pure logic (answer normalization, hashing, shuffling, merging, queue building) lives in `src/lib/` and has unit tests.
5. No new dependencies beyond the list above without a stated reason.
6. At the end of every phase run `npm run build` (and `npm test` once tests exist). Fix all errors before moving on.
7. Check the **installed** `ts-fsrs` version's exported types (`Card`, `ReviewLog`, `Rating`, `State`, `fsrs`, `createEmptyCard`, `generatorParameters`) and adapt the field lists below to it. Do not guess the API from memory.

---

## 1. Project Layout

```
src/
  main.tsx
  App.tsx
  index.css
  db/
    database.ts        # Dexie class, schema, versioning, startup (persist + seed)
    types.ts           # Deck, Note, CardRow, RevlogRow, BackupFile
    scheduler.ts       # ts-fsrs wrapper: row <-> Card conversion, grade(), preview()
    seed.ts            # sample data
    repo.ts            # write operations (create/update note, deck, review, undo)
  lib/
    answer.ts          # normalizeAnswer()
    hash.ts            # noteId() deterministic hash
    shuffle.ts         # seeded shuffle (mulberry32 + string seed)
    queue.ts           # buildQueue()
    backup.ts          # exportBackup(), parseBackup(), mergeBackup()
    importer.ts        # validateRows(), planImport(), commitImport()
    *.test.ts
  components/
    Dashboard.tsx
    DeckTree.tsx
    ImportModal.tsx
    BackupControls.tsx
    StudySession.tsx
    OptionButton.tsx
    EditNoteModal.tsx
    Toast.tsx
public/
  icons/ (192, 512, maskable-512, apple-touch-icon)
vite.config.ts
```

---

## 2. Phase 1 — Project Setup

- Initialize Vite + React + TS in the current directory if not already present.
- Install: `dexie dexie-react-hooks ts-fsrs lucide-react vite-plugin-pwa`; dev: `vitest tailwindcss` (+ the Tailwind Vite plugin if on Tailwind v4, otherwise the v3 PostCSS setup). **Use whichever setup matches the installed Tailwind major version.**
- `vite.config.ts`: `VitePWA({ registerType: 'autoUpdate', workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] }, manifest: {...} })`.
- Manifest: name, short_name, `display: 'standalone'`, `start_url: '/'`, `theme_color`, `background_color`, icons (192, 512, maskable). Generate simple placeholder icons (solid color + letter) as PNGs if none exist.
- Add `npm test` (`vitest run`).
- Base layout: mobile-first, `max-w-3xl` centered container, system font stack, high-contrast palette, respects `prefers-color-scheme` (dark mode via Tailwind `dark:` classes).

**Checkpoint 1:** `npm run build` passes; `npm run dev` shows a placeholder page.

---

## 3. Phase 2 — Data Layer

### 3.1 Types (`src/db/types.ts`)

```ts
export interface Deck {
  id: string;
  parentId: string | null;   // null = Subject, string = Topic
  name: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Note {
  id: string;                // deterministic, see 4.2; FROZEN after creation
  topicId: string;
  sl: number | string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  extra: string;
  contentUpdatedAt: number;
  deletedAt: number | null;
}

export interface CardRow {
  cardId: string;            // === noteId (strict 1:1)
  noteId: string;
  topicId: string;           // denormalized from note for fast per-topic queries
  due: number;               // ms epoch
  stability: number;
  difficulty: number;
  elapsedDays: number;       // include every field the installed ts-fsrs Card has
  scheduledDays: number;
  learningSteps: number;     // only if present in installed ts-fsrs version
  reps: number;
  lapses: number;
  state: number;             // ts-fsrs State enum value
  lastReview: number;        // ms epoch; 0 if never reviewed
  updatedAt: number;         // = lastReview, or creation time for untouched cards (used for merge)
}

export interface RevlogRow {
  id: string;                // crypto.randomUUID()
  cardId: string;
  reviewedAt: number;
  rating: number;
  state: number;             // state BEFORE the review
  durationMs: number;        // time from card shown to rating
}
```

### 3.2 Dexie schema and indexes (`database.ts`)

```ts
db.version(1).stores({
  decks:  'id, parentId, deletedAt',
  notes:  'id, topicId, deletedAt',
  cards:  'cardId, noteId, topicId, state, due, [topicId+state], [topicId+due]',
  revlog: 'id, cardId, reviewedAt',
});
```

- Use `db.version(n).upgrade()` for any future change; never edit version 1 after release.
- On startup (before first render): `navigator.storage?.persist?.()` wrapped in try/catch, result ignored.
- Seed ONLY if `decks.count() === 0`: Subject "Sample Subject" -> Topic "General Knowledge" with 3 MCQs, each with a matching new card. Seed inside a single transaction.

### 3.3 Scheduler wrapper (`scheduler.ts`)

- One `fsrs(generatorParameters({ enable_fuzz: true }))` instance.
- `emptyCardRow(note, now): CardRow` using `createEmptyCard(new Date(now))`.
- `rowToCard(row): Card` and `cardToRow(card, base): CardRow` (Date <-> ms conversion, correct handling of never-reviewed `last_review`).
- `previewIntervals(row, now): { again, hard, good, easy }` returning human strings (`"10m"`, `"3d"`, `"2.1mo"`) derived from `fsrs.repeat()`.
- `grade(row, rating, now): { row: CardRow; log: RevlogRow }`.
- Export a `formatInterval(ms)` helper; unit-test it.

### 3.4 Repo layer (`repo.ts`)

All writes go through here, each in a Dexie transaction:

- `createDeck`, `renameDeck`, `softDeleteDeck`.
- `saveNote(note, { resetFsrs })`: updates note, bumps `contentUpdatedAt`, syncs `cards.topicId` if topic changed, and if `resetFsrs` replaces the card row with `emptyCardRow` (keeps `cardId`; does NOT delete revlog).
- `applyReview(cardRow, rating, durationMs)`: runs `grade()`, writes card + revlog atomically.
- `undoReview(logId, previousCardRow)`: restores the previous card row and deletes that revlog entry.

**Checkpoint 2:** unit tests for `scheduler.ts` (again/good move `due` forward, empty-card round trip is lossless). `npm run build` passes. App starts and the seed data exists in IndexedDB.

---

## 4. Phase 3 — Pure Utilities (all unit-tested)

### 4.1 `normalizeAnswer(answer, options): 0|1|2|3 | null`

Order of resolution, after `String(answer).trim()`:
1. `op1..op4` (case-insensitive) -> 0..3
2. `"1".."4"` -> 0..3
3. `"a".."d"` (case-insensitive) -> 0..3
4. Otherwise case-insensitive trimmed equality against the four options; if multiple options match, take the first.
5. No match -> `null` (row is invalid).

Test cases must include numeric `2`, `" B "`, `"OP3"`, text match with different casing, text that equals two options, empty string, `null`, garbage.

### 4.2 `noteId(topicId, question): string`

- Normalize question: lowercase, trim, collapse internal whitespace, strip zero-width characters, Unicode NFC.
- Hash `topicId + '\u0000' + normalized` with a synchronous 53-bit hash (cyrb53) -> base36 string, prefixed (e.g. `n_`).
- **The ID is assigned once at note creation and never recomputed on edit.** Inline editing a question changes the text but not the ID. A later re-import of the *original* wording will therefore create a new note (documented limitation, shown in the import preview as "new").

### 4.3 `seededShuffle(items, seed)`

mulberry32 PRNG seeded from a string hash. Same seed -> same order.

### 4.4 `buildQueue(cards, opts)`

See Phase 6.

### 4.5 Backup merge

See Phase 5.

**Checkpoint 3:** `npm test` green with meaningful coverage of all four utilities.

---

## 5. Phase 4 — Bulk JSON Importer (`ImportModal.tsx`, `lib/importer.ts`)

### Input format

```json
[{ "sl": 1, "questions": "...", "op1": "...", "op2": "...", "op3": "...", "op4": "...", "answer": "op2", "extra": "..." }]
```

### Flow

1. User picks a `.json` file (`<input type=file accept=".json,application/json">`) — also accept drag-and-drop.
2. **Target selection:** Subject dropdown + "or type new" input; Topic dropdown (filtered by chosen Subject) + "or type new" input. Name matching for new names is case-insensitive and trimmed, so "physics " reuses "Physics" instead of creating a duplicate. Soft-deleted decks are ignored.
3. **Validate** each row: must have non-empty `questions`, four non-empty options, and a resolvable `answer`. `sl` and `extra` are optional (default `''`). Collect per-row errors with the row index/`sl`.
4. **Preview** before committing: "N valid (X new, Y will update, Z unchanged), M invalid". Expandable list of invalid rows with reasons. Commit button disabled if zero valid rows.
5. **Commit** in a single Dexie transaction:
   - Create missing Subject/Topic.
   - For each valid row compute `noteId(topicId, question)`.
   - If note exists: update `sl`, `options`, `correctIndex`, `extra`; bump `contentUpdatedAt` only if something actually changed; clear `deletedAt` (resurrect). **Never touch the card row.**
   - If new: insert note + `emptyCardRow`.
   - Duplicate questions inside the same file: last one wins, counted once, reported in the summary.
6. **Summary toast/banner:** "Added 45 new MCQs, updated 3 existing, skipped 2 invalid."

### Edge cases

- Invalid JSON or non-array root -> clear error message, no crash.
- Files up to a few thousand rows import without freezing the UI (use `bulkPut`/`bulkAdd`).
- Cap file size (e.g. 10 MB) with a friendly message.

**Checkpoint 4:** importer unit tests (validation, plan counts, idempotent re-import yields 0 new / 0 updated). Manual: import a sample file twice; second run shows "0 new, N unchanged" and card progress is preserved.

---

## 6. Phase 5 — Dashboard & Backup

### Dashboard (`Dashboard.tsx`, `DeckTree.tsx`)

- `useLiveQuery` to load non-deleted decks, then per-topic counts from `cards` using the `[topicId+state]` / `[topicId+due]` indexes (join against non-deleted notes only).
- Counts per topic (Subject = sum of its Topics):
  - **New:** `state === New`
  - **Learning:** `state` is Learning or Relearning
  - **Due:** `state === Review && due <= now`. Learning/Relearning cards whose `due <= now` are counted under Learning, and are also included when building a session.
- **New-card display:** show the raw New count (no daily limit; see STATUS note).
- Subject rows expand/collapse (remember state in `localStorage`, wrapped in try/catch).
- Each row has a **Study** button (disabled when nothing is available) and an empty-state when no decks exist.
- Header: **Import JSON**, **Export Backup**, **Import Backup**. On mobile these collapse into a menu.
- Optional but cheap: rename/delete (soft) for Subject/Topic with confirm dialog.

### Queue rules (`lib/queue.ts`)

`buildQueue({ cards, now, seed, mixed })`:
- Include: Learning/Relearning cards due now (first), Review cards due now, then all New cards.
- **No daily new limit** (removed; the plan's 20/day default and 04:00 day rollover no longer apply).
- Study from a Subject: gather all topics under it, then shuffle (seeded with a session seed so the order is stable within a session).
- Study from a Topic: due first, then new; light shuffle within groups.
- **In-session re-queue:** a card answered wrong (Again) is reinserted ~3–5 cards later in the same session (or at the end if the queue is shorter), so lapses are seen again before the session ends. FSRS state is saved on each answer regardless.
- Queue is built once at session start as a list of `cardId`s; notes/cards are re-read from the DB when displayed so edits show up immediately.

### Backup (`lib/backup.ts`)

**Export** — `application/json` file `mcq-backup-YYYY-MM-DD.json`:

```json
{ "app": "mcq-srs", "schemaVersion": 1, "exportedAt": 0,
  "decks": [], "notes": [], "cards": [], "revlog": [] }
```

Includes soft-deleted rows (tombstones) so deletions propagate.

**Import / merge** — validate shape and `schemaVersion` first (reject with a clear message if missing, wrong `app`, or newer than supported). Then, in one transaction:
- `decks`: per id, keep the row with larger `updatedAt`.
- `notes`: per id, keep the row with larger `contentUpdatedAt`. A tombstone wins only if its `deletedAt` is newer than the other side's `contentUpdatedAt`.
- `cards`: per `cardId`, keep the row with larger `lastReview`; tie-break on `updatedAt`. Ensure `topicId` matches the winning note.
- `revlog`: union by `id`.
- Cards referencing a note that doesn't exist are dropped; notes referencing a missing topic are reported in the result.
- Show a summary: "Merged: +X notes, +Y cards updated, +Z reviews."

Merge function is **pure** (takes local + incoming, returns the merged sets and stats) so it can be unit-tested; the DB layer only applies the result.

**Checkpoint 5:** backup/merge unit tests (newer wins both directions, tombstones, revlog union, idempotent double-import, invalid file). Manual: export, change data, import the old file, confirm newer rows survive.

---

## 7. Phase 6 — Study Session & Inline Editor

### Session shell (`StudySession.tsx`)

- Header: back/exit button, progress ("12 / 40"), shuffle-options toggle (persisted in `localStorage`), Undo button, Edit (pencil) button.
- When the queue is empty at start: friendly "Nothing due" screen. When finished: summary (cards done, accuracy, time) with a Back button.
- Track `shownAt` per card to record `durationMs`.

### Option display

- Options shuffled with `seededShuffle([0,1,2,3], sessionSeed + cardId + attemptCount)`. The order is **fixed for the duration of one card view** (must not change when the answer is revealed or when the note is edited and re-rendered). Re-seen (re-queued) cards get a new order.
- Shuffle toggle off -> original order.
- Each option is a large button (min height ~56px), shows its key label (A–D), full-width on mobile.
- Render question and options as **plain text** (React escapes); preserve line breaks with `whitespace-pre-wrap`.

### Answer flow

State machine: `question -> answered(wrong) | answered(right) -> next`.

- On pick: lock options, highlight the chosen wrong option red and the correct one green (don't rely on color alone — add check/cross icons from `lucide-react`). Reveal the `extra` box below (hide if empty).
- **Wrong:** immediately `applyReview(..., Rating.Again)`; show **"Next Card (Space)"**.
- **Right:** show three buttons with `previewIntervals`: **Hard**, **Good** (visually primary/default), **Easy**. `Space`/`Enter` = Good. Dedicated shortcuts: `H` = Hard, `E`… conflicts with Edit, so use `1`/`2`/`3` for Hard/Good/Easy after answering (document in a keyboard-help tooltip). Review is saved on click, then advance.
- Guard against double-submit: ignore keys/clicks while a write is in flight; ignore key repeat (`event.repeat`).
- Undo: restores the previous card row and removes its revlog entry, returns to that card in its pre-answer state, and removes any re-queued copy.

### Keyboard map

| State | Keys |
|---|---|
| Question | `1`–`4` or `A`–`D` pick option; `E` edit; `Esc` exit (confirm) |
| After wrong | `Space`/`Enter` next |
| After right | `Space`/`Enter` Good; `1` Hard, `2` Good, `3` Easy; `E` edit |
| Any | `Z` undo |

Ignore shortcuts while any modal is open or focus is in an input/textarea.

### Inline editor (`EditNoteModal.tsx`)

- Fields: question, op1–op4, correct answer (radio group), extra; plus unchecked checkbox **"Reset FSRS progress"**.
- Validate: non-empty question and options; show inline errors; Save disabled until valid.
- Save calls `saveNote()`; `useLiveQuery` on the current note updates the screen **without changing queue position, answered state, or the option order** (display order is keyed on option *indexes*, so edited text appears in the same slots).
- If the correct index changes after the user already answered, keep the already-recorded result and just re-render highlights.
- Reset checkbox -> card replaced with a fresh empty card; revlog history kept.

**Checkpoint 6:** manual test script (below) passes; `npm run build` passes.

---

## 8. Phase 7 — PWA & Offline Verification

- Service worker precaches the app shell; first load online, then must work fully offline (all data is local).
- Add an in-app small "Update available / Ready offline" toast using the `virtual:pwa-register` hook (optional but recommended).
- Verify with `npm run build && npm run preview`: load once, set DevTools to Offline, reload, study a card, confirm the review persists after reload.
- iOS: add `apple-touch-icon` and `<meta name="apple-mobile-web-app-capable">`; note that iOS may evict storage for non-installed sites, so recommend installing to home screen and exporting backups regularly (show this hint on the dashboard footer).

---

## 9. Manual Test Script

1. Fresh profile -> seed shows Sample Subject > General Knowledge with 3 New.
2. Import a 10-row JSON into a new Subject/Topic -> toast "Added 10 new MCQs".
3. Import the same file again -> "0 new, 10 unchanged".
4. Edit one question's options in the JSON, re-import -> "updated 1"; study that card first, confirm its FSRS state didn't reset.
5. Study a Topic: answer one wrong (red/green, extra shown, Next), one right (Hard/Good/Easy previews, Space = Good).
6. Confirm the wrong card reappears a few cards later in the same session.
7. Press `E` mid-session, change text, save -> screen updates, queue position unchanged, options don't reshuffle.
8. Edit with "Reset FSRS progress" checked -> card returns to New.
9. Undo with `Z` after an answer -> counts on dashboard revert.
10. Study from the Subject -> cards from multiple topics appear, mixed.
11. Toggle shuffle off -> options in original order.
12. Export backup; clear site data; import backup -> everything restored.
13. Import an older backup over newer data -> newer progress is kept.
14. Mobile viewport (375px): option buttons large, no horizontal scroll, header usable.
15. Offline reload works.

---

## 10. Acceptance Criteria

- `npm run build` and `npm test` pass with zero errors or type errors.
- Core loop works fully offline after first load.
- Re-import never resets card progress; inline edit never resets progress unless the box is checked.
- Backup round trip is lossless; merging is idempotent.
- No crashes on malformed import/backup files; errors are user-readable.
- No auth, no network calls at runtime, no dependencies outside the listed stack.

---

## 11. Out of Scope (for now)

Cloud sync, accounts, images/rich text in questions, per-deck FSRS parameter tuning, statistics charts, deck export to Anki format, multi-select questions.

## 12. Nice-to-Haves (only after all checkpoints pass)

Stats screen (reviews per day, retention), per-deck daily limits, search/browse notes, CSV import, haptic feedback on mobile, FSRS parameter optimization from `revlog`.
