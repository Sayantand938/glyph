/**
 * Decks form a tree of any depth (WBCS > Mains > 2018 > Paper 4): every deck
 * has a `parentId` (null at the top). Pure helpers, no DB or React: which decks
 * are alive, their order, paths, roll-up counts and the rows of the home screen
 * with the information the connector lines need.
 *
 * A deck is alive when it is not deleted and every ancestor is alive too; a
 * deck whose parent is missing or deleted is out of the tree (its questions go
 * with it, like a deleted Subject's topics always did).
 */
import type { Deck } from "@/db/types"

import { deckNameKey } from "./importer/deck-ref"
import { ZERO_COUNTS, addCounts, type DeckCounts } from "./queue"

export type DeckChildren = ReadonlyMap<string | null, readonly Deck[]>

/** Name order (ignoring case), then id, so two decks never swap places. */
export function compareDecks(a: Deck, b: Deck): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/** The decks that are alive: not deleted, with every ancestor alive. Cycle-safe. */
export function liveDecks(all: readonly Deck[]): Deck[] {
  const byId = new Map(all.map((d) => [d.id, d]))
  const memo = new Map<string, boolean>()

  function alive(deck: Deck, seen: Set<string>): boolean {
    const known = memo.get(deck.id)
    if (known !== undefined) return known
    let result: boolean
    if (deck.deletedAt !== null || seen.has(deck.id)) {
      result = false
    } else if (deck.parentId === null) {
      result = true
    } else {
      const parent = byId.get(deck.parentId)
      seen.add(deck.id)
      result = parent !== undefined && alive(parent, seen)
    }
    memo.set(deck.id, result)
    return result
  }

  return all.filter((d) => alive(d, new Set()))
}

/** Direct children of every deck (key `null` = the top level), each list in name order. */
export function childrenOf(decks: readonly Deck[]): Map<string | null, Deck[]> {
  const map = new Map<string | null, Deck[]>()
  for (const deck of decks) {
    const list = map.get(deck.parentId)
    if (list) list.push(deck)
    else map.set(deck.parentId, [deck])
  }
  for (const list of map.values()) list.sort(compareDecks)
  return map
}

/** `id` and the ids of every deck below it. */
export function subtreeIds(children: DeckChildren, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const next = stack.pop() as string
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
    for (const child of children.get(next) ?? []) stack.push(child.id)
  }
  return out
}

/** The decks from the top one down to `id` (empty when `id` is unknown). */
export function deckPath(decks: readonly Deck[], id: string): Deck[] {
  const byId = new Map(decks.map((d) => [d.id, d]))
  const path: Deck[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return path
}

export const PATH_SEPARATOR = " > "

/** "WBCS > Mains > 2018". */
export function pathLabel(path: readonly Deck[]): string {
  return path.map((d) => d.name).join(PATH_SEPARATOR)
}

/** "WBCS > Mains > 2018" typed by hand: the names, trimmed, blanks dropped. */
export function parseDeckPath(text: string): string[] {
  return text
    .split(">")
    .map((part) => part.trim())
    .filter((part) => part !== "")
}

/**
 * The live deck at exactly this path of names (matched ignoring case, spacing
 * and Unicode form), or null when any part of it does not exist yet.
 */
export function findDeckByPath(
  decks: readonly Deck[],
  names: readonly string[]
): Deck | null {
  if (names.length === 0) return null
  const children = childrenOf(decks)
  let parent: string | null = null
  let found: Deck | null = null
  for (const name of names) {
    const key = deckNameKey(name)
    found =
      (children.get(parent) ?? []).find((d) => deckNameKey(d.name) === key) ??
      null
    if (!found) return null
    parent = found.id
  }
  return found
}

/**
 * Counts for every deck including everything below it, from each deck's own
 * cards. A deck with no entry counts as empty.
 */
export function rollupCounts(
  children: DeckChildren,
  own: ReadonlyMap<string, DeckCounts>
): Map<string, DeckCounts> {
  const total = new Map<string, DeckCounts>()

  function visit(deck: Deck, seen: Set<string>): DeckCounts {
    const done = total.get(deck.id)
    if (done) return done
    if (seen.has(deck.id)) return ZERO_COUNTS
    seen.add(deck.id)
    let sum = own.get(deck.id) ?? ZERO_COUNTS
    for (const child of children.get(deck.id) ?? []) {
      sum = addCounts(sum, visit(child, seen))
    }
    total.set(deck.id, sum)
    return sum
  }

  for (const list of children.values()) {
    for (const deck of list) visit(deck, new Set())
  }
  return total
}

/** One visible row of the home screen's tree. */
export interface TreeRow {
  deck: Deck
  /** 0 = top level. */
  depth: number
  hasChildren: boolean
  expanded: boolean
  /** The last of its siblings (its connector ends here instead of going on). */
  isLast: boolean
  /**
   * For the gutter columns left of the row's own connector (one per level
   * between the top and this row's parent): whether a vertical line passes
   * through, because the ancestor at that level has more siblings below.
   * `lines.length === Math.max(0, depth - 1)`.
   */
  lines: boolean[]
}

/**
 * The rows to show, top to bottom: every top-level deck, and below an expanded
 * deck its children, to any depth. A deck whose id is in `collapsed` hides its
 * descendants.
 */
export function flattenTree(
  children: DeckChildren,
  collapsed: ReadonlySet<string>
): TreeRow[] {
  const rows: TreeRow[] = []

  function walk(
    list: readonly Deck[],
    depth: number,
    lines: boolean[],
    seen: Set<string>
  ) {
    list.forEach((deck, index) => {
      if (seen.has(deck.id)) return
      const below = children.get(deck.id) ?? []
      const isLast = index === list.length - 1
      const expanded = below.length > 0 && !collapsed.has(deck.id)
      rows.push({
        deck,
        depth,
        hasChildren: below.length > 0,
        expanded,
        isLast,
        lines,
      })
      if (expanded) {
        const nextSeen = new Set(seen).add(deck.id)
        // A line passes through the children's gutter at this level when this
        // deck has later siblings. Top-level decks have no connector of their own.
        walk(below, depth + 1, depth === 0 ? [] : [...lines, !isLast], nextSeen)
      }
    })
  }

  walk(children.get(null) ?? [], 0, [], new Set())
  return rows
}
