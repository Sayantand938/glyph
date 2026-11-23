# Glyph

Offline-first, Anki-style MCQ spaced-repetition PWA. Single user, no backend, no auth, no runtime network calls. Data lives in IndexedDB (Dexie), scheduling is FSRS (`ts-fsrs`), and devices sync by moving JSON backup files.

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
src/components/     React components (ui/ = shadcn; study/ = study session; import/ = import modal)
src/db/             Dexie schema + startup (database.ts), types, scheduler.ts, seed.ts, repo/ (writes), queries.ts (reads)
src/lib/            Pure, unit-tested logic: answer, hash, shuffle, importer/, queue, backup/, session, note-edit, math
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
7. A note's `id` is frozen at creation. Editing a question never changes it; re-import must never touch a card row.
8. No new dependencies beyond the stack above without a stated reason.
9. Components that query Dexie render under `DbProvider`, which runs `initDatabase()` (persist + seed) first.
10. Question/option/explanation text is rendered as plain text (React escapes it). Never `dangerouslySetInnerHTML`. LaTeX goes through `RichText` (`src/components/rich-text.tsx`), which calls `katex.render` into a ref, never an HTML string. Delimiters are parsed by `splitMath` in `src/lib/math.ts`: `$...$` (the default, documented form), `$$...$$`, `\(...\)` and `\[...\]` are all supported; `\$` is a literal dollar sign.
11. Two-grade scale only: reviews are `Again` (fail) or `Good` (pass), the `Grade` type in `scheduler.ts`. Never add Hard/Easy buttons or write ratings 2/4 (old logs and imported backups may contain them; keep accepting those).

## Gotchas

- `ts-fsrs` is 5.x: `elapsed_days` is deprecated but still on `Card`; check the installed types rather than guessing the API.
- Keep source files ASCII: write non-ASCII characters (zero-width, combining marks) as `\uXXXX` escapes so tooling can't silently change or hide them. `src/ascii.test.ts` enforces this in `npm test`. Claude's Write/Edit tools turn a typed escape into the literal character, so put escapes in via `sed` or Python from Bash (sed needs the backslash doubled twice), or avoid them (e.g. `&middot;` in JSX text), then re-run the test.
- `@vitejs/plugin-react@6` has an optional Babel peer that conflicts with shadcn's Babel 7 under npm's resolver; it was installed with `--legacy-peer-deps`. Use the same flag if `npm install` reports an ERESOLVE for it.
- `@eslint/js` is pinned to `^9` to match `eslint@9`.
- Theming is a small custom provider (`src/components/theme-provider.tsx`, `src/hooks/use-theme.ts`), not `next-themes`, which renders a `<script>` that React 19 logs as an error. The `d` key toggles light/dark.
- `.env` is git-ignored and not used by the app; don't read or commit it.
