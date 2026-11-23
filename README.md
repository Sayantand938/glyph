# Glyph

Offline-first, Anki-style MCQ spaced-repetition PWA. Vite + React + TypeScript, Dexie (IndexedDB), FSRS via `ts-fsrs`.

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build && npm run preview

npm run tauri dev     # desktop app (needs Rust and WebView2)
npm run tauri build   # installer in src-tauri/target/release/bundle
```

See [STATUS.md](STATUS.md) for the plan and progress, and [CLAUDE.md](CLAUDE.md) for contributor rules.
