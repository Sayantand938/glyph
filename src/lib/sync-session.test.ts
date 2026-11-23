import { describe, expect, it } from "vitest"

import {
  SYNC_OVERLAP_MS,
  SyncSession,
  countsEqual,
  deltaSince,
  pagesOf,
  parseMarks,
  withMark,
  type RowCounts,
  type SyncDeps,
  type SyncEvents,
  type SyncIO,
} from "@/lib/sync"

/** A fake device: rows are id -> time of last change; merging keeps the newer. */
class Device {
  rows = new Map<string, number>()
  marks: Record<string, number> = {}
  clock = 1_000_000_000_000
  partRows = 3
  /** Parts sent, for the assertions. */
  sentPartTexts: string[] = []
  mergeError: string | null = null
  result: { stats: number; rounds: number; modes: string[] } | null = null
  failure: string | null = null

  constructor(readonly id: string) {}

  put(id: string, at: number) {
    this.rows.set(id, at)
  }

  deps(): SyncDeps<number> {
    return {
      deviceId: this.id,
      now: () => this.clock,
      markFor: (peer) => this.marks[peer] ?? null,
      setMark: (peer, at) => {
        this.marks = withMark(this.marks, peer, at)
      },
      parts: (since) => this.partsSince(since),
      merge: async (text) => {
        if (this.mergeError) throw new Error(this.mergeError)
        let added = 0
        for (const [id, at] of JSON.parse(text) as [string, number][]) {
          const cur = this.rows.get(id)
          if (cur === undefined) added += 1
          if (cur === undefined || at > cur) this.rows.set(id, at)
        }
        return added
      },
      emptyStats: () => 0,
      addStats: (a, b) => a + b,
      counts: async (): Promise<RowCounts> => ({
        decks: 0,
        notes: this.rows.size,
        cards: 0,
        reviews: 0,
      }),
    }
  }

  private async *partsSince(since: number | null): AsyncGenerator<string> {
    const changed = [...this.rows].filter(
      ([, at]) => since === null || at > since
    )
    for (const page of pagesOf(changed, this.partRows)) {
      const text = JSON.stringify(page)
      this.sentPartTexts.push(text)
      yield text
    }
  }
}

type Item = { text: string } | { bin: Uint8Array }

/** Two sessions joined by an in-order channel, like a data channel. */
function connect(a: Device, b: Device) {
  const sessions: SyncSession<number>[] = []
  const queues: Item[][] = [[], []]
  let pumping = false
  const pump = async () => {
    if (pumping) return
    pumping = true
    for (;;) {
      let moved = false
      for (const to of [0, 1]) {
        const item = queues[to].shift()
        if (!item) continue
        moved = true
        await new Promise((r) => setTimeout(r, 0))
        if ("text" in item) sessions[to].onText(item.text)
        else sessions[to].onBinary(item.bin)
      }
      if (!moved) break
    }
    pumping = false
  }
  const io = (toOther: number): SyncIO => ({
    sendText(text) {
      queues[toOther].push({ text })
      void pump()
    },
    async sendChunks(chunks) {
      for (const bin of chunks) queues[toOther].push({ bin: bin.slice() })
      void pump()
    },
  })
  const events = (d: Device): SyncEvents<number> => ({
    onDone: (stats, info) => {
      d.result = { stats, rounds: info.rounds, modes: info.modes }
    },
    onFail: (message) => {
      d.failure = message
    },
  })
  sessions[0] = new SyncSession(io(1), a.deps(), events(a))
  sessions[1] = new SyncSession(io(0), b.deps(), events(b))
  const run = async () => {
    sessions[0].start()
    sessions[1].start()
    for (let i = 0; i < 4000; i += 1) {
      await new Promise((r) => setTimeout(r, 0))
      if (sessions[0].finished && sessions[1].finished) return
    }
    throw new Error("the sync never finished")
  }
  return { run, sessions }
}

const seed = (d: Device, prefix: string, n: number, at: number) => {
  for (let i = 0; i < n; i += 1) d.put(`${prefix}${i}`, at + i)
}

const DAY = 24 * 60 * 60 * 1000

describe("delta helpers", () => {
  it("sends everything without a mark, and changes since the mark less an overlap", () => {
    expect(deltaSince(null)).toBeNull()
    expect(deltaSince(undefined)).toBeNull()
    expect(deltaSince(0)).toBeNull()
    expect(deltaSince(Number.NaN)).toBeNull()
    expect(deltaSince(SYNC_OVERLAP_MS * 10)).toBe(SYNC_OVERLAP_MS * 9)
    expect(deltaSince(5)).toBe(0)
  })

  it("reads marks defensively and never moves one back", () => {
    expect(parseMarks(null)).toEqual({})
    expect(parseMarks("not json")).toEqual({})
    expect(parseMarks("[1,2]")).toEqual({})
    expect(parseMarks('{"a":5,"b":"x","c":-1}')).toEqual({ a: 5 })
    expect(withMark({ a: 10 }, "a", 5)).toEqual({ a: 10 })
    expect(withMark({ a: 10 }, "b", 5)).toEqual({ a: 10, b: 5 })
  })

  it("compares counts and pages lists", () => {
    const c = { decks: 1, notes: 2, cards: 3, reviews: 4 }
    expect(countsEqual(c, { ...c })).toBe(true)
    expect(countsEqual(c, { ...c, reviews: 5 })).toBe(false)
    expect(pagesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(pagesOf([], 2)).toEqual([])
  })
})

describe("a sync between two devices", () => {
  it("copies everything in a full sync the first time, in several parts", async () => {
    const a = new Device("A")
    const b = new Device("B")
    seed(a, "a", 10, 1000)
    seed(b, "b", 4, 2000)
    await connect(a, b).run()
    expect(a.failure).toBeNull()
    expect(b.failure).toBeNull()
    expect(a.rows.size).toBe(14)
    expect([...a.rows.keys()].sort()).toEqual([...b.rows.keys()].sort())
    expect(a.result).toMatchObject({ rounds: 1, modes: ["full"], stats: 4 })
    expect(b.result).toMatchObject({ rounds: 1, modes: ["full"], stats: 10 })
    // 10 rows in pages of 3 is 4 parts from A, so it was not one big message.
    expect(a.sentPartTexts.length).toBe(4)
    expect(a.marks.B).toBe(a.clock)
    expect(b.marks.A).toBe(b.clock)
  })

  it("then sends only what changed since", async () => {
    const a = new Device("A")
    const b = new Device("B")
    // Old data, long before the mark.
    seed(a, "old", 200, 1000)
    await connect(a, b).run()
    expect(b.rows.size).toBe(200)

    // Time passes (well past the overlap); a few rows change on each device.
    a.clock += 30 * DAY
    b.clock = a.clock
    a.put("new-a", a.clock - 1000)
    b.put("new-b", b.clock - 2000)
    a.sentPartTexts = []
    b.sentPartTexts = []
    await connect(a, b).run()
    expect(a.failure).toBeNull()
    expect(a.rows.has("new-b")).toBe(true)
    expect(b.rows.has("new-a")).toBe(true)
    expect(a.result).toMatchObject({ rounds: 1, modes: ["delta"], stats: 1 })
    expect(a.sentPartTexts).toHaveLength(1)
    expect(a.sentPartTexts[0]).not.toContain("old")
    expect(a.sentPartTexts[0]).toContain("new-a")
  })

  it("repeats once in full when a delta missed something, then agrees", async () => {
    const a = new Device("A")
    const b = new Device("B")
    seed(a, "x", 30, 1000)
    await connect(a, b).run()

    // B loses everything but still remembers the mark for A.
    b.rows.clear()
    a.clock += 10 * DAY
    b.clock = a.clock
    a.put("fresh", a.clock - 500)
    await connect(a, b).run()
    expect(a.failure).toBeNull()
    expect(b.failure).toBeNull()
    expect(b.rows.size).toBe(31)
    expect(a.result?.rounds).toBe(2)
    expect(a.result?.modes).toEqual(["delta", "full"])
    expect(b.result?.rounds).toBe(2)
  })

  it("syncs two devices that have nothing", async () => {
    const a = new Device("A")
    const b = new Device("B")
    await connect(a, b).run()
    expect(a.failure).toBeNull()
    expect(a.result).toMatchObject({ rounds: 1, stats: 0 })
  })

  it("handles many parts in order", async () => {
    const a = new Device("A")
    const b = new Device("B")
    a.partRows = 1
    seed(a, "r", 120, 5000)
    await connect(a, b).run()
    expect(b.rows.size).toBe(120)
    expect(a.sentPartTexts).toHaveLength(120)
  })

  it("fails on both devices when a part cannot be merged, and sets no mark", async () => {
    const a = new Device("A")
    const b = new Device("B")
    seed(a, "a", 5, 1000)
    b.mergeError = "disk full"
    await connect(a, b).run()
    expect(b.failure).toBe("disk full")
    expect(a.failure).toContain("The other device stopped the sync: disk full")
    expect(Object.keys(a.marks)).toEqual([])
    expect(Object.keys(b.marks)).toEqual([])
  })

  it("refuses to sync a device with itself", async () => {
    const a = new Device("same")
    const b = new Device("same")
    await connect(a, b).run()
    expect(a.failure).toContain("same device")
  })

  it("refuses a different protocol version", () => {
    const c = new Device("C")
    const d = new Device("D")
    const link = connect(c, d)
    link.sessions[0].onText(JSON.stringify({ t: "hi", v: 1, device: "old" }))
    expect(c.failure).toContain("different version")
  })
})
