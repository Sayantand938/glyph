import type { Deck } from "@/db/types"
import { normalizeQuestion } from "@/lib/hash"

import type { DeckRef } from "./types"

/** Case-, whitespace- and Unicode-insensitive deck name key. */
export function deckNameKey(name: string): string {
  return normalizeQuestion(name)
}

/**
 * Picks the target deck. A typed name wins over the dropdown selection and
 * reuses a live deck with the same name (case-insensitive, trimmed).
 * `candidates` are the live decks at this level (Subjects, or the chosen
 * Subject's Topics); soft-deleted decks are ignored. Returns null when
 * nothing is chosen.
 */
export function resolveDeckRef(
  candidates: readonly Deck[],
  selectedId: string,
  typedName: string
): DeckRef | null {
  const live = candidates.filter((deck) => deck.deletedAt === null)

  const name = typedName.trim()
  if (name) {
    const key = deckNameKey(name)
    const match = live.find((deck) => deckNameKey(deck.name) === key)
    return match ? { kind: "existing", id: match.id } : { kind: "new", name }
  }

  const selected = live.find((deck) => deck.id === selectedId)
  return selected ? { kind: "existing", id: selected.id } : null
}
