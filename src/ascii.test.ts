import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * CLAUDE.md: source files stay ASCII. Non-ASCII characters (zero-width, BOM,
 * combining marks, typographic punctuation) must be written as \uXXXX escapes
 * so tooling can't silently change or hide them.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url))
const EXTENSIONS = /\.(ts|tsx|css)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return EXTENSIONS.test(entry.name) ? [path] : []
  })
}

describe("source files", () => {
  it("contain only ASCII characters", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          for (const char of line) {
            const code = char.codePointAt(0) as number
            if (code > 0x7f) {
              const hex = code.toString(16).toUpperCase().padStart(4, "0")
              offenders.push(`${file.slice(SRC.length)}:${i + 1} U+${hex}`)
              break
            }
          }
        })
    }
    expect(
      offenders,
      "Write these as \\uXXXX escapes (see CLAUDE.md Gotchas)"
    ).toEqual([])
  })
})
