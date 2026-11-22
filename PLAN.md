# MCQ Spaced-Repetition PWA — Build Plan

An offline-first, Anki-style MCQ study app. Single-user, no backend, no auth. Data lives in IndexedDB (Dexie); scheduling uses FSRS (`ts-fsrs`); sync between devices is by JSON backup file transfer.

**Stack:** Vite, React, TypeScript (strict), Tailwind CSS, Dexie + `dexie-react-hooks`, `ts-fsrs`, `lucide-react`, `vite-plugin-pwa`, Vitest (dev only).

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
- **New-card display** respects the daily new-card limit (see queue rules): show `min(newCount, remainingToday)`.
- Subject rows expand/collapse (remember state in `localStorage`, wrapped in try/catch).
- Each row has a **Study** button (disabled when nothing is available) and an empty-state when no decks exist.
- Header: **Import JSON**, **Export Backup**, **Import Backup**. On mobile these collapse into a menu.
- Optional but cheap: rename/delete (soft) for Subject/Topic with confirm dialog.

### Queue rules (`lib/queue.ts`)

`buildQueue({ cards, now, newLimit, shuffle })`:
- Include: Learning/Relearning cards due now (first), Review cards due now, then New cards up to the remaining daily limit.
- **Daily new limit:** default 20 per day (setting stored in `localStorage`; "day" rolls over at 04:00 local time). New cards introduced today = distinct `cardId`s in `revlog` today whose first-ever review was today.
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
