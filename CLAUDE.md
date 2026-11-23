# Glyph

Offline-first, Anki-style MCQ spaced-repetition PWA. Single user, no backend, no auth, no runtime network calls. Data lives in IndexedDB (Dexie), scheduling is FSRS (`ts-fsrs`), and devices sync by moving JSON backup files or directly over the local network (WebRTC, pairing by copy-and-pasted codes, no server; `src/lib/sync/`).

**Read [STATUS.md](STATUS.md) first.** It holds the full build plan, the phase checkpoints, which phase is current, and where the implementation deliberately differs from the plan. Update it at the end of every phase.

## Stack

Vite 8 + React 19 (client-only SPA), TypeScript `strict`, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (`@base-ui/react`), Dexie + `dexie-react-hooks`, `ts-fsrs`, `katex` (LaTeX in questions), `lucide-react`, `vite-plugin-pwa`, Vitest.

The project started on Next.js and was migrated to Vite before Phase 4. There is no SSR, no router and no server code.

## Commands

```powershell
npm run dev        # vite dev server, http://localhost:5173
npm run build      # tsc --noEmit && vite build (also generates the service worker)
npm run preview    # serve the production build (use this to test offline/PWA)
npm test           # vitest run (node environment, src/**/*.test.ts)
npm run tauri dev  # desktop shell around the dev server (Rust required)
npm run tauri build # desktop exe + installer; no service worker (see Gotchas)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm run format     # prettier --write "**/*.{ts,tsx}"
```

Before calling a phase done: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all clean.

## Layout

The `@/*` alias maps to `src/`.

```
index.html          entry; inline script applies the saved theme before first paint
vite.config.ts      react + tailwind + VitePWA (manifest lives here)
src/main.tsx        mounts <ThemeProvider><DbProvider><App/>
src/App.tsx         app shell
src/index.css       Tailwind + theme tokens
src/components/     React components (ui/ = shadcn; study/ = study options page and study session; import/ = import page; browse/ = browse page; no modals, edit/confirm/import screens are full pages built on page-shell.tsx)
src/db/             Dexie schema + startup (database.ts), types, scheduler.ts, seed.ts, repo/ (writes), queries.ts (reads), backup-parts.ts / backup-file.ts / import-file.ts / backup-local.ts (the backup file and sync parts, digests, merge planning), snapshots.ts and backup-folder.ts (browser only: copies before an import, the auto-backup folder)
src/lib/            Pure, unit-tested logic: answer, hash, shuffle, importer/, queue, study-options, backup/ (merge, the streamed checksummed .glyph file, import snapshots, reminders), session, browse, note-edit, tags, card-marks, card-history, leech, settings (synced settings rows, merge), retention, math, markdown, fsrs/ (the parameter optimizer: model, autodiff, history, optimize, days), image/ (tokens, fit, id, base64; encode.ts is browser-only), sync/ (pairing codes, the wire protocol, digests and connection diagnostics for device sync; rtc.ts is the browser-only WebRTC part)
src/hooks/          React hooks (use-theme.ts)
public/             static assets, PWA icons in public/icons/
```

Tests sit next to the code as `*.test.ts`. `backup/`, `importer/` and `repo/` are directories behind an `index.ts` barrel, so import them as `@/lib/backup`, `@/lib/importer` and `@/db/repo`; keep each file focused on one concern.

## Rules

1. Build in phase order; don't start a phase until the previous checkpoint passes.
2. No `any`, no `@ts-ignore`.
3. UI code never imports `ts-fsrs`. Everything FSRS goes through `src/db/scheduler.ts` (which re-exports `Rating`, `State`, `Grade`).
4. All writes go through `src/db/repo/` (import from `@/db/repo`), each in one Dexie transaction. Components only read (`useLiveQuery`).
5. Pure logic (answer normalization, hashing, shuffling, queue building, merging, import planning) lives in `src/lib/` with unit tests and no DB or React imports.
6. Never edit Dexie `version(1)` after release; add `db.version(n).upgrade()`.
7. A note's `id` is frozen at creation. Editing a question never changes it; re-import must never touch a card row. Deleting a question is a soft delete (`deleteNote` in `src/db/repo/notes.ts` sets `deletedAt`, like decks); the card row and revlog stay, and every read filters out tombstoned notes.
8. No new dependencies beyond the stack above without a stated reason.
9. Components that query Dexie render under `DbProvider`, which runs `initDatabase()` (persist + seed) first.
10. Question/option/explanation text is rendered as plain text (React escapes it). Never `dangerouslySetInnerHTML`. Rich text goes through `RichText` (`src/components/rich-text.tsx`), which builds React elements from `parseMarkdown` (`src/lib/markdown.ts`: bold, italic, strike, inline code, code fences, headings, lists, quotes, and `![alt](img:<id>)` for an image stored in the `images` table, rendered by `NoteImage` as an `<img>` from a `data:` URL; no links, URL images, tables or raw HTML) and calls `katex.render` into a ref for math, never an HTML string. Delimiters are parsed by `splitMath` in `src/lib/math.ts`: `$...$` (the default, documented form), `$$...$$`, `\(...\)` and `\[...\]` are all supported; `\$` is a literal dollar sign.
11. Two-grade scale only: reviews are `Again` (fail) or `Good` (pass), the `Grade` type in `scheduler.ts`. Never add Hard/Easy buttons or write ratings 2/4 (old logs and imported backups may contain them; keep accepting those).

## Gotchas

- Tauri 2 desktop shell lives in `src-tauri/` (made with `tauri init` and `tauri icon`; only the identifier in `tauri.conf.json` was edited). Data is still IndexedDB inside WebView2. The Tauri CLI sets `TAURI_ENV_PLATFORM`; `vite.config.ts` then drops `vite-plugin-pwa` and aliases `virtual:pwa-register/react` to `src/lib/pwa-register-stub.ts`, so `PwaToast` renders nothing. A plain `npm run build` (Vercel) still builds the PWA.

- Retention, the fitted FSRS weights (`fit`), auto-fit and the leech rule are not localStorage preferences: they are rows in the Dexie `settings` table, read with `useSettings`/`useSetting` (`src/hooks/use-settings.ts`), written with `saveSetting` (`@/db/repo`), and merged key by key (newer `updatedAt`) in backups and device sync. A new synced setting needs an entry in `SETTING_PARSERS` (`src/lib/settings.ts`). Do not add review, learning or new-card caps.

- Card marks (flag, suspended, buriedUntil, markedAt; `src/lib/card-marks.ts`) live on the card row but are not FSRS progress. Reviews, undo and "Reset FSRS progress" must keep them (take them from the stored row, not a screen copy), `countCards`/`buildQueue` skip hidden cards, and backup merge decides them by `markedAt` apart from progress (`pickCard`). Writes go through `src/db/repo/cards.ts`.

- `ts-fsrs` is 5.x: `elapsed_days` is deprecated but still on `Card`; check the installed types rather than guessing the API.
- Elapsed days are local calendar days, not ts-fsrs's UTC dates: `db/scheduler.ts` shifts the dates it gives ts-fsrs (`lib/fsrs/days.ts`), and the optimizer's history builder uses the same function. Anything that computes "days since the last review" for scheduling must use `elapsedStudyDays`. The optimizer's model in `lib/fsrs/model.ts` mirrors ts-fsrs's formulas; `src/lib/fsrs.test.ts` fails if they drift apart after a `ts-fsrs` upgrade.
- Keep source files ASCII: write non-ASCII characters (zero-width, combining marks) as `\uXXXX` escapes so tooling can't silently change or hide them. `src/ascii.test.ts` enforces this in `npm test`. Claude's Write/Edit tools turn a typed escape into the literal character, so put escapes in via `sed` or Python from Bash (sed needs the backslash doubled twice), or avoid them (e.g. `&middot;` in JSX text), then re-run the test.
- `@vitejs/plugin-react@6` has an optional Babel peer that conflicts with shadcn's Babel 7 under npm's resolver; it was installed with `--legacy-peer-deps`. Use the same flag if `npm install` reports an ERESOLVE for it.
- `@eslint/js` is pinned to `^9` to match `eslint@9`.
- Theming is a small custom provider (`src/components/theme-provider.tsx`, `src/hooks/use-theme.ts`), not `next-themes`, which renders a `<script>` that React 19 logs as an error. The `d` key toggles light/dark.
- `.env` is git-ignored and not used by the app; don't read or commit it.
