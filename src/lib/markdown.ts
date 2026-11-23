import { splitMath } from "./math"

/**
 * A small, safe Markdown subset for note text. Pure: no React or DOM. The
 * output is a tree of plain data that the renderer turns into React elements,
 * so no HTML string is ever built (CLAUDE.md rule 10).
 *
 * Blocks:  fenced code (``` ... ```), # headings, - / * / + bullets,
 *          1. numbered items, > quotes, paragraphs (single newlines kept).
 * Inline:  **bold**, *italic*, _italic_, ~~strike~~, `code`.
 * Not supported on purpose: links, images, tables, nested lists, raw HTML.
 *
 * Math is untouched: `$...$` etc. is cut out first with `splitMath` and put
 * back afterwards, so `**the value $x_1$**` works and `*` or `_` inside TeX is
 * never read as emphasis. Code spans and fences are cut out before math, so a
 * `$` inside code stays a literal dollar sign.
 *
 * Text that uses none of this parses to a single paragraph with a single text
 * node, which the renderer shows exactly as before.
 */
export type MathNode = {
  kind: "math"
  tex: string
  display: boolean
  raw: string
}

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: Inline[] }
  | { kind: "code"; text: string }
  | MathNode

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }

const isSpace = (ch: string | undefined): boolean =>
  ch !== undefined && /\s/.test(ch)

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch)

// ---------------------------------------------------------------------------
// Inline

/** Private-use code points stand in for atoms (code, math) during emphasis parsing. */
const ATOM_BASE = 0xe000
/** Matches the whole private-use block that atoms are drawn from. */
const ATOM_RANGE = new RegExp(
  "[" + String.fromCharCode(0xe000) + "-" + String.fromCharCode(0xefff) + "]",
  "g"
)
const atomChar = (i: number): string => String.fromCharCode(ATOM_BASE + i)
const atomIndex = (ch: string): number => {
  const code = ch.charCodeAt(0) - ATOM_BASE
  return code >= 0 && code < 0x1000 ? code : -1
}

/** Index of the closing `**`/`__`/`~~` for an opener at `start`, or -1. */
function findPairClose(s: string, mark: string, start: number): number {
  const from = start + mark.length
  if (from >= s.length || isSpace(s[from])) return -1
  let j = from + 1
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2
      continue
    }
    if (
      s.startsWith(mark, j) &&
      !isSpace(s[j - 1]) &&
      (mark !== "__" || !isWordChar(s[j + 2]))
    ) {
      return j
    }
    j += 1
  }
  return -1
}

/** Index of the closing single `*` or `_` for an opener at `start`, or -1. */
function findSingleClose(s: string, mark: string, start: number): number {
  const from = start + 1
  if (from >= s.length || isSpace(s[from]) || s[from] === mark) return -1
  let j = from + 1
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2
      continue
    }
    if (
      s[j] === mark &&
      s[j + 1] !== mark &&
      s[j - 1] !== mark &&
      !isSpace(s[j - 1]) &&
      (mark !== "_" || !isWordChar(s[j + 1]))
    ) {
      return j
    }
    j += 1
  }
  return -1
}

const ESCAPABLE = new Set(["*", "_", "~", "`"])

function parseEmphasis(s: string, atoms: Inline[]): Inline[] {
  const out: Inline[] = []
  let buf = ""

  const flush = () => {
    if (buf !== "") out.push({ kind: "text", text: buf })
    buf = ""
  }

  let i = 0
  while (i < s.length) {
    const ch = s[i]

    const atom = atomIndex(ch)
    if (atom >= 0 && atom < atoms.length) {
      flush()
      out.push(atoms[atom])
      i += 1
      continue
    }

    if (ch === "\\" && ESCAPABLE.has(s[i + 1] ?? "")) {
      buf += s[i + 1]
      i += 2
      continue
    }

    // `_` only opens at a word boundary, so snake_case stays text.
    const canOpen = ch !== "_" || !isWordChar(s[i - 1])
    let kind: "bold" | "italic" | "strike" | null = null
    let markLen = 0
    let close = -1

    if (canOpen && (ch === "*" || ch === "_" || ch === "~")) {
      const double = s[i + 1] === ch
      if (double && ch !== "~") {
        close = findPairClose(s, ch + ch, i)
        kind = "bold"
        markLen = 2
      } else if (double) {
        close = findPairClose(s, "~~", i)
        kind = "strike"
        markLen = 2
      } else if (ch !== "~") {
        close = findSingleClose(s, ch, i)
        kind = "italic"
        markLen = 1
      }
    }

    if (kind !== null && close > i + markLen - 1) {
      flush()
      out.push({
        kind,
        children: parseEmphasis(s.slice(i + markLen, close), atoms),
      })
      i = close + markLen
      continue
    }

    buf += ch
    i += 1
  }

  flush()
  return out
}

/** Matches a code span: a backtick run, content, the same run again. */
const CODE_SPAN = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g

/** Parses one run of inline text (no block syntax) into inline nodes. */
export function parseInline(text: string): Inline[] {
  if (text === "") return []
  const atoms: Inline[] = []
  const addAtom = (node: Inline): string => {
    atoms.push(node)
    return atomChar(atoms.length - 1)
  }

  // Plain text can contain real private-use characters; drop them so they are
  // never mistaken for atoms. (They have no visible glyph anyway.)
  const clean = text.replace(ATOM_RANGE, "")

  let withAtoms = ""
  let last = 0
  const pushPlain = (plain: string) => {
    for (const seg of splitMath(plain)) {
      withAtoms +=
        seg.kind === "text"
          ? seg.text
          : addAtom({
              kind: "math",
              tex: seg.tex,
              display: seg.display,
              raw: seg.raw,
            })
    }
  }

  for (const m of clean.matchAll(CODE_SPAN)) {
    const start = m.index
    pushPlain(clean.slice(last, start))
    let code = m[2]
    // One leading and trailing space is padding (so `` ` `` can be written).
    if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) {
      code = code.slice(1, -1)
    }
    withAtoms += addAtom({ kind: "code", text: code })
    last = start + m[0].length
  }
  pushPlain(clean.slice(last))

  return mergeText(parseEmphasis(withAtoms, atoms))
}

/** Joins neighbouring text nodes (escapes can split them). */
function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.kind === "text" && prev?.kind === "text") {
      prev.text += n.text
    } else {
      out.push(n)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Blocks

const FENCE = /^ {0,3}(`{3,})[^`]*$/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/
const ORDERED = /^[ \t]*\d{1,9}[.)][ \t]+(.*)$/
const QUOTE = /^ {0,3}>[ \t]?(.*)$/

/** True when `text` has a `$$` or `\[` display-math span still open. */
function hasOpenDisplayMath(text: string): boolean {
  const dollars = text.split("$$").length - 1
  if (dollars % 2 === 1) return true
  return text.lastIndexOf("\\[") > text.lastIndexOf("\\]")
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const blocks: Block[] = []
  let para: string[] = []
  let i = 0

  const flushPara = () => {
    if (para.length === 0) return
    blocks.push({
      kind: "paragraph",
      children: parseInline(para.join("\n")),
    })
    para = []
  }

  const startsBlock = (line: string): boolean =>
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line)

  while (i < lines.length) {
    const line = lines[i]
    const inMath = para.length > 0 && hasOpenDisplayMath(para.join("\n"))

    if (line.trim() === "" && !inMath) {
      flushPara()
      i += 1
      continue
    }

    if (!inMath && startsBlock(line)) {
      flushPara()
      const fence = FENCE.exec(line)
      if (fence) {
        const body: string[] = []
        i += 1
        while (i < lines.length) {
          const close = /^ {0,3}(`{3,})[ \t]*$/.exec(lines[i])
          if (close && close[1].length >= fence[1].length) break
          body.push(lines[i])
          i += 1
        }
        i += 1 // the closing fence (or past the end if unclosed)
        blocks.push({ kind: "code", text: body.join("\n") })
        continue
      }

      const heading = HEADING.exec(line)
      if (heading) {
        const level = Math.min(heading[1].length, 3) as 1 | 2 | 3
        blocks.push({
          kind: "heading",
          level,
          children: parseInline(heading[2]),
        })
        i += 1
        continue
      }

      const ordered = ORDERED.test(line)
      if (BULLET.test(line) || ordered) {
        const re = ordered ? ORDERED : BULLET
        const items: Inline[][] = []
        while (i < lines.length) {
          const m = re.exec(lines[i])
          if (!m) break
          items.push(parseInline(m[1]))
          i += 1
        }
        blocks.push({ kind: "list", ordered, items })
        continue
      }

      // Quote: consecutive `>` lines form one block.
      const quoted: string[] = []
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i])
        if (!m) break
        quoted.push(m[1])
        i += 1
      }
      blocks.push({ kind: "quote", children: parseInline(quoted.join("\n")) })
      continue
    }

    para.push(line)
    i += 1
  }

  flushPara()
  return blocks
}
