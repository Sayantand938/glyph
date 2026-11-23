/**
 * Splits note text into plain-text and LaTeX segments. Pure: no KaTeX, DOM or
 * React here, so the delimiter rules are unit-tested on their own.
 *
 * Supported delimiters (all four are always on; `$...$` is the documented one):
 *   $...$     inline  (default)
 *   $$...$$   display
 *   \(...\)   inline
 *   \[...\]   display
 *
 * `$` is also a currency sign, so the inline `$...$` form follows the Pandoc
 * rules: the opening `$` must be followed by a non-space, the closing `$` must
 * follow a non-space and must not be followed by a digit. "costs $5 or $10"
 * therefore stays plain text. `\$` is a literal dollar sign outside math.
 * Anything that does not close, or is empty, is left as plain text.
 */
export type Segment =
  | { kind: "text"; text: string }
  | {
      kind: "math"
      /** The TeX between the delimiters, untrimmed. */
      tex: string
      display: boolean
      /** The original text including delimiters, shown if rendering fails. */
      raw: string
    }

const isSpace = (ch: string | undefined): boolean =>
  ch !== undefined && /\s/.test(ch)

const isDigit = (ch: string | undefined): boolean =>
  ch !== undefined && ch >= "0" && ch <= "9"

/** Index of the next unescaped `needle` at or after `from`, or -1. */
function findClose(text: string, needle: string, from: number): number {
  let i = from
  while (i < text.length) {
    if (text[i] === "\\" && !text.startsWith(needle, i)) {
      i += 2
      continue
    }
    if (text.startsWith(needle, i)) return i
    i += 1
  }
  return -1
}

/** Index of the closing `$` for an inline `$...$` opened before `from`, or -1. */
function findInlineDollarClose(text: string, from: number): number {
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "$") {
      const valid =
        i > from && !isSpace(text[i - 1]) && !isDigit(text[i + 1])
      return valid ? i : -1
    }
    i += 1
  }
  return -1
}

/** A blank line ends a paragraph, so math cannot span one. */
const spansBlankLine = (tex: string): boolean => /\n[ \t]*\n/.test(tex)

export function splitMath(text: string): Segment[] {
  if (!text.includes("$") && !text.includes("\\")) {
    return text === "" ? [] : [{ kind: "text", text }]
  }

  const out: Segment[] = []
  let buf = ""

  const flush = () => {
    if (buf !== "") out.push({ kind: "text", text: buf })
    buf = ""
  }

  /** Tries a math span whose TeX starts at `texStart` and ends at `close`. */
  const take = (
    start: number,
    texStart: number,
    close: number,
    closeLen: number,
    display: boolean
  ): number | null => {
    if (close < 0) return null
    const tex = text.slice(texStart, close)
    if (tex.trim() === "" || spansBlankLine(tex)) return null
    const end = close + closeLen
    flush()
    out.push({ kind: "math", tex, display, raw: text.slice(start, end) })
    return end
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    let next: number | null = null

    if (ch === "\\") {
      const n = text[i + 1]
      if (n === "$") {
        buf += "$"
        i += 2
        continue
      }
      if (n === "\\") {
        // An escaped backslash: keep it, so `\$x$` is a backslash then math.
        buf += "\\\\"
        i += 2
        continue
      }
      if (n === "(") {
        next = take(i, i + 2, findClose(text, "\\)", i + 2), 2, false)
      } else if (n === "[") {
        next = take(i, i + 2, findClose(text, "\\]", i + 2), 2, true)
      }
    } else if (ch === "$") {
      if (text[i + 1] === "$") {
        next = take(i, i + 2, findClose(text, "$$", i + 2), 2, true)
        if (next === null) {
          // Unclosed or empty `$$`: keep both signs as text.
          buf += "$$"
          i += 2
          continue
        }
      } else if (i + 1 < text.length && !isSpace(text[i + 1])) {
        next = take(i, i + 1, findInlineDollarClose(text, i + 1), 1, false)
      }
    }

    if (next !== null) {
      i = next
    } else {
      buf += ch
      i += 1
    }
  }

  flush()
  return out
}
