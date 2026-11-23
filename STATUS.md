# Glyph — MCQ Spaced-Repetition PWA — Status & Build Plan

An offline-first, Anki-style MCQ study app. Single-user, no backend, no auth. Data lives in SQLite (Dexie until 2026-11-23, see "SQLite replaces Dexie"); scheduling uses FSRS (`ts-fsrs`); devices sync by JSON backup file transfer or by a direct peer-to-peer connection on the local network (see "Device-to-device sync").

**Stack (as built):** Vite 8, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui, Dexie + `dexie-react-hooks`, `ts-fsrs`, `lucide-react`, `vite-plugin-pwa`, Vitest (dev only). The project was scaffolded on Next.js and migrated to Vite before Phase 4, so it now matches the plan's stack; see "Deviations".

This file was `PLAN.md`; it is both the plan and the running status. Update the table and checklist at the end of every phase.

---

## Current Status

**Current version: 0.3.0** (the version shows in the app footer and comes from `package.json`). **Current phase: all seven phases are built.** Phase 7 (PWA offline verification) is done except replacing the placeholder icons. Work added after Phase 7 is described in the sections below (configurable retention, LaTeX, Markdown, images, browse and delete, tags, full pages, **suspend / bury / flag with study hotkeys**, and a redesign of the settings data actions and the end-of-session summary). 425 tests pass; typecheck, lint and build are clean. Added in v0.2.0: an FSRS parameter optimizer and local-day scheduling (see "FSRS optimizer and local-day scheduling"), and a study options page (see "Study options"). Added in v0.3.0: due reviews are asked least stable first (see "Queue order"). After v0.3.0: complete review-log rows and a per-question Review history page in Browse (see "Review log and per-question history"); this also reset all card progress to New. After that: device-to-device sync (below), then settings that sync plus automatic FSRS re-fit and leeches (see "Synced settings and automatic re-fit" and "Leeches"), then the reliability work on backup, import and sync (R0-R6 are built, see "Reliability plan"; R7 is not). The Next.js → Vite migration is complete.

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

Settings > Scheduling has a Desired retention slider (70-97%, default 85%, was ts-fsrs's 90%) and a reset button. The value was a per-device localStorage preference; it is now a synced setting in the `settings` table (see "Synced settings and automatic re-fit"). `db/scheduler.ts` keeps one `fsrs` instance per retention value (`schedulerFor`) and `grade`, `previewIntervals` and `applyReview` take a trailing `retention` argument that defaults to `DEFAULT_RETENTION`; `use-study-run.ts` passes the stored value. It affects only future reviews; existing due dates are not recomputed. The `src/sim/` runs use the 85% default.

### FSRS optimizer and local-day scheduling (v0.2.0)

Settings > Scheduling > **Personalized parameters** fits the 21 FSRS-6 weights to the user's own review log (`src/lib/fsrs/`, UI in `components/fsrs-optimizer.tsx`). Anki ships an optimizer; `ts-fsrs` does not, so this is our own, in plain TypeScript with no new dependency.

- **Model.** `model.ts` replays a card's reviews with the same formulas as `ts-fsrs` 5.x (initial stability and difficulty, recall and forget stability, the short-term rule for reviews on the same day). `model-grad.ts` is the same model on forward-mode autodiff numbers (`dual.ts`), so gradients are exact with no hand-derived derivatives. `src/lib/fsrs.test.ts` replays random histories through Glyph's real `grade()` and through `ts-fsrs` directly and compares stability and difficulty, and checks the gradient against finite differences.
- **Fit.** Maximum a posteriori: log loss of "answer was correct" plus a prior centred on the default weights (so a small history barely moves them). Initial stabilities (w0..w3) are fitted first one at a time (golden-section search), then all weights with Adam on mini-batches of cards. Hard and Easy never occur in the two-button app, so their initial stabilities follow the fitted Again and Good ones (`settleUnused`), keeping the order Again < Hard < Good < Easy; the Hard/Easy-only weights (w15, w16) have no data and stay at the defaults. Old logs that do contain ratings 2 and 4 are still read.
- **Guard against a bad fit.** The fit is made on 80% of the cards and adopted only if it beats the current weights on the other 20% by more than one standard error of that paired comparison; then it is refitted on everything. Needs at least 300 reviews made a day or more after the previous one (`MIN_SCORED_REVIEWS`). The result shows held-out log loss and the predicted-vs-actual calibration gap before and after, or says "nothing changed".
- **MCQ guess floor (`GUESS_FLOOR = 0.25`).** A correct answer is "remembered or guessed", so the optimizer models P(correct) = 0.25 + 0.75 * R. Without it, lucky guesses flatten the fitted forgetting curve. This is why the retention setting now reads "truly remember". Anki has no such floor because a flashcard can't be guessed. It is a constant (one in four options), not fitted; partial elimination of options makes the real floor a little higher.
- **Storage.** Fitted weights were a per-device localStorage setting; they are now part of the synced `fit` setting (see "Synced settings and automatic re-fit"), and the fit also runs by itself. `grade`, `previewIntervals` and `applyReview` take an optional `weights` argument (`applyReview`'s order is now `retention, weights, now`).
- **Local days.** `ts-fsrs` counts elapsed days as the difference between UTC dates, so for someone far from UTC two reviews minutes apart could count as a day apart. `db/scheduler.ts` now hands `ts-fsrs` dates shifted so its UTC date is the local calendar day and shifts them back (`lib/fsrs/days.ts`: `toStudyClock`, `elapsedStudyDays`, `DAY_ROLLOVER_HOURS = 0` to match the queue and bury, which also use local midnight). The optimizer's history builder uses the same function, so weights are fitted on the quantity the scheduler uses. Existing due dates are unchanged.
- **Verified.** On synthetic learners whose memory differs from the defaults the fit lands within about 0.005 log loss of the true-weights oracle and cuts the calibration gap several-fold; on an unpredictable synthetic log it matches the oracle too. In the browser (dev server, synthetic revlog) the panel counts reviews, shows progress, stays responsive, stores the weights and "Reset to defaults" clears them. **Not verified: improvement on real Glyph review history**, and no comparison against Anki's own optimizer on the same data.
- **Not built:** a per-deck fit, showing the fitted weights, and a cancel for the browser tab being closed mid-fit (it just stops). A very large log (100k+ reviews) will take tens of seconds; the optimizer yields to the page while it works.

### Study options: pick the groups and cap new cards (v0.2.0)

Pressing Study on a Subject, Topic or tag no longer starts the session straight away. It opens `components/study/study-options-page.tsx` (a full page on `PageShell`, like the others): three checkboxes (Due, Learning, New) with live counts, and a "Max new cards" box (empty = no limit). Start shows the size of the session ("Start (54 cards)"), is the autofocused submit button (Enter starts), and is disabled when nothing would be studied. This is Anki's custom study, minus study-ahead.

- **Logic.** `buildQueue` (`lib/queue.ts`) takes `include?: Partial<QueueGroups>` and `newLimit?: number | null`; both default to the old behaviour (everything, unlimited), so the simulation in `src/sim/` is unchanged. A limit takes the oldest new cards by creation `due` (ties by card id; a card file imported in one go has one timestamp, so inside one file the order is stable but arbitrary), so the rest follow on later days. Learning and Due cards are never limited. `limitNew` is the shared clamp. `lib/study-options.ts` (pure): `StudyOptions`, `DEFAULT_STUDY_OPTIONS` (all groups on, **no new-card limit**; it was 30 until the big deck check), `parseStudyOptions`, `parseNewLimit` (empty = null, whole numbers taken as typed with no upper cap, anything else is "not usable yet"), `sessionSize`.
- **Storage.** The choice is a per-device preference in localStorage (`glyph.studyOptions`, via `useStoredState`), global across decks, not in backups. A limit is only what the user types (a value saved earlier on a device, such as the old default 30, stays until the box is cleared); the dashboard's New / Lrn / Due numbers still show every card.
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
- **Backup.** `BACKUP_SCHEMA_VERSION` is now 2: the file gains an `images` list (`id, mime, width, height, data` as base64, only referenced images). Version 1 files (no `images`) still import; image rows are validated (hex id, one of webp/png/jpeg/gif, positive size, base64 shape). `importBackup` adds only the images the device lacks (`missingImages`, pure) in the same transaction; `MergeStats.imagesAdded` is reported in the summary. `mergeBackup` itself is unchanged. `readAllData` was replaced by `readBackupSnapshot`. At roughly 130 KB per image in the JSON, 300 images add about 40 MB to a backup (there is no size cap on a backup).
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

### Review log and per-question history (after v0.3.0)

There is one `revlog` table with a row per review (not a table per card: Dexie tables are fixed in the schema, cross-card analytics would need joins, and merge/undo rely on one log). A card's history is `revlog.where("cardId")`. Every row is complete (all fields required, no "might be missing" cases): the old `rating`, `state` (before), `durationMs` plus `answerMs` (time until the option was picked; `durationMs` also includes reading the explanation before Pass/Fail, so only `answerMs` is the time to answer), `correct` (the picked option was right; a right pick rated Again is a guess, so this is not `rating`) and the card's state after the review: `stabilityAfter`, `difficultyAfter`, `scheduledDaysAfter`, `dueAfter` (so memory charts need no replay, which would change if the FSRS weights change). The picked option is deliberately NOT stored: an index goes stale when the note's options are edited or reordered.

- **Wiring.** `grade()` takes a trailing `answer?: ReviewAnswer { correct, answerMs }` (defaults: a pass is a right pick, `answerMs = durationMs`, so the simulation and tests stay unchanged) and fills the `...After` fields from the new row. `applyReview` passes `answer` through (after `now`, so callers pass `undefined` for it); `use-study-run.ts` passes `{ correct: false, answerMs: durationMs }` for a wrong pick and `{ correct: true, answerMs: pickedAt - shownAt }` for Pass/Fail on a right pick.
- **Wipe (Dexie `version(5)`).** Old rows can't be completed, so the upgrade clears `revlog` and resets every card to New (flag/suspend/bury kept); questions, decks, tags and images are untouched. This was chosen deliberately (the app had no real study data); it also runs on any other device that opens the app with older data.
- **Backup.** `BACKUP_SCHEMA_VERSION` is 5. `readLog` requires every field in a version 5 file (one bad row rejects it, like the other tables). A file older than 5 still imports (questions and cards) but its review rows are skipped (`parseBackup`); cards from such a file can therefore have progress with no log. `mergeBackup` is unchanged (revlog is a union by id).
- **History page.** `components/card-history-page.tsx` (full page on `PageShell`, read-only, live via `useLiveQuery(loadCardHistory)`), opened from **Review history** in a Browse row's Actions menu. Summary: reviews, answered correctly (n of m, %), average time to answer (all, and right picks only), first and last studied, next due, stability (`formatInterval(stability days)`), difficulty, times forgotten, status, total time (reading included); then a line per review, newest first (when, Right / Wrong / "Right, marked Fail", time to pick, next interval). The numbers come from `lib/card-history.ts` (`summarizeHistory`, pure, 6 tests).
- **Verified.** 382 tests; typecheck, lint, build clean. In the browser (dev server, a database with 2,600+ old rows): the upgrade left 0 review rows, 37 questions and 37 New cards; a wrong pick and a right pick plus Pass wrote complete rows (`answerMs` 3.7 s against `durationMs` 7.8 s for the right pick); the History page showed the right numbers on desktop and at 375px.
- **Not built:** a History button in the study session (the toolbar is tight on a phone), the Statistics screen (Settings > Statistics is still a placeholder), a "guessed" or leech list, and charts. Not exercised: History for a card with several reviews and lapses, restoring an older backup through the UI.

### Device-to-device sync over the local network (after v0.3.0)

Settings > Data > Devices > **Sync with another device** merges two devices on the same wifi with no server. It is a peer-to-peer WebRTC data channel; the backup file route still works and is unchanged.

- **Why pairing codes.** A browser cannot discover devices on the LAN or listen for connections, so the two devices swap two codes by hand: device 1 (Start) shows a text code (its WebRTC offer, about 600 characters) with a Copy button, the user sends it to the other device through any chat, email or notes app, device 2 (Join) pastes it and gets a reply code, which goes back and is pasted on device 1. Then they connect directly and the sync runs by itself. QR codes were built first and removed on purpose: they needed two dependencies (`qrcode`, `jsqr`) and camera code for a convenience, and the paste route needs neither. If the copy-and-paste hop proves annoying, QR is the obvious add-back (the code is short enough). No signalling server and **no ICE servers** (`iceServers: []`), so nothing leaves the local network and the "no runtime network calls" rule holds. A second path (a relay on the laptop) was rejected: an HTTPS or installed PWA cannot call plain-HTTP LAN addresses, and a plain-HTTP page has no service worker.
- **What is sent.** Each device sends its whole backup (`exportBackup` + `serializeBackup`, schema version and image rows included) as bytes and merges the other's with `parseBackup` + `importBackup`. So the merge rules are exactly the backup-file rules (newer note edit wins, marks by `markedAt`, revlog union by id) and a repeated sync is a no-op. Both directions run at once; a sync is done when a device has merged the other's data and received the other's `ok`.
- **Pure logic** (`src/lib/sync/`, 13 tests in `src/lib/sync.test.ts`): `pairing.ts` (`encodePairing` / `decodePairing`: `glyph1:<o|a>:<base64 of the deflate-raw SDP>`, about 600 characters, well inside a QR code's capacity; bad, damaged or wrong-kind codes are errors, never throws) and `protocol.ts` (`hello` / `ok` / `fail` control messages, 16 KiB `splitChunks`, `Reassembler` that refuses any data beyond what was promised (there is no size cap; see "Big deck check")).
- **Browser-only** (not unit-tested, like `lib/image/encode.ts`): `lib/sync/rtc.ts` (`openOffer`, `openAnswer`, `Link` with back-pressure on `bufferedAmount`; the offer waits up to 4 s for ICE gathering since no candidates are trickled), `hooks/use-peer-sync.ts` (the state machine: idle, working, offer, answer, connecting, syncing, done, error; the starter gives up 25 s after taking the reply), and `components/sync/` (`sync-page` on `PageShell`, `code-entry` = a paste box with a "Paste from clipboard" button). App has a `syncOpen` view like `importOpen`; Back is blocked while data is being written.
- **No new dependencies.** Compression uses the browser's `CompressionStream` (Chrome 103+, Safari 16.4+, Firefox 113+). "Paste from clipboard" uses `navigator.clipboard.readText`, which may ask permission or be refused; pasting into the box always works.
- **Limits.** It only works when the devices can reach each other: a guest network or a router with client isolation blocks it (the error says so); a phone hotspot usually works. Browsers hide LAN addresses behind mDNS names (`xxxx.local`); the two devices must be able to resolve them, which is normal on one wifi but unverified here.
- **Verified.** 395 tests; typecheck, lint, build clean. In the browser (dev server): two tabs ran the whole flow through the real UI (the pairing code carried between tabs as paste, connected, synced, "Sync complete" on both), and the page fits at 375 px. The two tabs shared one IndexedDB, so the merge result was "Nothing new". **Not verified:** a merge of two different databases over the channel, a real second device, a transfer big enough to need back-pressure, iOS Safari, and the offline/installed PWA.
- **Not built:** automatic discovery or one-tap re-pairing, remembering paired devices, syncing only the changes since the last sync, more than two devices at once, progress for a large transfer, and a fallback relay.

### Sync sends only what changed (after the big deck check)

Device sync (above) used to send each device's whole backup every time (100 MB+ at 50,000 questions and a few months of study, as one string). It now sends only rows changed since the last sync, in small parts, and checks at the end that both devices hold the same rows. The pairing (two pasted codes) and the WebRTC link are unchanged.

- **Protocol v3** (`lib/sync/protocol.ts`; v2 compared row counts, see Reliability R1-R2): `hi` (device id, version), `plan` (`delta` or `full`, round 1 or 2), `part` (bytes follow), `end`, `ok` (the device's digests), `ping`, `fail`. A version 1 or 2 device is refused with "different version". The conversation is `SyncSession` (`lib/sync/session.ts`), a pure state machine with its own `io` and `deps`, so `src/lib/sync-session.test.ts` runs two fake devices against each other (first sync in several parts, delta, self-healing, failure on both sides, same-device and version refusals, 120 parts in order). `hooks/use-peer-sync.ts` only connects it to the data channel and the database.
- **What "changed" means** (`lib/sync/delta.ts`, `db/backup-parts.ts`): a note's `contentUpdatedAt` or `deletedAt`, a card's `updatedAt` or `markedAt`, a review's `reviewedAt`, a deck's or setting's `updatedAt`; images used by the notes sent. Dexie `version(7)` adds the `contentUpdatedAt`, `updatedAt` and `markedAt` indexes so changed rows are an index lookup. `readBackupParts(since)` yields `BackupFile`-shaped parts (2,000 notes, 5,000 cards, 10,000 reviews, 10 images at most), so each goes through the normal `parseBackup` and `importBackup` and no buffer is ever the whole data.
- **Marks.** Each device keeps a random id (`glyph.deviceId`) and, per other device, when their last complete sync started (`glyph.syncMarks`), both in localStorage (not synced, not in backups). The next sync sends rows changed since the mark minus two days (clock differences; a row sent twice is harmless). No mark means a full sync.
- **Self-healing.** After merging, each device sends its digests (per table, the row count and a hash of every row's id and change stamp; see R1 below). They must match; only then is the mark set. If they do not and a delta was involved, both repeat once as a full round; if they still differ the sync fails with a message and no mark is set. So a clock set back, wiped data or a bug can cost one full sync but not silent drift.
- **`importBackup` reads only what it needs.** It used to load every local row for every merge; it now reads the local rows with the incoming ids (and decks, which are few), so a merge of a few changed rows costs milliseconds, not a scan of 200,000 reviews. Its stand-in card for a note that has none is stamped time 0 (it used to be `now`): in a multi-part sync the notes arrive before their cards, and a stand-in stamped `now` beat the real card of a never-reviewed question, leaving the two devices with different creation times (which order new cards). Found by the real two-device test below.
- **Tested for real.** Two dev-server origins (two separate databases) through the real Sync page and real WebRTC, pairing codes carried by a throwaway local relay: device A with 50,000 questions in 10 decks and 19,887 reviews, device B empty. First sync (everything, 40 parts) took 36 s; afterwards decks, notes, cards and reviews were identical on both (counts and a fingerprint of every row). After 1,000 reviews on A and 500 on B, the second sync sent 4 parts, took about 1 s, said "Only what changed since your last sync was sent", and the fingerprints matched again (21,387 reviews each).
- **Two-year size (real database, two origins).** 50,000 questions in 10 decks and 670,389 reviews (740 days at about 1,000 answers a day; the database was built by writing the simulation's results in bulk, `bulk: true` in `browser-run.ts`, because per-review writes dropped to about 100 a second on a loaded machine; the per-review path itself was verified through 222,573 reviews). A first full sync to an empty second device took about 2.5 minutes (104 parts) and ended identical on both (counts and a fingerprint of every card, note, review and deck). A file backup was 227.9 MB: read from the database in 12.5 s, serialized in 0.5 s, parsed in 1.7 s, restored into an emptied database in 97 s with identical card progress; the page's JavaScript heap peaked at about 760 MB (a phone may not allow that). The database was about 550 MB.
- **Bug found there: auto-refit restarted on every sync part.** `useAutoFit` restarted (and reloaded the whole review log) every time the review count changed, so during a sync of 670,000 reviews it fought the merge for CPU and the sync slowed to about 30 s per part (81 parts in 15 minutes). Fixed two ways: it is paused while the Sync page is open (`App.tsx`), and it now waits 15 s without a new review before starting (`QUIET_MS` in `use-auto-fit.ts`), which also protects a backup restore or import. The same sync then ran at 100 parts in about 2 minutes.
- **Not tested:** a real phone and laptop (the two origins were two tabs of one browser on one machine, so no real wifi or mDNS), a sync interrupted halfway, clocks that disagree by more than the overlap, more than two devices, and the zip backup file (the parts reader is ready for it; the file format is still one JSON).
- **Not built:** scanning pairing codes by QR, remembering a paired device, and a progress bar beyond "Sent n parts, received m".

### Synced settings and automatic re-fit (after v0.3.0)

Retention and the fitted FSRS weights used to be per-device (localStorage), so two devices could drift apart. They now live in the data, travel in backups and device sync, and the weights are refitted automatically.

- **Storage.** Dexie `version(6)` adds a `settings` table (`key` primary; rows `{ key, value, updatedAt }`). Pure logic in `lib/settings.ts` (`SettingValues`, `DEFAULT_SETTINGS`, `SETTING_PARSERS`, `readSettingRow`, `resolveSettings`, `mergeSettings`, 12 tests in `settings.test.ts`). Keys: `retention`, `fit` (`{ weights | null, reviews }`), `autoFit`, `leechThreshold`, `leechAction`. A key with no row uses the default. Retention's range and parsing moved to `lib/retention.ts` (re-exported by `db/scheduler.ts`). Writes: `saveSetting` in `db/repo/settings.ts` (`updatedAt` always later than the stored row's). Read live with `hooks/use-settings.ts` (`useSettings`, `useSetting`, the latter shows a new value at once so a slider doesn't jump back while the write is in flight). `use-retention.ts` and `use-fsrs-weights.ts` were removed.
- **Upgrade.** `adoptLegacySettings` (run by `DbProvider` after startup, best effort) moves `glyph.retention` and `glyph.fsrsWeights` from localStorage into the table once and deletes the old keys; the fit is recorded as made at the current review count so the automatic refit doesn't fire at once.
- **Backup and sync.** `BACKUP_SCHEMA_VERSION` is 6 (`settings` list; older files read as no settings). `exportBackup` takes the rows after `images`; `readBackupSnapshot` returns them; `importBackup` merges them in the same transaction with `mergeSettings` (key by key, newer `updatedAt` wins; an exact tie picks the same row on both devices; idempotent), and `MergeStats.settingsUpdated` shows in the summary ("2 settings updated"). A device only sends rows it has set, so a fresh install never overwrites a tuned one. This is the one place a settings change on one device overwrites another's, by design.
- **Automatic re-fit.** `lib/fsrs/auto.ts` (`shouldAutoFit`, `autoFitStep`): an attempt is made once the log holds 300 reviews (`MIN_SCORED_REVIEWS`), then after `autoFitStep` more reviews: at least `AUTO_FIT_STEP = 200`, and 10% of the log as it was at the last attempt (`AUTO_FIT_GROWTH`), so it refits often at first and rarely later (see "Two-year check"). `hooks/use-auto-fit.ts` (mounted in `App.tsx`) runs the same optimizer as the manual button, with the current weights as the baseline, and is paused during a study session and cancelled if a new review, a synced fit or a session start comes in. It saves `fit` with the review count even when nothing improved or the history is still too thin, so it isn't retried on every launch, and a synced device sees the fit is current and skips it. The manual Optimize and Reset buttons record the count the same way. A "Re-fit automatically" checkbox (setting `autoFit`, default on) sits in Settings > Scheduling.
- **Verified.** Unit tests, and in the browser (dev server): the localStorage migration, a backup round trip (version 6, the newer retention and an absent leech setting taken, a second import writes 0 settings), typing in the leech threshold box. **Not verified:** the automatic fit actually firing in the app (it needs 300+ real reviews; the rule is unit-tested and the optimizer is the one already verified), two real devices syncing settings, and two devices fitting at once (the newer write wins, and both then see the count as current).
- **Not built:** per-deck retention (the setting is one value for every deck), and an indicator of when the last fit ran.

### Leeches (after v0.3.0)

A question you keep forgetting is often badly worded or has a bad distractor, so Glyph marks it like Anki does. There is no cap of any kind: nothing here limits reviews, learning or new cards.

- **Rule.** `lib/leech.ts` (pure, 11 tests in `leech.test.ts`): a review that lapses a card up to the threshold (`isLeechLapse`: the count rose, reached the threshold, and sits on it or a whole number of half thresholds above, i.e. 8, 12, 16 for 8) makes it a leech. Settings > Leeches: "Lapses before a leech" (0 to 99, default 8, 0 = off) and the action, **Tag only** (default) or **Tag and suspend**. Both are synced settings. Either way the note gets the tag `leech` (`LEECH_TAG`); a note already at the 30-tag limit just isn't tagged.
- **Write.** `applyReview` takes a trailing `leech` rule and, in the same transaction as the review, adds the tag (bumping the note's `contentUpdatedAt`, so it merges like any tag edit) and, for suspend, sets `suspended` and `markedAt`. It returns a `LeechOutcome`. `undoReview` takes the outcome and takes both back (the suspend, and the tag if this review added it).
- **Study session.** A notice says what happened ("Leech: forgotten 8 times. Tagged "leech". Check its wording."). A card the rule suspended is not re-queued, stays on screen until Next after a wrong pick, and Z undoes the review and the suspend. `UndoEntry.leech` carries the outcome.
- **Browse.** A **Leeches** filter chip with a count: the questions that carry the `leech` tag (the tag is the status, so removing it in the editor clears it, and the tag can also be added by hand). It is not "lapses >= threshold", so lowering the threshold doesn't relabel old cards (Anki behaves the same), and the card's own Lapses column and sort are still there. The existing `#leech` tag row on the dashboard starts a study session over leeches.
- **Verified.** Unit tests, and in the browser: a card at 7 lapses rated Again became a leech (note tagged, card suspended), Undo restored lapses, the tag and the suspend, a second leech tagged only, and the Leeches chip showed it. **Not exercised:** a leech reached through the real study screen (notice, no re-queue, Z), tag-only at the 30-tag limit, and the phone layout.
- **Not built:** a leech count on the dashboard, a per-deck threshold, and scanning old cards for ones already past the threshold.

### Two-year check on 1000 questions (after v0.3.0)

`sample-data/lorem-1000.json` is 1000 fake lorem-ipsum questions (all made up, for load tests). Two runs use it:

- **`src/sim/two-year.test.ts`** (in `npm test`, about 20 s): the pure scheduler/queue run of `src/sim/` for 730 days on 1000 cards, six learners (diligent, skips 15% of days with two breaks and lazy rating, a 120-day absence, weak memory, no new-card limit, two sessions a day) plus one automatic refit on the resulting log. `Scenario` gained `newPerDay` (the study options "Max new cards"), `vacations` (several breaks) and `startMs`. Per-review invariants hold (0 violations), every number stays finite, all 1000 cards graduate, log ids are unique.
- **`src/sim/browser-run.ts`** (browser only, run by hand from the console of a throwaway origin; it clears every table): replays the same reviews through the real `applyReview` into IndexedDB, measures queries and backups every 91 days, compares the stored cards with the simulation's rows, then clears the database and restores it from its own backup file. Last run: 21,838 reviews written, 0 card mismatches, restore gave identical cards, 22 notes auto-tagged `leech`, write latency about 1.5 ms and flat, dashboard 130-230 ms, browse list load 70-110 ms, backup 7 MB (serialize 18 ms, snapshot 0.3 s), a no-op re-import writes 0 rows (0.3 s), IndexedDB about 25 MB. The Browse page listed all 1000 questions with the right filter counts (Review 1000, Due 2, Leeches 22).
- **What it shows.** Workload for 1000 cards, 30 new a day: about 170 answers a day in month 1, 65 in month 3, 20 in month 8, about 6 a day in year 2; about 21 answers per card in two years. A 120-day absence costs one day of about 1,200 answers, then it is normal again within two months (there is no cap, by rule). The default weights over-review a learner whose memory is stronger than FSRS assumes (recall in year 2 reads 90%+ against the 85% target); the refit improved log loss 0.464 to 0.407 on the 22k-review log and took 12 s.
- **Closed loop** (`src/sim/closed-loop.test.ts`, only runs with `SIM_CLOSED_LOOP=1`, about 15 min per learner; `simulateAdaptive` in `simulate.ts` runs the app's own refit rule between days and schedules with the weights it adopts). Four learners, 2 seeds each against 5 seeds on default weights. Year-2 recall (target 85% truly remembered): default weights 93-94% (over-reviewing), refit 89-92%; year-2 answers fall about 40-45% (average learner 2,942 to 1,576), lapses per card about halve, median interval 274 d to 518 d. With a flat 200-review step only 4-11 of about 110 attempts were adopted and nearly all the gain came in the first 2-3 months; the rest cost 6-10 minutes of optimizer time per run for nothing. So the step now grows with the log (`autoFitStep`: at least 200, and 10% of the log at the last attempt). Re-run on the same four learners: the same fits were adopted (4-8), year-2 answers and recall within noise of before (average 1,548 vs 1,576 answers, 90.7% vs 88.6% recall; strong 1,690 vs 1,696; weak 1,793 vs 1,726; lazy 2,178 vs 2,108), and optimizer time fell about 3.5-4x (average 457 s to 124 s). After a weight change a few cards get a shorter interval on a pass (0-20 in 20k reviews); expected. The learner is not an FSRS learner, so this shows the loop is stable and helps, not how much it helps a person.
- **Not covered:** a real learner, a 5000+ question deck, a phone's IndexedDB limits, the sync transfer of a 7 MB backup between two real devices, and the app staying open across midnight.

### Big deck check: 50,000 questions at about 1,000 answers a day (after v0.3.0)

For a heavy learner (50,000 questions in several decks, 10-15 s each, about 1,000 answers or 3.3 hours a day). `src/sim/big-deck.test.ts` (only with `SIM_BIG=1`, about 2 minutes per case, 8 GB heap) runs the pure scheduler for 730 days on 50,000 cards with the learner stopping at 1,000 answers a day (`maxAnswersPerDay`, the learner's own time limit; the app has none) and either a fixed new-card limit or `fillWithNew` (the day's new limit = what is left of the budget after the due reviews, which the study options page lets you set by hand). `src/sim/refit-driver.ts` is the shared automatic-refit driver (also used by `closed-loop.test.ts`). `browser-run.ts` can now generate N questions over several topics (`questions`, `topics`, `skipRestore`).

- **Workload.** A fixed 100 new a day makes the due backlog grow for 2 years (600 to 2,200 due at the start of the day); 200 a day is worse (1,400 to 3,900). Setting the day's new limit to what the budget leaves keeps the backlog flat at about 700-800 and the day at about 1,000 answers. Without the refit (default weights) that learns about 36,500 of the 50,000 cards in 2 years and recall sits at 74-83%; with the automatic refit it learns about 44,000 and recall sits at 86-89% (target 85%). The refit is attempted about 50 times in 2 years (9 adopted), 16 minutes of optimizer time in all, slowest attempt 58 s at 660,000 reviews. A weaker memory learns fewer cards (29,500 without refit). Finishing all 50,000 takes about 2.5-3 years at this budget; the upkeep afterwards is about 350 answers a day (about 70 minutes).
- **Real database at 50,000 notes, first 120 days (116k reviews).** Import 56 s (once), a review write 1.7 ms (flat), dashboard load 2 s, starting a session over the whole 50,000 (loadStudyCards) 4.7 s, Browse all 5 s, none growing with the log. Full restore from a backup 24 s with identical cards, no-op re-import 3.7 s (0 writes), refit on 116k reviews 37 s, IndexedDB 221 MB (about 1.1 KB per review, so about 0.8 GB at 2 years).
- **The limit that broke first: backup and sync size (fixed).** A backup is about 40 MB for 50,000 questions plus about 0.28 MB per 1,000 reviews (72.5 MB at 120 days). `MAX_BACKUP_BYTES` was 100 MB: Import refused a bigger file and the sync `Reassembler` refused a bigger transfer, but Export had no check, so after about 210,000 reviews (about 7 months at this pace) Export still succeeded and wrote a file Import would not accept. **The cap is removed** (a backup grows with every review and must always restore and sync, and the project has no caps). What remains is the browser's own ceiling: a JSON string of about 512 MB-1 GB, i.e. roughly 4-5 years at 1,000 reviews a day on 50,000 questions (about 230 MB at 2 years). Past that, Export or Import fails with "This device ran out of memory handling the backup." (a `RangeError` is caught) and the sync receiver reports that it cannot allocate the buffer; the next step would be compressing or splitting the file, not built. `Reassembler.begin` no longer takes a limit.
- **Retest after removing the caps.** Real database, 50,000 notes in 10 decks, 260 days at the 1,000-a-day pace (222,573 reviews): the backup was 102.2 MB, over the old limit. Serializing took 0.2 s, parsing 0.4 s, a full restore into an emptied database 30 s with identical cards (0 mismatches, 322 notes auto-tagged `leech`), a re-import wrote 0 rows, the same bytes went through the sync chunker and `Reassembler` unchanged (1.1 s) and through a Blob read back; a review write stayed at 1.4 ms median, IndexedDB was 338 MB. Not exercised in the browser UI: the actual file download and file picker, and a live WebRTC transfer of that size.
- **Caution when testing.** A second app tab open on the same database (Browse or the dashboard mounted) re-runs its live queries after every write; with 50,000 notes that made the replay 500x slower. During a study session only the current card is a live query, so studying is not affected.

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
- **Backup parsing is strict:** every row of every table is validated and copied field-by-field (unknown fields are dropped); one bad row rejects the file with its table and index. There is no size cap (it was 100 MB until the big deck check).
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

### Reliability plan: backup, import and sync (planned, 2026-11-23)

R0-R6 are built (see "Reliability R1-R2 notes" and "Reliability R3-R6 notes" below); R7 is not. The plan comes from a read-through of `src/lib/backup/`, `src/lib/sync/`, `src/db/backup-parts.ts`, `use-backup-controls.tsx` and `use-peer-sync.ts`; the findings were read from the code, not reproduced (Phase R0 reproduces them first). The bulk JSON importer was not reviewed in depth. Phases are named R0-R7 so they do not clash with the build phases above.

**Findings**

- **Sync (1): delta uses change time, not receipt time.** A row merged from device B keeps its old `updatedAt`. If A later syncs with C and C's mark is more than 2 days newer than that stamp, the row is not sent. The end-of-sync check only compares row counts (decks, notes, cards, reviews), so an update to an existing row (note edit, flag, deck rename, setting) passes unnoticed and C stays stale. Needs a third device, a device offline more than 2 days, or a backup file restored before syncing.
- **Sync (2): images and settings are not verified.** A delta sends images only for changed notes, so a device missing the picture of an unchanged note never gets it.
- **Sync (3): no stall handling.** After connecting there is no idle timeout or wake lock; a sleeping phone leaves the other device on "syncing" forever. Studying during a sync can skew the counts.
- **Sync (4): connection.** No ICE servers, so browsers that hide local addresses behind mDNS `.local` names can fail on some Android, hotspot and VPN networks; the only message is the generic timeout one.
- **Sync (5): smaller.** Two devices reviewing the same card offline keep both reviews in the log but only the later one's card state; an undo can be resurrected by the next sync.
- **Backup (1): not streaming.** Export builds one JSON string from every table; import does `file.text()` + `JSON.parse` + one transaction. At the project's own two-year estimate this fails with "ran out of memory". Sync already streams in parts; the file path does not.
- **Backup (2): no safety net.** No last-backup date, reminder or auto-backup; IndexedDB is the only copy, and persistent storage is only requested (iOS may still evict it). Blob downloads are unreliable in an iOS home-screen app.
- **Backup (3): no integrity check** beyond valid JSON (no checksum or counts in the file).
- **Import (4): blind.** The merge starts as soon as a file is picked: no preview, no pre-import snapshot, no undo; a file from a wrong-clock device can overwrite newer edits.
- **Import (5): all or nothing.** One bad row rejects the whole file, with no way to recover the rest.

**Phases.** Every phase ends with `npm run typecheck`, `lint`, `test` and `build` clean, this file updated, and one commit.

| Phase | Scope | Tests | State |
|---|---|---|---|
| R0 | Baseline and failing tests. Get the working tree green and committed first (about 20 files of FSRS and backup work were uncommitted when this plan was written). Make the fake devices in `sync-session.test.ts` carry change stamps and filter deltas like `readBackupParts`. | Three tests that fail for the stated reason: the three-device stale edit (laptop offline 3 days, laptop to phone to tablet); restore a backup file then sync; an unchanged note whose image never arrives. | **Done** (2026-11-23): the three tests were written with R1; the tree was green and committed together with R1-R2 |
| R1 | Content digest. Pure `RowDigest` (count plus order-independent hash of id + change stamp) in `lib/sync/delta.ts`; `computeDigest` in `backup-parts.ts`; the `ok` message carries digests; `SYNC_VERSION` 3; digest also covers settings and the images live notes reference. A mismatch triggers the existing full repeat round; one still different after a full round fails and names the table. | Digest ignores row order and changes when one stamp changes; the R0 tests now pass; two-tab browser run on 5,000 notes; timing on 50,000 notes (the digest must stay cheap); a deliberately corrupted row is caught and healed. | **Done** (2026-11-23) |
| R2 | Liveness. No-progress watchdog in `SyncSession` (injected timer, about 30 s); `navigator.wakeLock` while syncing; study screen locked during a sync. | Fake-timer unit tests: a stalled peer fails, steady progress never trips it, a slow large sync passes. Manual: sleep one device mid-sync and see a clear error. | **Done** (2026-11-23) |
| R3 | Streaming, checksummed backup file. Header line, one part per line (from `readBackupParts(null)`), footer line with counts and digest, gzipped (`CompressionStream`). Streaming reader runs each part through `parseBackup` + `importBackup`; a format sniffer keeps old single-JSON files importing. A streamed import is not one transaction; it is safe to re-run because the merge is idempotent (small files may keep the single transaction). | Round trip gives the same digest as the old path; truncated file, flipped byte and missing footer are caught; v1-v6 fixtures still import; 50,000 questions and 116k reviews in the browser, peak memory and time against the 24 s restore baseline. | **Done** (2026-11-23) |
| R4 | Backup safety net. Last-export date in Settings > Data (per device, localStorage), a "due" reminder, optional auto-backup to a folder chosen with `showDirectoryPicker`, share-sheet fallback for iOS. | Pure `backupDue(lastAt, changes, now)` unit tests (including a clock change); manual on Chrome, and on a real iPhone if available. | **Done** (2026-11-23; folder auto-backup and the iOS share sheet were not run on those platforms) |
| R5 | Safer imports. Snapshot into the origin-private file system before every file import (keep the last 3) with an "undo import" button; a skip-bad-rows mode with a report; a preview from `mergeBackup` stats for small files. | Lenient parsing as a pure unit test; undo checked by digest (after undo equals before import); browser run: import, undo, import again. | **Done** (2026-11-23) |
| R6 | Connection diagnostics. Pure analysis of the candidates in the pairing code (all `.local`, no usable address), clearer errors, an off-by-default "use a public STUN server" switch (breaks the no-outside-calls rule, so it is opt-in and per device). | Unit tests on captured SDP samples; manual matrix: same wifi, phone hotspot, VPN. | **Done** (2026-11-23; real-network matrix not run) |
| R7 | Later, if wanted: rebuild a card from both devices' reviews when they reviewed it offline; stop an undo being resurrected by a sync; then decide on Capacitor or Tauri from real-device evidence (R4, R6). | - | Not started |

**Order.** R1 first: it is the highest value, and R5's undo test uses the digest as its oracle. R1-R2 touch only sync and R3-R5 only backup, so they could run in parallel, but the plan is to go in order.

**Open decisions.** Add `fake-indexeddb` as a dev dependency (reason: `importBackup`, `readBackupParts`, the digest, snapshots and `writeAutoBackup` are untestable in Vitest without it; they were checked in the browser instead)? Still open. Decided in R3: the new file extension is `.glyph` (`.jsonl` when the browser cannot gzip); old `.json` files still import. Which real devices R4 and R6 get tested on (Windows only, Android, iPhone) is still open: only desktop Chrome in the app's browser pane was used.

**Tauri desktop shell (2026-11-23).** Added a Tauri 2 shell in `src-tauri/` for Windows (first with Dexie and the PWA kept; both were replaced the same day, see "SQLite replaces Dexie"). `npm run tauri dev` / `npm run tauri build`. The Tauri build skips the service worker and manifest (see CLAUDE.md Gotchas). Verified: typecheck, lint, tests, `tauri build --no-bundle` succeed and the exe starts. Not verified: the installer bundle, backup download / folder picker / WebRTC sync inside WebView2, and data surviving an app update. The paragraph below predates this and is kept for the SQLite question.

**Why not Tauri now.** Tauri's webviews still use IndexedDB, so on-device storage would mean SQLite and a rewrite of the Dexie layer and `repo/`. It would fix browser storage eviction and give native files, but not the sync protocol gaps (R1, R2), import safety (R5) or card merging (R7); streaming (R3) can be done in the browser. Tauri's mobile support is newer than its desktop support; if a native shell is needed later, Capacitor (the same web app plus native SQLite and filesystem plugins) is the first thing to look at.

### SQLite replaces Dexie, PWA dropped (2026-11-23)

The data layer moved from IndexedDB (Dexie) to a SQLite file owned by the Tauri app, and the PWA build (service worker, manifest, Vercel deploy, `vite-plugin-pwa`) was removed. `dexie`, `dexie-react-hooks` and `vite-plugin-pwa` are uninstalled; `rusqlite` (bundled SQLite) and `@tauri-apps/api` are new (rule 8: the whole point of the change).

- **Bridge.** `src-tauri/src/sql.rs` exposes four commands over one connection (`sql_select`, `sql_execute`, `sql_execute_many`, `sql_script`); the file is `glyph.db` in the app data dir, WAL mode. Everything else is TypeScript: `src/db/schema.ts` (migrations by `PRAGMA user_version`), `sql.ts` (`Database`: serialized calls, `transaction`, live-query notifications), `tables.ts` (row mapping, `putRows`/`getRows`/`queryRows`, keyset paging, the `note_tags` index), `tauri-backend.ts`.
- **Live queries.** `useLiveQuery` is ours (`src/hooks/use-live-query.ts`): it re-runs when a committed write touches a table in the list the caller passes (Dexie tracked this by itself). A new live query must list its tables.
- **Schema.** Version 1 is the final Dexie shape (v7) as tables: tags as JSON plus `note_tags`, booleans as 0/1, `sl` and `options` as JSON, images as base64 text (`ImageRow.blob` became `data`), `deletedAt` NULL for live rows.
- **Data.** There is no automatic copy from the old IndexedDB: export a `.glyph` backup from the old app and import it. The old localStorage settings migration (`adoptLegacySettings`) is gone with it.
- **Tests.** The DB layer is now unit-tested (`src/db/db.test.ts`) on `node:sqlite`, the same SQL as the app: startup and seed, import, review and undo, marks surviving a review, tag edits and soft deletes, rollback, live-query notices, a full backup read merged into an empty database with equal digests, and a delta read. This also answers the old open question about `fake-indexeddb`: not needed.
- **Removed.** `src/sim/browser-run.ts` (a manual console harness against IndexedDB); the pure simulators and their tests stay. The sim could be rebuilt on `memoryBackend()` if a big-database timing run is wanted.
- **Verified.** typecheck, lint, 553 tests, `npm run build` clean; `tauri build --no-bundle` builds and, launched fresh, the exe created `glyph.db`, migrated it to `user_version` 1 and seeded 2 decks, 3 notes, 3 cards. **Not verified:** the screens in the running app (study, browse, import, backup export/import, sync, image paste) against SQLite; a large database (50,000 questions, years of reviews) for speed; the installer bundle.

### Reliability R1-R2 notes (built 2026-11-23)

R0's three failing tests were written as part of R1 (they live in `src/lib/sync-session.test.ts`, "a sync that must notice what the row counts cannot": laptop to phone to tablet, restored backup then sync, picture that never arrived). The fake devices there already carried change stamps and filtered deltas like `readBackupParts`; R0's other half (get the working tree green and committed) was done afterwards: the earlier FSRS and backup work and R1-R2 went into one commit. Sync (1), (2) and (3) from the findings above are fixed; (4) and (5) are not (R6, R7).

- **Digest (R1).** `lib/sync/delta.ts`: `RowDigest { count, hash }` (16 hex digits: two 32-bit hashes of each stamp, added mod 2^32, so the order of rows does not matter and nothing is kept per row), `DigestBuilder`, `digestOf`, `SyncDigests` (decks, notes, cards, reviews, settings, images), `differingTables`, `parseDigests`, `DIGEST_LABELS`. The stamps are what the merge decides by: deck `id|updatedAt|deletedAt`, note `id|contentUpdatedAt|deletedAt`, card `id|lastReview|updatedAt|markedAt`, setting `key|updatedAt`, review and image the id (content is not hashed: a row with an equal stamp and other content cannot be fixed by resending, the merge keeps the local copy, so a mismatch always means resending can help). `images` covers the pictures that live notes use and this device holds, so a missing picture shows as a difference and the full repeat round sends it.
- **Wiring.** `computeDigests()` in `db/backup-parts.ts` replaces `countRows` (a read transaction over all six tables; notes, cards and settings by cursor, reviews by key only). `SyncDeps.counts` became `digests`; the `ok` message carries `digests`; `SYNC_VERSION` is 3 (a v2 device gets the "different version" message). A mismatch in round 1 with a delta involved repeats in full once; a mismatch after a full round fails with "still differ in <tables> after a full sync" and sets no mark.
- **Cost.** On the 50,003 question / 670,389 review database from the two-year run (dev server, not minified): `computeDigests` 6.2 s (notes 1.6 s, cards 1.3 s, review keys 2.2 s, hashing all of it 0.2 s; the reads dominate). It runs once per round on each device, so about 6 s on top of a delta sync at that size, nothing on a normal deck. Not optimized further (key-only index reads could cut notes and cards).
- **Browser check.** Two origins (the dev server on 5174 holding that database, the production build on 4173 empty), paired by hand through the UI: a first full sync of 50,003 questions and 670,389 reviews completed (about 3 minutes, 106 parts) and both ended with identical digests in every table (the second origin's digests were recomputed by separate raw-IndexedDB code, not `computeDigests`). Changing one note's stamp by 1 changed that table's digest and nothing else, and restoring it restored the digest. Not run in a browser: the heal of a corrupted row end to end (it is covered with fake devices), and a delta sync at that size.
- **Liveness (R2).** Both devices send `ping` every `STALL_MS / 6` (5 s) and count ticks without any message from the other; at 6 (`STALL_MS` = 30 s) the sync fails with "The other device has not answered for 30 seconds. It may have gone to sleep, lost the wifi or closed Glyph...". Anything received resets the count and a device busy merging or fingerprinting keeps pinging, so a slow large sync does not trip it; only a dead or frozen peer does. The timer is `deps.every` (default `setInterval`, injected in tests) and `deps.stallMs` (0 turns it off). Tests: fake ticks (gives up after six silent ticks, 200 rounds of pings never trip, the timer is cleared on stop and on failure), and two real sessions where one waits 150 ms on its digests with a 60 ms limit and still finishes, and where a silent peer makes the waiting one fail.
- **Screen and tabs.** `lib/sync/keep-running.ts` (browser only): `keepSyncRunning()` asks `navigator.wakeLock` for the screen (asked again when the tab becomes visible, since the browser drops it when hidden) and holds the Web Lock `glyph-sync`; `use-peer-sync.ts` takes both from the moment the connection opens and gives them back when the sync ends, fails or the page closes. `useSyncRunning()` polls `navigator.locks.query()` every 1.5 s; `App.tsx` uses it so that, while a sync runs in another tab of the app, the study options page cannot start ("Sync running..."), a session already open is inert with its keyboard shortcuts off, and a notice says why. In one tab this was already impossible (the sync page has no way to leave mid-sync). Verified: the lock is held and visible during a real sync. The study-screen lock itself was not exercised in a second tab.
- **Not covered.** `computeDigests` has no Vitest test (no `fake-indexeddb`, still an open decision); it was checked in the browser as above. A wake lock is best effort (iOS home-screen apps, battery saver).

### Reliability R3-R6 notes (built 2026-11-23)

Fixes findings Backup (1)-(3), Import (4)-(5) and Sync (4). 540 tests pass (9 skipped, as before); typecheck, lint and build clean.

- **Backup file (R3).** `lib/backup/stream.ts` (pure; web streams only), `crc32.ts`. The file is text, one JSON value per line, gzipped when `CompressionStream` exists, extension `.glyph`: a header line (`format: "glyph-stream"`, `streamVersion`, `schemaVersion`, `exportedAt`), then every part as an ordinary `BackupFile` (the same parts as sync, from `readBackupParts(null)`, so a part goes through `parseBackup` and `importBackup` unchanged), then a footer with the number of parts, the rows per table and the CRC-32 of every byte before it. `backupFileStream` / `backupFileBlob` write it a part at a time; `readBackupFile(blob, onPart?, { lenient })` reads it and checks the footer; a first-bytes sniff keeps old single-JSON files importing (read whole, as before). `db/backup-file.ts` (`makeBackupFile`) writes the file and **reads it back and checks it before it is offered**, so a bad file is caught at export, not on the day it is needed. Cut-short, flipped-byte, lost-part, wrong-count, trailing-data, truncated-gzip and newer-version files are each refused with their own message (tests in `backup-stream.test.ts`).
- **Import is two passes.** Pass 1 reads the whole file read-only (checksum, counts, every row through `parseBackup`), so nothing is written for a damaged file; pass 2 merges. `db/import-file.ts` (`importBackupFile`) regroups parts into batches of up to 30,000 rows (`PartBatcher`, pure) so a big file is a few dozen transactions, not one per part. A streamed import is not one transaction; the merge is idempotent, so a stopped import can be run again. `RangeError` handling stays for old single-JSON files.
- **Measured (R3).** 50,003 questions and 670,389 reviews (the two-year database, dev server, unminified): export plus read-back check 18.5 s, 50.5 MB file (gzip), heap about 180 MB; check pass 2.9 s; restore into an emptied database 127-135 s with identical digests in every table afterwards (`computeDigests` before and after). The 24 s baseline in the plan was for about 116k reviews; the time is dominated by IndexedDB writes (30,000 review rows take 3.7 s to `bulkPut` here), so it scales with the log, and batching made no difference. Per-part commits with a dashboard mounted were slower (190 s: every commit re-runs the dashboard's live query); an import from Settings does not mount it.
- **Safety net (R4).** `lib/backup/reminder.ts` (pure, tested): `backupDue(lastAt, changes, now)` (a week old and anything changed, or a day old and 500 changes, or no backup yet and 10 changes; a last-backup time in the future is treated as "never"), `autoBackupDue` (once per local day when something changed), `describeBackupAge`, `autoBackupName`, `autoBackupsToDelete` (only `glyph-auto-*` files, keeps 7), `preferShareSheet`. The last backup time is per device in localStorage (`glyph.lastBackupAt`, `hooks/use-backup-status.ts`), changes are counted by index (`countChangesSince` in `db/queries.ts`). The dashboard shows a reminder with an Export button when a backup is due; Settings > Data shows "Last backup: yesterday. 120 reviews and edits since." **Automatic backup to a folder** (`db/backup-folder.ts`, `hooks/use-auto-backup.ts`; Chrome and Edge on a computer, where `showDirectoryPicker` exists): the folder handle lives in its own small IndexedDB database (`glyph-local`), not in the Glyph one; at most once a local day, only when something changed, never while studying or syncing, 7 newest files kept; after a browser restart the permission needs a click, shown as "Allow". On an iPhone or iPad the export goes through the share sheet (`navigator.share` with the file); if the tap is too old after a long export the file waits behind a "Share backup file" row. Elsewhere it is a download.
- **Imports you can undo (R5).** `db/snapshots.ts` (browser only): before every file import a full copy is saved into the origin-private file system (`import-snapshots/`, the 3 newest kept, `lib/backup/snapshots.ts` names them) with the digest of every table; Settings > Data > "Undo an import" lists them with **Put back** (replaces everything with the copy after a confirmation page, saves the current data as a new copy first so the undo can be undone, then compares digests and reports "Checked: it matches the copy exactly") and Delete. A browser without writable private storage imports without a copy and says so; a failed copy stops the import. A file of at most 20,000 rows is **previewed** first (`db/backup-local.ts` `previewBackup`: the real merge planner, read-only, over the whole file in one piece) on a confirm page ("Merged: +2 notes."), or reported as "Nothing new to merge". A file that is whole but has invalid rows (`BackupRowsError`) offers "Import the valid rows" (`parseBackupLenient`, `readBackupFile(..., { lenient: true })`); the notice lists what was left out ("notes[1] in part 2"). `importBackup` and the preview share `planMerge`.
- **Connection diagnostics (R6).** `lib/sync/diagnose.ts` (pure, 33 tests): reads `a=candidate:` lines, classifies addresses (`.local` names, private, CGNAT, link-local, loopback, IPv6, public), `codeWarning` (shown under a code that cannot work: no address, or only unreachable ones), `comparePeers` (same /24 likely; different private networks unlikely, with both prefixes; hidden names unknown) and `connectFailureMessage`, which puts the specific cause before the usual advice and lists what each device found. `rtc.ts` returns both session descriptions; `use-peer-sync.ts` keeps the analyses per attempt. An off-by-default, per-device checkbox on the sync page ("Use a public STUN server", localStorage `glyph.syncStun`, `PUBLIC_STUN_URL` = Cloudflare) adds one STUN server to the connection; it is the only outside call in the app and the page says what it tells that server (this device's public address, never data). A real Chrome offer code carries one candidate, a `.local` name, so "hidden address" is the common case.
- **Verified in the browser (dev server).** Export and import through the UI on a small database (notice, preview page, import, snapshot listed, put back with the digest check, bad-row file, flipped-byte file, cut file, old single-JSON file, dashboard reminder after a stale last-backup time); `writeAutoBackup` against an origin-private folder holding 8 old backups and two foreign files (7 kept, foreign files untouched); the failure message after a forged answer code (it timed out into "Could not connect" with the per-device lines); the 50k-question database as above.
- **Not covered.** `showDirectoryPicker` itself and the permission prompt (it needs a native dialog), the iOS share sheet and Home Screen behaviour, Safari's missing `createWritable` (so no snapshots there), a real two-network matrix for R6, and an import of the 50k file through the UI (the same functions were driven from the console). `db/snapshots.ts`, `backup-folder.ts` and `import-file.ts` have no Vitest test (no `fake-indexeddb`).

### Next steps

0. Reliability plan above: R0-R6 are done; R7 (rebuild a card from both devices' offline reviews, stop an undo resurrecting through a sync, then Capacitor or Tauri from real-device evidence) is only to be done if wanted. Try the backup reminder, the iOS share sheet and the folder backup on a real phone and a real second computer first.
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
