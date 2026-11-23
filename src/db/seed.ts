import type { GlyphDB } from "./database"
import { emptyCardRow } from "./scheduler"
import type { Deck, Note } from "./types"

// Fixed ids so two devices that both seed merge into one sample deck
// instead of duplicating it when backups are combined.
const SUBJECT_ID = "d_seed_subject"
const TOPIC_ID = "d_seed_topic"

type SeedQuestion = Pick<
  Note,
  "question" | "options" | "correctIndex" | "extra" | "tags"
>

const QUESTIONS: SeedQuestion[] = [
  {
    question: "Which planet in our solar system is the largest?",
    options: ["Earth", "Jupiter", "Saturn", "Neptune"],
    correctIndex: 1,
    extra:
      "Jupiter's mass is more than twice that of all other planets combined.",
    tags: ["astronomy"],
  },
  {
    question: "What is the chemical symbol for gold?",
    options: ["Ag", "Gd", "Au", "Go"],
    correctIndex: 2,
    extra: "Au comes from the Latin word for gold, aurum.",
    tags: ["chemistry"],
  },
  {
    question: "Which of these is the longest river in Africa?",
    options: ["Congo", "Niger", "Zambezi", "Nile"],
    correctIndex: 3,
    extra: "The Nile is roughly 6,650 km long.",
    tags: ["geography"],
  },
]

/** Seeds sample data only when there are no decks at all, in one transaction. */
export async function seedIfEmpty(
  db: GlyphDB,
  now = Date.now()
): Promise<boolean> {
  return db.transaction("rw", [db.decks, db.notes, db.cards], async () => {
    // Counted inside the transaction so concurrent callers (StrictMode, two tabs) can't both seed.
    if ((await db.decks.count()) > 0) return false

    const decks: Deck[] = [
      {
        id: SUBJECT_ID,
        parentId: null,
        name: "Sample Subject",
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: TOPIC_ID,
        parentId: SUBJECT_ID,
        name: "General Knowledge",
        updatedAt: now,
        deletedAt: null,
      },
    ]
    const notes: Note[] = QUESTIONS.map((q, i) => ({
      id: `n_seed_${i + 1}`,
      topicId: TOPIC_ID,
      sl: i + 1,
      ...q,
      contentUpdatedAt: now,
      deletedAt: null,
    }))

    await db.decks.bulkAdd(decks)
    await db.notes.bulkAdd(notes)
    await db.cards.bulkAdd(notes.map((note) => emptyCardRow(note, now)))
    return true
  })
}
