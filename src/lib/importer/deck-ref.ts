import { normalizeQuestion } from "@/lib/hash"

/** Case-, whitespace- and Unicode-insensitive deck name key. */
export function deckNameKey(name: string): string {
  return normalizeQuestion(name)
}
