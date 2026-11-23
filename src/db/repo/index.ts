/**
 * All writes go through here, each in a single SQL transaction. Components
 * import from "@/db/repo"; the per-area files are an internal detail.
 */
export {
  buryCard,
  restoreMarks,
  setFlag,
  setSuspended,
  unburyCard,
} from "./cards"
export { createDeck, renameDeck, softDeleteDeck } from "./decks"
export { clearAllData, importBackup } from "./import-backup"
export { addImage, pruneImages } from "./images"
export { commitImport, type ImportTarget } from "./import-notes"
export { deleteNote, saveNote } from "./notes"
export { applyReview, undoReview, type LeechOutcome } from "./reviews"
export { saveSetting } from "./settings"
