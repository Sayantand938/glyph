import { emptyCardRow } from "./scheduler"
import type { SqlRunner } from "./sql"
import { CARDS, DECKS, addNotes, addRows, countRows } from "./tables"
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

/**
 * Seeds sample data only when there are no decks at all. Call it inside a
 * transaction so two callers can't both seed.
 */
export async function seedIfEmpty(
  tx: SqlRunner,
  now = Date.now()
): Promise<boolean> {
  if ((await countRows(tx, DECKS)) > 0) return false

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

  await addRows(tx, DECKS, decks)
  await addNotes(tx, notes)
  await addRows(
    tx,
    CARDS,
    notes.map((note) => emptyCardRow(note, now))
  )
  return true
}
