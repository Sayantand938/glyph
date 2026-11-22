/**
 * Synchronous 53-bit string hash (cyrb53). Not cryptographic; used for
 * deterministic note ids and to seed the shuffle PRNG.
 */
export function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// Zero-width space/non-joiner/joiner, word joiner, BOM.
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g

/** Unicode NFC, zero-width characters stripped, lowercased, whitespace collapsed and trimmed. */
export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Deterministic note id. Assigned once at note creation and NEVER recomputed
 * on edit: editing a question's text keeps its id, so re-importing the
 * original wording later creates a new note (documented limitation).
 */
export function noteId(topicId: string, question: string): string {
  const key = `${topicId}\u0000${normalizeQuestion(question)}`
  return `n_${cyrb53(key).toString(36)}`
}
