export type OptionIndex = 0 | 1 | 2 | 3

const INDEXES: readonly OptionIndex[] = [0, 1, 2, 3]

/**
 * Resolves an import row's `answer` to a 0-3 option index, or null if invalid.
 *
 * After trimming, tried in order:
 *   1. `op1`..`op4` (case-insensitive)
 *   2. `1`..`4`
 *   3. `a`..`d` (case-insensitive)
 *   4. case-insensitive trimmed equality with an option (first match wins)
 */
export function normalizeAnswer(
  answer: unknown,
  options: readonly string[]
): OptionIndex | null {
  if (answer === null || answer === undefined) return null
  const text = String(answer).trim()
  if (text === "") return null

  const op = /^op([1-4])$/i.exec(text)
  if (op) return INDEXES[Number(op[1]) - 1]

  if (/^[1-4]$/.test(text)) return INDEXES[Number(text) - 1]

  if (/^[a-d]$/i.test(text))
    return INDEXES[text.toLowerCase().charCodeAt(0) - 97]

  const wanted = text.toLowerCase()
  const index = options
    .slice(0, INDEXES.length)
    .findIndex((option) => option.trim().toLowerCase() === wanted)
  return index === -1 ? null : INDEXES[index]
}
