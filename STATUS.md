# Glyph — MCQ Spaced-Repetition PWA — Status & Build Plan

An offline-first, Anki-style MCQ study app. Single-user, no backend, no auth. Data lives in IndexedDB (Dexie); scheduling uses FSRS (`ts-fsrs`); sync between devices is by JSON backup file transfer.

**Stack (as built):** Vite 8, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui, Dexie + `dexie-react-hooks`, `ts-fsrs`, `lucide-react`, `vite-plugin-pwa`, Vitest (dev only). The project was scaffolded on Next.js and migrated to Vite before Phase 4, so it now matches the plan's stack; see "Deviations".

This file was `PLAN.md`; it is both the plan and the running status. Update the table and checklist at the end of every phase.

---

## Current Status

**Current version: 0.3.0** (the version shows in the app footer and comes from `package.json`). **Current phase: all seven phases are built.** Phase 7 (PWA offline verification) is done except replacing the placeholder icons. Work added after Phase 7 is described in the sections below (configurable retention, LaTeX, Markdown, images, browse and delete, tags, full pages, **suspend / bury / flag with study hotkeys**, and a redesign of the settings data actions and the end-of-session summary). 371 tests pass; typecheck, lint and build are clean. Added in v0.2.0: an FSRS parameter optimizer and local-day scheduling (see "FSRS optimizer and local-day scheduling"), and a study options page (see "Study options"). Added in v0.3.0: due reviews are asked least stable first (see "Queue order"). The Next.js → Vite migration is complete.

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
- **Phase 6:** `src/lib/session.ts` (`optionOrder`, `requeueGap`, `requeueAgain`, `summarizeSession`, `formatDuration`) and `src/lib/note-edit.ts` (`validateDraft`, `cleanDraft`, `draftChangesNote`), pure with 20 new tests (146 total). `loadStudyCards` / `loadStudyCard` in `src/db/queries.ts` (read-only). UI: `study-session.tsx`, `option-button.tsx`, `edit-note-page.tsx`; `App.tsx` now opens the session from the dashboard's Study button (the header menu is hidden during a session). Verified in the browser at ~400px: Topic sessions (10 and 3 cards), wrong answer (red/green with icons, extra, Next, re-queued 3-5 cards later), right answer (Hard/Good/Easy previews, Space = Good, 1/2/3), undo (card row and revlog restored, queue restored, same option order), edit mid-answer (text updates in place, position/phase/order unchanged, correct-index change re-highlights, recorded result kept), edit with "Reset FSRS progress" (card back to New, revlog kept, undo disabled), Esc exit confirm, shuffle toggle off, A-D keys, summary screen, undo from the summary, and the dashboard counts afterwards. Not exercised in the browser: a Subject session with several topics (same code path as a Topic with `mixed: true`), the "question no longer available" screen, and the offline case (Phase 7).

- **Phase 7:** `src/components/pwa-toast.tsx` (`useRegisterSW` from `virtual:pwa-register/react`) shows "Ready to work offline." once the precache is installed and "Update available" with Reload / Later when a new service worker is waiting; mounted in `App.tsx`. `registerType` changed from `autoUpdate` to `prompt` (see below), and `vite-plugin-pwa/react` was added to `tsconfig.json` `types`. The dashboard footer now carries the "data lives only in this browser, export backups, add to Home Screen on iOS" hint. The iOS meta tags (`apple-touch-icon`, `apple-mobile-web-app-capable`, title, status bar) were already in `index.html`. Verified in the browser against `npm run preview`: the service worker installs and precaches 18 entries, the "Ready to work offline" toast appears, then with the preview server stopped (a real offline test, not just DevTools throttling) the page reloads from the cache, a card was answered and rated Good (1 revlog row, card state Learning), and after another offline reload the dashboard showed 1 new today and the revlog row was still there. A changed `sw.js` produced the "Update available" toast and Reload activated the new worker. Not done: replacing the placeholder icons (needs real art); not exercised on a real iOS device or as an installed PWA.

### Full pages, no modals

Everything that used to be a dialog is now a full page, so it works on a phone: import (`import/import-page.tsx`), edit question (`edit-note-page.tsx`), delete question (`delete-note-page.tsx`), rename/delete deck (`deck-pages.tsx`) and the study "Leave this session?" prompt (`study/exit-page.tsx`). `ui/dialog.tsx` was removed. All use `components/page-shell.tsx` (back button + title, sticky bottom action bar, Escape goes back, optional `onSubmit` to make the page a form). There is still no router: the host component renders the page in place of its own content and stays mounted, so the study run, browse filters and the dashboard keep their state. `hooks/use-scroll-restore.ts` brings a long list back to its scroll position afterwards; `PageShell` scrolls to the top on open. The import page is a top-level view in `App.tsx` (over settings/dashboard, hiding the header buttons). The browser/phone Back button closes the open page: `lib/layers.ts` (pure, tested) keeps one history entry per open page, wired by `hooks/use-history-layer.ts` in `PageShell`, `SettingsPage`, `BrowsePage` and `StudySession` (Back in a session in progress opens the leave prompt; a page can ignore Back while a write runs). Reloading mid-way can leave stale history entries; Back then needs an extra press.

### Settings page (after Phase 7)

The header's Import JSON / Export Backup / Import Backup buttons and menu (`header-menu.tsx`, deleted) were replaced by a gear button that switches `App.tsx` to a full-page `src/components/settings-page.tsx` (a `settingsOpen` view state like `studying`; no router, so the browser back button leaves the app and the page has its own Back arrow). Sections: Appearance (Light / Dark / System via `useTheme`), Data (the three import/export actions; results show in App's notice banner), Statistics (placeholder, "coming soon") and About (app version, imported from `package.json`). `ui/dropdown-menu.tsx` is still used by `deck-tree.tsx`. Verified in the browser: gear opens the page, Export Backup shows its notice, Back returns to the dashboard. Not exercised: Import Backup / Import JSON from the page, theme switching on the page after the move from the dialog, and the mobile layout.

### Configurable retention (after Phase 7)

Settings > Scheduling has a Desired retention slider (70-97%, default 85%, was ts-fsrs's 90%) and a reset button. The value is a per-device preference in localStorage (`glyph.retention`, via `hooks/use-retention.ts`), like the theme, so it is not part of backups and does not sync. `db/scheduler.ts` keeps one `fsrs` instance per retention value (`schedulerFor`) and `grade`, `previewIntervals` and `applyReview` take a trailing `retention` argument that defaults to `DEFAULT_RETENTION`; `use-study-run.ts` passes the stored value. It affects only future reviews; existing due dates are not recomputed. The `src/sim/` runs use the 85% default.

### FSRS optimizer and local-day scheduling (v0.2.0)

Settings > Scheduling > **Personalized parameters** fits the 21 FSRS-6 weights to the user's own review log (`src/lib/fsrs/`, UI in `components/fsrs-optimizer.tsx`). Anki ships an optimizer; `ts-fsrs` does not, so this is our own, in plain TypeScript with no new dependency.

- **Model.** `model.ts` replays a card's reviews with the same formulas as `ts-fsrs` 5.x (initial stability and difficulty, recall and forget stability, the short-term rule for reviews on the same day). `model-grad.ts` is the same model on forward-mode autodiff numbers (`dual.ts`), so gradients are exact with no hand-derived derivatives. `src/lib/fsrs.test.ts` replays random histories through Glyph's real `grade()` and through `ts-fsrs` directly and compares stability and difficulty, and checks the gradient against finite differences.
- **Fit.** Maximum a posteriori: log loss of "answer was correct" plus a prior centred on the default weights (so a small history barely moves them). Initial stabilities (w0..w3) are fitted first one at a time (golden-section search), then all weights with Adam on mini-batches of cards. Hard and Easy never occur in the two-button app, so their initial stabilities follow the fitted Again and Good ones (`settleUnused`), keeping the order Again < Hard < Good < Easy; the Hard/Easy-only weights (w15, w16) have no data and stay at the defaults. Old logs that do contain ratings 2 and 4 are still read.
- **Guard against a bad fit.** The fit is made on 80% of the cards and adopted only if it beats the current weights on the other 20% by more than one standard error of that paired comparison; then it is refitted on everything. Needs at least 300 reviews made a day or more after the previous one (`MIN_SCORED_REVIEWS`). The result shows held-out log loss and the predicted-vs-actual calibration gap before and after, or says "nothing changed".
- **MCQ guess floor (`GUESS_FLOOR = 0.25`).** A correct answer is "remembered or guessed", so the optimizer models P(correct) = 0.25 + 0.75 * R. Without it, lucky guesses flatten the fitted forgetting curve. This is why the retention setting now reads "truly remember". Anki has no such floor because a flashcard can't be guessed. It is a constant (one in four options), not fitted; partial elimination of options makes the real floor a little higher.
- **Storage.** Fitted weights are a per-device setting in localStorage (`glyph.fsrsWeights`, `hooks/use-fsrs-weights.ts`), like the retention; they are not in backups, but any device can recompute them from the (merged) review log. `grade`, `previewIntervals` and `applyReview` take an optional `weights` argument (`applyReview`'s order is now `retention, weights, now`).
- **Local days.** `ts-fsrs` counts elapsed days as the difference between UTC dates, so for someone far from UTC two reviews minutes apart could count as a day apart. `db/scheduler.ts` now hands `ts-fsrs` dates shifted so its UTC date is the local calendar day and shifts them back (`lib/fsrs/days.ts`: `toStudyClock`, `elapsedStudyDays`, `DAY_ROLLOVER_HOURS = 0` to match the queue and bury, which also use local midnight). The optimizer's history builder uses the same function, so weights are fitted on the quantity the scheduler uses. Existing due dates are unchanged.
- **Verified.** On synthetic learners whose memory differs from the defaults the fit lands within about 0.005 log loss of the true-weights oracle and cuts the calibration gap several-fold; on an unpredictable synthetic log it matches the oracle too. In the browser (dev server, synthetic revlog) the panel counts reviews, shows progress, stays responsive, stores the weights and "Reset to defaults" clears them. **Not verified: improvement on real Glyph review history**, and no comparison against Anki's own optimizer on the same data.
- **Not built:** automatic re-optimization, a per-deck fit, syncing weights in backups, showing the fitted weights, and a cancel for the browser tab being closed mid-fit (it just stops). A very large log (100k+ reviews) will take tens of seconds; the optimizer yields to the page while it works.

### Study options: pick the groups and cap new cards (v0.2.0)

Pressing Study on a Subject, Topic or tag no longer starts the session straight away. It opens `components/study/study-options-page.tsx` (a full page on `PageShell`, like the others): three checkboxes (Due, Learning, New) with live counts, and a "Max new cards" box (empty = no limit). Start shows the size of the session ("Start (54 cards)"), is the autofocused submit button (Enter starts), and is disabled when nothing would be studied. This is Anki's custom study, minus study-ahead.

- **Logic.** `buildQueue` (`lib/queue.ts`) takes `include?: Partial<QueueGroups>` and `newLimit?: number | null`; both default to the old behaviour (everything, unlimited), so the simulation in `src/sim/` is unchanged. A limit takes the oldest new cards by creation `due` (ties by card id; a card file imported in one go has one timestamp, so inside one file the order is stable but arbitrary), so the rest follow on later days. Learning and Due cards are never limited. `limitNew` is the shared clamp. `lib/study-options.ts` (pure): `StudyOptions`, `DEFAULT_STUDY_OPTIONS` (all groups on, **30 new cards**), `parseStudyOptions`, `parseNewLimit` (empty = null, whole numbers clamped to 9999, anything else is "not usable yet"), `sessionSize`.
- **Storage.** The choice is a per-device preference in localStorage (`glyph.studyOptions`, via `useStoredState`), global across decks, not in backups. The default cap of 30 is only the page's starting value; the dashboard's New / Lrn / Due numbers still show every card.
- **Wiring.** `App.tsx` has a `picking` state (the page) before `studying` (`{ scope, options }`); `StudySession` and `useStudyRun` take `options`. Back / Escape on the page returns to the dashboard.
- **Verified.** 12 new tests (queue include/limit, `limitNew`, the options parser, `sessionSize`); in the browser (dev server): the page for a Topic with 30 new cards, limit 5 showing "5 of 30" and a session of "1 / 5", the limit surviving a reload, and unchecking New giving a disabled "Nothing to study". Not exercised: a phone layout, a Subject or tag scope, and Due/Learning-only sessions with real review data (covered by unit tests).
- **Not built:** study-ahead (reviews not yet due), an exam-date mode that sets the cap from the days left, one-tap start from a dashboard count, a random pick of new cards, and a per-deck remembered choice.

### Scheduling check and due rule (after Phase 7)

`src/sim/` (`simulate.ts`, `year.test.ts`) runs the real `grade`, `buildQueue` and re-queue code against a simulated learner (exponential forgetting, a different model from FSRS) for a year on `sample-data/capitals-and-currencies.json` (30 questions), plus 300-card, vacation, weak/strong-learner and lazy-rating scenarios. It checks scheduler invariants every review and sweeps 30 seeds. Set `SIM_REPORT=<file>` to write the full report. Result: no violations, retention 86-91% against the 90% target, about 18 answers per card per year.

It found that `due <= now` made every Review card about 0.6 days late for someone who studies at a similar time each day. `countCards` and `buildQueue` now treat a Review card as due when it is due any time before the end of the local day (`endOfLocalDay` in `lib/queue.ts`); Learning/Relearning keep the exact-time check. Effect over 30 seeds (average learner): retention 87.3% -> 89.0%, lapses per card 1.73 -> 1.46, mean lateness 0.59 -> 0 days; weak learner 82.1% -> 86.3%. Known and left alone: a new card needs two sessions to reach Review (the queue is built once per session), and rating a lucky guess Good costs about 6 points of retention.

### LaTeX in questions (after Phase 7)

Question text, option text and the explanation (`extra`) now render LaTeX with KaTeX. Four delimiter forms are always accepted: `$...$` and `$$...$$`, and `\(...\)` and `\[...\]`. `$...$` is the default, i.e. the form to use in docs and sample data (`sample-data/math-sample.json` exercises all four); there is no setting to turn any of them off.

- `src/lib/math.ts` (`splitMath`, pure, 16 tests in `math.test.ts`) splits text into text/math segments. Because `$` is also a currency sign, inline `$...$` follows the Pandoc rules: the opening `$` must be followed by a non-space, the closing `$` must follow a non-space and not be followed by a digit, so "costs $5 or $10" stays text. `\$` is a literal dollar sign; unclosed, empty or blank-line-spanning spans stay as plain text.
- `src/components/rich-text.tsx` (`RichText`) renders the segments; math is drawn by `katex.render` into a ref (not `dangerouslySetInnerHTML`, rule 10), with `throwOnError: false`, `trust: false`, `strict: "ignore"` and a fallback to the raw text if KaTeX throws. Used in `question-view.tsx` and `option-button.tsx`.
- Stored note text is unchanged (still the raw string with delimiters), so hashing, `noteId`, import, backup and the editor are unaffected. The edit page and import preview show the raw text, not rendered math.
- New dependency (rule 8): `katex` (+ `@types/katex` dev), the only practical offline renderer with no network calls. Its CSS and fonts are bundled by Vite; the woff2 fonts are in the service-worker precache (18 -> 37 entries, ~1.2 MB), so math works offline. The JS bundle grew to ~850 kB (270 kB gzip); code-splitting KaTeX is possible if that matters.
- Verified in the browser (dev server): all four delimiters in question, options and explanation, currency text left alone, `\$` escape, display math centred, no console errors. Not exercised: the production build offline, a real phone, or very wide display formulas on a narrow screen (display math scrolls horizontally).

### Markdown in questions (after Phase 7)

Question text, option text and the explanation now render a small Markdown subset on top of the LaTeX support: `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `inline code` ``, fenced code blocks, `#` headings (levels 4-6 render as level 3), `-`/`*`/`+` and `1.` lists (flat, no nesting), and `>` quotes. Links, URL images, tables and raw HTML are deliberately not supported (stored images were added later via `![](img:<id>)`, see "Images in questions"). No new dependency: `src/lib/markdown.ts` (`parseMarkdown`, pure, 20 tests in `markdown.test.ts`) is a hand-written parser that returns plain data, and `RichText` turns it into React elements (rule 10 still holds; there is no HTML string anywhere).

- Math and code are cut out first, so `$a_1 * b_2$` is never read as emphasis, `$` inside code stays a dollar sign, and `**value $x$**` works. Display math (`$$`/`\[`) is not broken by lines that look like list or heading syntax.
- Safe for ordinary quiz text: `2 * 3 * 4`, `snake_case`, `C#`, `#hashtag` and "costs $5 or $10" stay plain. `\*` escapes an asterisk.
- Text with no block structure renders as a bare fragment exactly as before, so existing notes look the same. Multi-block text becomes stacked `<span>`s, because `RichText` is also used inside a `<button>` (option text), where `p`/`ul`/`pre` are not allowed.
- Stored text is unchanged, so hashing, `noteId`, import, backup and the editor are unaffected. The edit page and import preview still show raw text. `sample-data/markdown-sample.json` exercises it.

### Images in questions (after Phase 7)

Question text, option text and the explanation can contain pasted images. **The only way to add one today is to paste into a field of the edit-question page** (a screenshot from the clipboard); the bulk JSON importer does not support images yet (see the TODO below).

- **Token.** `![alt](img:<id>)`, where `<id>` is the first 32 hex digits of the SHA-256 of the stored bytes. `parseMarkdown` turns it into an `image` inline node (`lib/markdown.ts`); anything else that looks like Markdown image syntax (a URL, a short id, `javascript:`) stays plain text, so there are no network images and no new HTML path. `RichText` renders it through `components/note-image.tsx` (`NoteImage`): an `<img>` built from a `data:` URL (no object URL to revoke), with the stored width/height set to avoid layout shift, `max-w-full`, and a "[missing image]" note if the row is gone.
- **Storage.** New Dexie table `images` (`id, mime, width, height, blob`), added with `db.version(2).stores({ images: "id" })`; version 1 is untouched. Rows are content-addressed, so the same picture pasted twice is one row and a row never changes. Writes are in `db/repo/images.ts` (`addImage`, `pruneImages`); `loadImageView` and `readBackupSnapshot` are in `db/queries.ts`.
- **Compression.** `lib/image/encode.ts` (the one browser-only file in `lib/`, not unit-tested) downscales to a longest edge of 1600 px and re-encodes as WebP at quality 0.85, keeping the original only when that is not smaller and nothing was resized (GIFs are kept as they are, to keep animation). A browser that cannot encode WebP falls back to PNG when it had to resize. In the browser a 2400x1200 text screenshot went from 356 KB PNG to 97 KB WebP. Input over 15 MB is refused. The id needs `crypto.subtle`, so saving images needs https or localhost (a clear error is shown otherwise).
- **Paste flow.** `hooks/use-image-paste.ts` handles `onPaste` on the question, the four options and the extra field of `edit-note-page.tsx`: image files on the clipboard are encoded, stored at once (so the editor can show a small preview under the field), and a token is inserted at the caret on its own line (options, being single-line, get spaces instead). Plain-text pastes are untouched. Save is disabled while an image is still being processed.
- **Copying an image from a web page.** An image is never linked or downloaded; it always ends up as a stored local image. `use-image-paste.ts` looks at the clipboard in this order: (1) image files (what "Copy image" in a browser, a screenshot tool or an image editor puts there; the usual case, and any `<img src="https://...">` HTML that comes with the file is ignored); (2) if there is no file, inline `data:image/...;base64` images in the pasted HTML, decoded locally (`lib/image/clipboard.ts`: `imageSourcesInHtml`, `parseDataUrl`, pure); (3) an HTML image that only has an `http(s):`/`blob:` URL cannot be stored (the app makes no network calls and such fetches are usually blocked by CORS anyway), so it is left out, any text in the paste still goes through, and the editor shows "That is a link to an image on a website ... Right-click the image, choose Copy image, and paste again." At most 10 images per paste. Verified in the browser with simulated clipboards: file plus remote-URL HTML (stored, no URL in the text), HTML with a `data:` image (stored), HTML with a remote link (message, nothing stored). Not exercised with a real clipboard from a real web page.
- **Orphans.** `saveNote` deletes every image no note refers to, in its own transaction (tombstoned notes still count, so a restored note keeps its pictures). Leaving the edit page without saving prunes too, if anything was pasted. Export only writes images that notes use. A JSON re-import that rewrites option or extra text can leave an image unused until the next `saveNote`; harmless.
- **Backup.** `BACKUP_SCHEMA_VERSION` is now 2: the file gains an `images` list (`id, mime, width, height, data` as base64, only referenced images). Version 1 files (no `images`) still import; image rows are validated (hex id, one of webp/png/jpeg/gif, positive size, base64 shape). `importBackup` adds only the images the device lacks (`missingImages`, pure) in the same transaction; `MergeStats.imagesAdded` is reported in the summary. `mergeBackup` itself is unchanged. `readAllData` was replaced by `readBackupSnapshot`. At roughly 130 KB per image in the JSON, 300 images add about 40 MB to a backup (the 100 MB cap still applies).
- **Tests.** `lib/image.test.ts` (token build/parse, `insertAt`, `fitWithin`, base64, `imageId`, `missingImages`) plus new cases in `markdown.test.ts` and `backup.test.ts`: 220 tests in total. Verified in the browser (dev server): paste into the question (token on its own line, 356 KB -> 97 KB WebP, preview in the editor, rendered on the card after saving), paste into an option then cancel (the orphan was deleted, the saved image kept), and a backup round trip (clear the table, re-import, same id and byte size, a second import is "Nothing new to merge"). Not exercised: a real clipboard paste (the event was dispatched with a generated file), a phone, Safari/iOS (WebP encoding falls back to PNG there), and the offline/PWA path.

**TODO: images in the bulk JSON importer.** Not designed yet. Options discussed: reference images by filename (`![](img:diagram1.png)`) and pick the image files together with the JSON in the import modal (no zip library needed), or let the JSON carry a top-level `images` map of base64 data. Either needs `lib/importer` to resolve names to ids (encode and hash each file, rewrite the tokens in the rows before planning), the import preview to show missing/unused files, and `commitImport` to write the `images` rows in its transaction. The image encoder, token format and orphan handling above are already reusable for it.

### Browse and delete questions (after Phase 7)

A browse page for every question, plus deleting a single question. The Anki-style list is deliberately small: search, state filters, sort, tap to edit, delete. Query syntax, bulk select and move are not built. Suspend, bury and flag were added later (see "Suspend, bury and flag").

- **Entry points.** A "Browse" item in each Subject/Topic row's menu on the dashboard (scoped to that deck), and a list icon in the header next to the gear ("All questions"). `App.tsx` has a `browsing` view state (`{ scope: StudyScope | null }`), like `settingsOpen`; there is no router.
- **Reads.** `loadBrowseItems(scope)` in `db/queries.ts` returns every live note in live Topics under live Subjects with its card (`{ row, note }`), read with `useLiveQuery`, so edits and deletes show up at once. Everything is loaded and filtered in JS (a few thousand rows is fine), and the page shows 100 rows at a time with a "Show more" button; there is no virtual list, so no new dependency.
- **Pure logic.** `src/lib/browse.ts` (`makeBrowseRow`, `previewText`, `filterRows`, `filterCounts`, `sortRows`, `stateLabel`, `formatDue`), 20 tests in `browse.test.ts`. Search matches every word in the question, options or explanation, case-insensitively. Filters: All, New, Learning (Learning + Relearning), Review, Due, Lapsed (at least one lapse). The Due filter uses the dashboard's rule, and a test checks it equals the dashboard's Learning + Due counts. Sorts, by clicking any column header: Number (the import `sl`, natural order), Question, Topic, State, Due (New cards last), Reps, Lapses and Difficulty (the last three biggest first). Notes have no created timestamp, so there is no "Created" sort. Row text is a plain preview (`previewText`: images become "[image]", light Markdown stripped, math left raw), not `RichText`, so a long list does not run KaTeX hundreds of times.
- **Layout.** `components/browse/` (`browse-page`, `browse-row`). One table on every screen size, inside a horizontally scrollable box (`min-w-[52rem]`): No., Question (2 lines), Topic ("Subject > Topic" in the all-questions list, the topic name inside a Subject or Topic), State badge, Due, Reps, Lapses, Difficulty ("-" for a card never reviewed) and Actions. The Actions column is pinned to the right while the table scrolls, and holds a vertical-dots menu with Edit (the existing `EditNoteModal`), Copy as JSON and Delete (the delete dialog). While browsing, `App.tsx` widens the page container from `max-w-3xl` to `max-w-6xl` so the table fits without scrolling on a desktop. Rows are not clickable; every action goes through the menu.
- **Copy as JSON.** For pasting a question into a chatbot to discuss it. `noteAsJson` in `lib/browse.ts` (pure, 5 tests) gives pretty JSON `{ question, options: { A, B, C, D }, answer: "B", extra }`; `extra` is left out when empty, math and Markdown stay as typed, and image tokens become `[image]` (or `[image: alt]`) because a picture cannot travel as text. `components/browse/copy-text.ts` writes it with the async Clipboard API and falls back to a hidden textarea and `execCommand`; the page shows "Copied the question as JSON." (or an error) for three seconds. The format is not the importer's (`op1..op4`), so it is for reading, not for re-importing.
- **Delete.** `deleteNote(id)` in `db/repo/notes.ts` sets `deletedAt` in one transaction (never lower than `contentUpdatedAt + 1`, so the tombstone beats the note's own older copies in a backup merge). The card row, revlog and images are kept; importing the same question again resurrects it (existing importer behaviour) with its progress. The deletion propagates through backups like a deck's. `components/delete-note-dialog.tsx` (`DeleteNoteDialog`) confirms it and is used by both places. No keyboard shortcut, on purpose.
- **In the study session.** A trash button next to Edit in the toolbar. After a delete the card and its re-queued copies leave the queue (`dropCardFrom` in `lib/session.ts`, tested), the next card takes its place without going through the "no longer available" screen, and the card's answers are removed from the undo history and the summary (its review rows stay in the database). `finished`/`empty` now also look at the history, so deleting the last queued cards after some answers shows the summary, not "Nothing to study".
- **Verified in the browser** (dev server, 130 generated questions across two topics): the subject-scoped list, search across question and explanation, the Due chip equal to the dashboard's Learning + Due, delete from the list (row gone, count 130 -> 129, note tombstoned, card kept), edit from the list (row text updates live), the table on a 375px phone (sideways scroll, pinned Actions column) and on a 1024px desktop (fits without scrolling), the Edit, Copy as JSON and Delete items of the Actions menu (the clipboard text captured for a question with an image, and the confirmation message), and in a study session: delete before answering (1 / 3 -> 1 / 2, next card shown) and delete after a Pass (summary shows only the answered card, Undo still enabled). Not exercised: the clipboard fallback path (a browser without `navigator.clipboard`), the Topic-scoped and header "All questions" pages, long lists (the "Show more" button), restoring a deleted question by re-import, a backup round trip of a deleted question (covered by the existing `pickNote` tests), and a real phone.

### Tags (after Phase 7)

Anki-style tags on questions: a flat list per note, set in the editor or the importer, used to filter the browse list and to study across decks.

- **Format.** `src/lib/tags.ts` (`parseTags`, `normalizeTag`, `tagsError`, `sameTags`, `formatTags`, `tagCounts`; pure, 20 tests in `tags.test.ts`). A tag is lowercase with no spaces: input is trimmed, a leading `#` is dropped, case is folded, and a string is split on whitespace, commas and semicolons (an array entry like `"Organic Chem"` becomes `organic-chem`). A note's tags are unique and sorted, so two lists compare directly. Limits: 40 characters per tag, 30 tags per note. There are no hierarchical (`a::b`) tags; `::` is just part of the name.
- **Storage.** `Note.tags: string[]`, always present. `db.version(3)` adds a multi-entry `*tags` index on `notes` and an upgrade that gives every existing note `tags: []` (version 1 and 2 are untouched). Tags travel with the note, so editing them bumps `contentUpdatedAt` and merges like any other note edit; no new table. The seed questions carry sample tags.
- **Importer.** An optional `"tags"` key per row: a list of text (`["physics", "exam"]`) or one string (`"physics, exam"`). A row whose `tags` is neither is invalid; a too-long tag is invalid. **If the key is absent the stored tags are left alone** (so a file without tags never wipes tags edited in the app, and other fields changing doesn't touch them); an empty list or empty string clears them; `null` counts as absent. A changed tag list makes the note "updated". `sample-data/capitals-and-currencies.json` now carries tags.
- **Backup.** `BACKUP_SCHEMA_VERSION` is 3 (the notes' `tags`). Version 1 and 2 files still import; their notes read as untagged. Tags in a file are validated (a list of text) and normalized on read. `mergeBackup` is unchanged: the newer note edit wins, tags included, so a stale untagged copy with a later `contentUpdatedAt` would clear tags (the same rule as every other note field).
- **Editor.** A Tags field in `edit-note-page.tsx` (space/comma separated, parsed live into `NoteDraft.tags`) with one-tap "+ tag" suggestions of existing tags (`loadTagNames`, at most 12). Invalid tags block Save like an empty question. `validateDraft` / `draftChangesNote` cover them.
- **Browse.** A Tags column (up to three chips, "+n" for the rest; click a chip to filter), a sortable header, and a row of tag chips with counts above the table; selecting several tags needs a question to carry all of them (AND, exact match). The free-text search also matches tags. Copy as JSON adds a `tags` list when there is one. Clear resets tags too.
- **Dashboard and study.** A collapsible "Tags (n)" section under the deck tree (`components/tag-list.tsx`, collapse state in `glyph.tagsCollapsed`) lists every tag in use by a live question with New / Lrn / Due counts, a Study button and a Browse menu item. `StudyScope` gained `kind: "tag"` (`id` is the tag, `name` is `#tag`); a tag session is mixed like a Subject session (`mixed: scope.kind !== "topic"`). `db/queries.ts` has a shared `QueryScope`; `loadStudyCards` and `loadBrowseItems` read tag scopes through the `*tags` index, and `loadDashboard` returns `tags` (one index lookup per distinct tag). Tags that only deleted questions or deleted decks carry do not show.
- **Verified in the browser** (dev server, an existing version-2 database): the upgrade left old notes with `tags: []`, importing the tagged sample file, the four tag rows and counts on the dashboard, Browse from a tag (scoped list, Tags column, chips with counts), editing a question's tags (typed text normalized, a suggestion appended, the new tags appear in the list and the chip bar), filtering by one tag, a tag study session (`#economics`, 16 cards across Subjects, mixed), and a backup export/parse round trip (version 3, tags equal). Not exercised: Import Backup of a version 2 file through the UI, deleting a question that carries tags, a very long tag list, a phone layout, and the production build offline.
- **Not built:** hierarchical tags, renaming or merging a tag everywhere, bulk add/remove tags in Browse, a tag manager screen, an OR filter, and tag counts that exclude tags carried only by deleted notes in the editor's suggestions (they still appear there).

### Settings data rows and session summary (after Phase 7)

Settings > Data lists three full-width action rows (`DataAction` in `settings-page.tsx`) under Questions (Import questions) and Backup (Export backup, Restore backup), each with a one-line description. The end-of-session screen (`study/end-states.tsx`, `FinishedState`) shows an animated accuracy ring, a verdict line and stat tiles (cards, answers, time, average per answer) instead of a plain list; it takes the run's history and the scope name. Both were checked by typecheck, lint and the build, not exercised in the browser.

### Suspend, bury and flag (after Phase 7)

Anki-style card marks, plus a keyboard layer for a computer. A **flag** (seven colours) is a label; a **suspended** card is left out of studying until it is unsuspended; a **buried** card is left out until the start of the next local day and then returns by itself.

- **Storage.** Four plain fields on the card row (`CardRow extends CardMarks`): `flag` (0 = none, 1-7 = Red, Orange, Green, Blue, Pink, Turquoise, Purple), `suspended`, `buriedUntil` (ms epoch, 0 = not buried; buried while it is in the future, so there is nothing to clear at midnight) and `markedAt` (when the marks last changed). `db.version(4)` has no new index (they are filtered in JS) and an upgrade that gives every card the defaults; versions 1-3 are untouched. A review never changes them: `applyReview` and `undoReview` re-read the marks from the stored row (so a flag set a moment ago is not overwritten by an older copy), `cardToRow` carries them through grading, and a "Reset FSRS progress" edit keeps them.
- **Pure logic.** `src/lib/card-marks.ts` (`marksOf`, `isHidden`, `isBuried`, `nextDayStart`, `toggleFlag`, `flagFromKeyCode`, `newerMarks`, flag names; 17 tests). `lib/queue.ts`: `countCards` and `buildQueue` skip suspended and buried cards, so the dashboard counts, tag counts and every study session leave them out. `lib/browse.ts`: rows carry the marks; new filters Flagged / Suspended / Buried, a flag-colour filter (`filterRows` `flags` option, `flagCounts`), a Flag sort, and `isDueRow` is false for a hidden card, so the Due chip still equals the dashboard's Learning + Due.
- **Writes.** `db/repo/cards.ts`: `setFlag`, `setSuspended`, `buryCard` (default until the next local midnight), `unburyCard`, `restoreMarks`. Each is one transaction on the stored row, stamps `markedAt` (always later than before, so it wins a merge) and skips a no-op.
- **Backup.** `BACKUP_SCHEMA_VERSION` is 4. Older files still import (cards read as unmarked); marks in a file are validated. **Merge:** `pickCard` decides progress (the FSRS fields) by the old rule (larger `lastReview`, then `updatedAt`) and the marks separately by the larger `markedAt` (a tie keeps the progress winner's marks), so flagging on one device and reviewing on another both survive. It hands back one of the two existing rows when nothing changes, so merging stays idempotent.
- **Study session.** The toolbar has a flag button (the card's colour when flagged) opening a menu: seven colours, Remove flag, Suspend, Bury until tomorrow; the card shows a coloured left border. Suspending or burying removes the card and its re-queued copies from the queue and moves on; the answers already given stay in the summary. **Z undoes the latest suspend or bury first** (`Run.lastMark`, restoring the card, the queue position and the phase it was in), and only while no review came after it; older reviews undo as before, and an undone review never brings a hidden card back into the queue (`Run.hidden`). A flag has no undo (pick it again to clear it). A one-line notice ("Card suspended. Z undoes it.") shows under the toolbar.
- **Browse.** A Flag column (sortable), "Suspended" and "Buried" badges next to the state (suspended rows are tinted), the three new filter chips, a Flags chip row (any selected colour, with counts) and the card items in each row's Actions menu (flag colours, Suspend / Unsuspend, Bury until tomorrow / Unbury). The menu scrolls when it is taller than the screen (`dropdown-menu.tsx` caps its height).
- **Keyboard (computer).** The session's shortcuts: `S` or `@` suspend, `-` bury, `Ctrl+1`..`Ctrl+7` set a flag (the same key clears it; read from the key code, so it works on any layout; Ctrl+digit may switch tabs in some browsers, so the toolbar menu is the fallback), `?` opens a **Keyboard shortcuts** page (`study/shortcuts-page.tsx`, a full page like the others, also reachable from a keyboard button in the toolbar that only shows from the `sm` breakpoint up). The list lives in `SHORTCUT_GROUPS` (`study/helpers.ts`); keep it in step with `use-study-keys.ts`. The shortcuts pause while the flag menu is open (`onMenuOpenChange`), so Escape closes the menu instead of opening the leave prompt, and the menu is opened with `finalFocus={false}` so Space after picking an item still means Next. The earlier keys (1-4 / A-D, Space, P, F, E, Z, Esc) are unchanged.
- **Verified in the browser** (dev server, an existing version-3 database, mobile 375px and desktop): the v4 upgrade (all cards got the defaults), flag from the menu and from `Ctrl+2` / `Ctrl+4`, suspend with `S` and bury with `-` (queue 30 -> 29, DB fields, review kept), Z undo of both (including a bury after a wrong answer, which came back in the wrong-answer phase with its re-queued copy), a flag set before Pass surviving the review, the `?` page and Escape back to the session, Escape with the menu open, the toolbar fitting at 375px, the browse Flag column, Flags chips, Suspend from a row menu, the Suspended filter, and the dashboard and study queue leaving the suspended card out (30 new -> 27 new + 1 learning with three cards touched). Not exercised: the Browse row's flag items and Bury / Unbury, a backup file round trip through the UI (the merge and parse are unit-tested), a real keyboard on Firefox/Safari (Ctrl+digit), and the offline/PWA path.
- **Not built:** suspending or burying from the dashboard (whole decks), bulk flag/suspend in Browse, "study the flagged cards" as a session, Anki's `flag:`/`is:suspended` search syntax, a "bury note" (a note has one card), an auto-unbury time other than midnight, and browse-page shortcuts.

### Refactor: smaller files (after Phase 7)

Pure restructuring, no behavior change. The four largest modules became directories; import paths for `@/lib/backup`, `@/lib/importer` and `@/db/repo` are unchanged (barrel `index.ts`). Phase notes below still name the old single files.

- `src/lib/backup/`: `types`, `export`, `read-rows` (row validators), `parse`, `pick` (conflict rules), `merge`, `summary`.
- `src/lib/importer/`: `types`, `parse` (`parseImportText`, `validateRows`), `plan` (`planImport`, `summarize`, `formatSummary`), `deck-ref`.
- `src/db/repo/`: `decks`, `notes`, `reviews`, `import-notes` (`commitImport`), `import-backup` (`importBackup`), `clean-name`.
- `src/components/study/`: `study-session` (shell), `use-study-run` (queue, answers, undo), `use-study-keys`, `session-toolbar`, `question-view`, `end-states`, `exit-page`, `types`, `helpers`. Imported as `@/components/study/study-session`.
- `src/components/import/`: `import-page`, `file-drop`, `deck-field` (Subject/Topic picker, replaces two near-identical blocks), `import-preview`, `use-import-file`. Imported as `@/components/import/import-page`.

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
- The import page previews against the live stored notes; for a not-yet-created topic every row is "new".
- Importer rows accept numeric `sl`/options/answer; the key is `questions` (plural), as in the plan.
- The 10 MB cap is checked before reading the file. The commit is not chunked (a single `bulkPut`/`bulkAdd`), which is fine for the few-thousand-row target.

### Phase 5 notes

- **Study button.** The dashboard passes `scope` to `onStudy`. Phase 6 wired it: the session calls `buildQueue` (Topic: `mixed: false`; Subject: `mixed: true`) with cards from `loadStudyCards` (non-tombstoned notes only, like `loadDashboard`).
- **Counts use the `topicId` index plus pure `countCards`**, not the `[topicId+state]` / `[topicId+due]` compound indexes the plan mentions (a topic's cards are loaded once and counted in JS; dead notes are excluded via the `deletedAt` index). The compound indexes are still defined for Phase 6.
- **Learning count = Learning/Relearning cards due now.** The dashboard re-reads every 60 s so cards that become due (and the 04:00 rollover) appear without a reload. A non-due learning card is in neither the count nor the queue.
- **No daily new-card limit (removed after Phase 7, deliberately differs from the plan):** every New card is shown in the counts. A session's new-card cap is now chosen per session on the study options page (see "Study options"); the old `glyph.newLimit` localStorage key is still ignored.
- **Queue order:** Topic = learning (most overdue first), then due reviews least stable first (FSRS stability ascending, ties by oldest due; no shuffle), then shuffled new; Subject/tag = learning first, then the same stability-ordered reviews with the shuffled new cards spread through them at seeded positions (`interleave` in `lib/queue.ts`). When more new cards exist than the allowance, the oldest (by creation `due`) are chosen.
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
3. Images in the bulk JSON importer (see "Images in questions").
4. Browse follow-ups if wanted: bulk select (delete, move, reset), moving a question to another topic, Anki-style query syntax (`is:due prop:lapses>3`) and "study these results" (suspend and flags are done, see "Suspend, bury and flag").
5. Try suspend / bury / flag on a real phone and with Ctrl+digit in Firefox and Safari (only the in-app browser was used), and exercise the Browse row's flag and Bury items and a backup round trip through the UI.
6. Items from "Nice-to-Haves" in section 12, if wanted.

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
    ImportPage.tsx
    BackupControls.tsx
    StudySession.tsx
    OptionButton.tsx
    EditNotePage.tsx
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

## 5. Phase 4 — Bulk JSON Importer (`ImportPage.tsx`, `lib/importer.ts`)

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

Ignore shortcuts while an edit/confirm page is open or focus is in an input/textarea.

### Editor (`EditNotePage.tsx`)

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

Cloud sync, accounts, images/rich text in questions (both since added, see above; images are paste-only and not in the JSON importer yet), per-deck FSRS parameter tuning, statistics charts, deck export to Anki format, multi-select questions.

## 12. Nice-to-Haves (only after all checkpoints pass)

Stats screen (reviews per day, retention), per-deck daily limits, CSV import, haptic feedback on mobile, FSRS parameter optimization from `revlog`.

**Decided against:** renaming Note / CardRow / Revlog. The names match Anki's (Note, Card, Revlog), which is useful when using Anki as a reference for new features.
