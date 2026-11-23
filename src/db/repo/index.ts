/**
 * All writes go through here, each in a single Dexie transaction. Components
 * import from "@/db/repo"; the per-area files are an internal detail.
 */
export { createDeck, renameDeck, softDeleteDeck } from "./decks"
export { importBackup } from "./import-backup"
export { commitImport, type ImportTarget } from "./import-notes"
export { saveNote } from "./notes"
export { applyReview, undoReview } from "./reviews"
