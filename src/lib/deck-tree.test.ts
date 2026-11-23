import { describe, expect, it } from "vitest"

import type { Deck } from "@/db/types"

import {
  childrenOf,
  deckPath,
  flattenTree,
  liveDecks,
  pathLabel,
  rollupCounts,
  subtreeIds,
} from "./deck-tree"

function deck(
  id: string,
  parentId: string | null,
  name = id,
  deletedAt: number | null = null
): Deck {
  return { id, parentId, name, updatedAt: 1, deletedAt }
}

// WBCS > Mains > 2018 > Paper 4, with a few siblings around it.
const WBCS = deck("wbcs", null, "WBCS")
const MAINS = deck("mains", "wbcs", "Mains")
const PRELIMS = deck("prelims", "wbcs", "Prelims")
const Y2018 = deck("y2018", "mains", "2018")
const Y2019 = deck("y2019", "mains", "2019")
const PAPER4 = deck("paper4", "y2018", "Paper 4")
const PAPER3 = deck("paper3", "y2018", "Paper 3")
const SSC = deck("ssc", null, "SSC")
const ALL = [PAPER4, SSC, WBCS, Y2019, MAINS, PRELIMS, Y2018, PAPER3]

describe("liveDecks", () => {
  it("keeps everything when nothing is deleted", () => {
    expect(liveDecks(ALL)).toHaveLength(ALL.length)
  })

  it("drops a deleted deck and everything below it", () => {
    const decks = ALL.map((d) =>
      d.id === "mains" ? { ...d, deletedAt: 5 } : d
    )
    expect(
      liveDecks(decks)
        .map((d) => d.id)
        .sort()
    ).toEqual(["prelims", "ssc", "wbcs"])
  })

  it("drops a deck whose parent is missing", () => {
    expect(liveDecks([deck("orphan", "nobody"), SSC]).map((d) => d.id)).toEqual(
      ["ssc"]
    )
  })

  it("survives a cycle in bad data", () => {
    const a = deck("a", "b")
    const b = deck("b", "a")
    expect(liveDecks([a, b, SSC]).map((d) => d.id)).toEqual(["ssc"])
  })
})

describe("childrenOf and subtreeIds", () => {
  const children = childrenOf(ALL)

  it("sorts each level by name, ignoring case", () => {
    expect(children.get(null)?.map((d) => d.name)).toEqual(["SSC", "WBCS"])
    expect(children.get("wbcs")?.map((d) => d.name)).toEqual([
      "Mains",
      "Prelims",
    ])
    expect(children.get("y2018")?.map((d) => d.name)).toEqual([
      "Paper 3",
      "Paper 4",
    ])
  })

  it("lists a deck and everything below it, to any depth", () => {
    expect(subtreeIds(children, "wbcs").sort()).toEqual(
      ["mains", "paper3", "paper4", "prelims", "wbcs", "y2018", "y2019"].sort()
    )
    expect(subtreeIds(children, "paper4")).toEqual(["paper4"])
    expect(subtreeIds(children, "nobody")).toEqual(["nobody"])
  })
})

describe("deckPath", () => {
  it("runs from the top down to the deck", () => {
    expect(pathLabel(deckPath(ALL, "paper4"))).toBe(
      "WBCS > Mains > 2018 > Paper 4"
    )
    expect(pathLabel(deckPath(ALL, "wbcs"))).toBe("WBCS")
    expect(deckPath(ALL, "nobody")).toEqual([])
  })
})

describe("rollupCounts", () => {
  const children = childrenOf(ALL)
  const own = new Map([
    ["paper4", { new: 5, learning: 1, due: 2 }],
    ["paper3", { new: 1, learning: 0, due: 0 }],
    ["y2019", { new: 10, learning: 0, due: 3 }],
    ["wbcs", { new: 100, learning: 0, due: 0 }],
  ])
  const total = rollupCounts(children, own)

  it("adds a deck's own cards to everything below it", () => {
    expect(total.get("y2018")).toEqual({ new: 6, learning: 1, due: 2 })
    expect(total.get("mains")).toEqual({ new: 16, learning: 1, due: 5 })
    expect(total.get("wbcs")).toEqual({ new: 116, learning: 1, due: 5 })
  })

  it("gives empty decks zero", () => {
    expect(total.get("prelims")).toEqual({ new: 0, learning: 0, due: 0 })
    expect(total.get("ssc")).toEqual({ new: 0, learning: 0, due: 0 })
  })
})

describe("flattenTree", () => {
  const children = childrenOf(ALL)
  const none = new Set<string>()

  it("lists every row, parents before their children", () => {
    expect(flattenTree(children, none).map((r) => r.deck.id)).toEqual([
      "ssc",
      "wbcs",
      "mains",
      "y2018",
      "paper3",
      "paper4",
      "y2019",
      "prelims",
    ])
  })

  it("gives each row its depth and whether it can be opened", () => {
    const rows = new Map(flattenTree(children, none).map((r) => [r.deck.id, r]))
    expect(rows.get("wbcs")).toMatchObject({
      depth: 0,
      hasChildren: true,
      expanded: true,
    })
    expect(rows.get("paper4")).toMatchObject({
      depth: 3,
      hasChildren: false,
      expanded: false,
    })
    expect(rows.get("ssc")).toMatchObject({ depth: 0, hasChildren: false })
  })

  it("marks the last sibling so its connector ends there", () => {
    const rows = new Map(flattenTree(children, none).map((r) => [r.deck.id, r]))
    expect(rows.get("mains")?.isLast).toBe(false) // Prelims follows
    expect(rows.get("prelims")?.isLast).toBe(true)
    expect(rows.get("paper3")?.isLast).toBe(false)
    expect(rows.get("paper4")?.isLast).toBe(true)
    expect(rows.get("ssc")?.isLast).toBe(false)
    expect(rows.get("wbcs")?.isLast).toBe(true)
  })

  it("says where a line passes through the gutter beside a row", () => {
    const rows = new Map(flattenTree(children, none).map((r) => [r.deck.id, r]))
    // Children of a top-level deck have no gutter columns before their own.
    expect(rows.get("mains")?.lines).toEqual([])
    // 2018 sits under Mains, which has Prelims below it: a line passes.
    expect(rows.get("y2018")?.lines).toEqual([true])
    // Paper 3/4 sit under 2018, which has 2019 below it, under Mains (not last).
    expect(rows.get("paper4")?.lines).toEqual([true, true])
    // Below Prelims (the last of its level) no line passes through.
    const prelimsChild = deck("p1", "prelims", "Q1")
    const more = childrenOf([...ALL, prelimsChild])
    const row = flattenTree(more, none).find((r) => r.deck.id === "p1")
    expect(row?.lines).toEqual([false])
    expect(row?.depth).toBe(2)
  })

  it("hides everything below a collapsed deck", () => {
    const rows = flattenTree(children, new Set(["mains"]))
    expect(rows.map((r) => r.deck.id)).toEqual([
      "ssc",
      "wbcs",
      "mains",
      "prelims",
    ])
    expect(rows.find((r) => r.deck.id === "mains")).toMatchObject({
      hasChildren: true,
      expanded: false,
    })
    expect(
      flattenTree(children, new Set(["wbcs"])).map((r) => r.deck.id)
    ).toEqual(["ssc", "wbcs"])
  })

  it("is empty with no decks", () => {
    expect(flattenTree(new Map(), none)).toEqual([])
  })
})
