import { describe, expect, it } from "vitest"

import {
  SYNC_OVERLAP_MS,
  SyncSession,
  deltaSince,
  digestOf,
  pagesOf,
  parseMarks,
  withMark,
  type SyncDeps,
  type SyncDigests,
  type SyncEvents,
  type SyncIO,
} from "@/lib/sync"

/** One part on the fake wire: rows as [id, stamp, image id or ""] and images. */
interface FakePart {
  rows: [string, number, string][]
  images: string[]
}

/**
 * A fake device: rows are id -> time of last change (and the picture the row
 * uses); merging keeps the newer; a delta sends the rows changed after `since`,
 * like `readBackupParts`. Its digest is the real `digestOf` over the same
 * id + stamp a real row has, and covers the pictures rows use and it holds.
 */
class Device {
  rows = new Map<string, number>()
  /** row id -> picture it uses. */
  uses = new Map<string, string>()
  /** The pictures this device holds. */
  images = new Set<string>()
  marks: Record<string, number> = {}
  clock = 1_000_000_000_000
  partRows = 3
  /** Parts sent, for the assertions. */
  sentPartTexts: string[] = []
  mergeError: string | null = null
  /** How long (ms) computing the digests takes. */
  digestDelay = 0
  stallMs: number | undefined = undefined
  result: { stats: number; rounds: number; modes: string[] } | null = null
  failure: string | null = null

  constructor(readonly id: string) {}

  put(id: string, at: number, image?: string) {
    this.rows.set(id, at)
    if (image !== undefined) {
      this.uses.set(id, image)
      this.images.add(image)
    }
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
        const part = JSON.parse(text) as FakePart
        let added = 0
        for (const [id, at, image] of part.rows) {
          const cur = this.rows.get(id)
          if (cur === undefined) added += 1
          if (cur === undefined || at > cur) {
            this.rows.set(id, at)
            if (image) this.uses.set(id, image)
          }
        }
        for (const image of part.images) this.images.add(image)
        return added
      },
      emptyStats: () => 0,
      addStats: (a, b) => a + b,
      digests: async (): Promise<SyncDigests> => {
        if (this.digestDelay > 0) {
          await new Promise((r) => setTimeout(r, this.digestDelay))
        }
        const empty = digestOf([])
        const used = new Set(
          [...this.uses.values()].filter((image) => this.images.has(image))
        )
        return {
          decks: empty,
          notes: digestOf([...this.rows].map(([id, at]) => `${id}|${at}`)),
          cards: empty,
          reviews: empty,
          settings: empty,
          images: digestOf(used),
        }
      },
      stallMs: this.stallMs,
    }
  }

  private async *partsSince(since: number | null): AsyncGenerator<string> {
    const changed = [...this.rows].filter(
      ([, at]) => since === null || at > since
    )
    for (const page of pagesOf(changed, this.partRows)) {
      const part: FakePart = {
        rows: page.map(([id, at]) => [id, at, this.uses.get(id) ?? ""]),
        images: [
          ...new Set(
            page
              .map(([id]) => this.uses.get(id))
              .filter(
                (image): image is string =>
                  image !== undefined && this.images.has(image)
              )
          ),
        ],
      }
      const text = JSON.stringify(part)
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

  it("pages lists", () => {
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

describe("a sync that must notice what the row counts cannot", () => {
  const BASE = 1_000_000_000_000

  /** Three devices that have all synced once and so know each other. */
  async function threeSynced() {
    const laptop = new Device("laptop")
    const phone = new Device("phone")
    const tablet = new Device("tablet")
    seed(laptop, "q", 20, 1000)
    await connect(laptop, phone).run()
    await connect(phone, tablet).run()
    expect(tablet.rows.size).toBe(20)
    return { laptop, phone, tablet }
  }

  it("heals a tablet missed by an edit that went laptop to phone to tablet", async () => {
    const { laptop, phone, tablet } = await threeSynced()

    // Day 10: the laptop, offline, edits a question.
    laptop.clock = BASE + 10 * DAY
    laptop.put("q3", BASE + 10 * DAY)
    // Day 12.5: phone and tablet sync (nothing to send).
    phone.clock = tablet.clock = BASE + 12.5 * DAY
    await connect(phone, tablet).run()
    // Day 13: the laptop is back and syncs with the phone, which gets the edit.
    laptop.clock = phone.clock = BASE + 13 * DAY
    await connect(laptop, phone).run()
    expect(phone.rows.get("q3")).toBe(BASE + 10 * DAY)

    // Day 13.1: the phone's mark for the tablet is day 12.5, so with the two day
    // overlap the edit (day 10) is older than the delta's window and is not
    // sent. Both devices still hold 20 rows, so a count check would pass.
    phone.clock = tablet.clock = BASE + 13.1 * DAY
    await connect(phone, tablet).run()
    expect(phone.failure).toBeNull()
    expect(tablet.failure).toBeNull()
    expect(tablet.rows.get("q3")).toBe(BASE + 10 * DAY)
    expect(tablet.result?.modes).toEqual(["delta", "full"])
    expect(phone.result?.rounds).toBe(2)
  })

  it("heals a device that restored a backup file, then synced", async () => {
    const a = new Device("A")
    const b = new Device("B")
    seed(a, "r", 15, 1000)
    await connect(a, b).run()
    // Weeks later A restores a backup file that holds an edit made on a third
    // device on day 5. A restore keeps the row's own stamp, so it is older than
    // A's mark for B and a delta would skip it.
    a.clock = b.clock = BASE + 19 * DAY
    await connect(a, b).run()
    a.clock = b.clock = BASE + 20 * DAY
    a.put("r4", BASE + 5 * DAY)
    await connect(a, b).run()
    expect(b.failure).toBeNull()
    expect(b.rows.get("r4")).toBe(BASE + 5 * DAY)
    expect(a.result?.modes).toEqual(["delta", "full"])
  })

  it("heals a picture that never arrived for a note that did not change", async () => {
    const a = new Device("A")
    const b = new Device("B")
    a.put("n1", 1000, "img-1")
    a.put("n2", 1001)
    await connect(a, b).run()
    expect(b.images.has("img-1")).toBe(true)

    // B loses the picture; the note itself is old and the same on both.
    b.images.delete("img-1")
    a.clock = b.clock = BASE + 30 * DAY
    await connect(a, b).run()
    expect(b.failure).toBeNull()
    expect(b.images.has("img-1")).toBe(true)
    expect(b.result?.modes).toEqual(["delta", "full"])
  })

  it("agrees in one round when nothing was missed", async () => {
    const { laptop, phone } = await threeSynced()
    laptop.clock = phone.clock = BASE + 5 * DAY
    laptop.put("fresh", BASE + 5 * DAY - 1)
    await connect(laptop, phone).run()
    expect(laptop.result).toMatchObject({ rounds: 1, modes: ["delta"] })
  })

  it("fails, naming the table, when a full sync cannot make them agree", async () => {
    const a = new Device("A")
    const b = new Device("B")
    a.put("n1", 1000, "img-1")
    // B can never get the picture: it drops every picture it is sent.
    const deps = b.deps()
    b.deps = () => ({
      ...deps,
      merge: async (text) => {
        const part = JSON.parse(text) as FakePart
        return deps.merge(JSON.stringify({ ...part, images: [] }))
      },
    })
    await connect(a, b).run()
    expect(a.failure).toContain("still differ in pictures after a full sync")
    expect(b.failure).toContain("still differ in pictures after a full sync")
    expect(Object.keys(a.marks)).toEqual([])
  })
})

describe("a sync that stops answering", () => {
  /** A session with no peer behind it, and a clock the test ticks by hand. */
  function lonely(stallMs = 30_000) {
    const sent: string[] = []
    const ticks: (() => void)[] = []
    const d = new Device("A")
    const events = { failed: "", toldPeer: false }
    const session = new SyncSession<number>(
      {
        sendText: (text) => void sent.push(text),
        sendChunks: async () => {},
      },
      {
        ...d.deps(),
        stallMs,
        every: (fn, ms) => {
          ticks.push(fn)
          expect(ms).toBe(stallMs / 6)
          return () => {
            ticks.length = 0
          }
        },
      },
      {
        onDone: () => {},
        onFail: (message, peerTold) => {
          events.failed = message
          events.toldPeer = peerTold
        },
      }
    )
    return { session, sent, ticks, events }
  }

  const types = (sent: string[]) =>
    sent.map((text) => (JSON.parse(text) as { t: string }).t)

  it("pings while it waits and gives up after six silent ticks", () => {
    const { session, sent, ticks, events } = lonely()
    session.start()
    const tick = ticks[0]
    for (let i = 0; i < 5; i += 1) tick()
    expect(events.failed).toBe("")
    expect(types(sent)).toEqual(["hi", "ping", "ping", "ping", "ping", "ping"])
    tick()
    expect(events.failed).toContain("has not answered for 30 seconds")
    expect(events.failed).toContain("gone to sleep")
    expect(events.toldPeer).toBe(true)
    expect(types(sent).at(-1)).toBe("fail")
    expect(session.finished).toBe(true)
    // The timer is gone once it has failed.
    expect(ticks).toHaveLength(0)
  })

  it("never trips while the other device keeps sending pings", () => {
    const { session, ticks, events } = lonely()
    session.start()
    const tick = ticks[0]
    for (let i = 0; i < 200; i += 1) {
      tick()
      tick()
      tick()
      // Any message from the other device is a sign of life.
      session.onText(JSON.stringify({ t: "ping" }))
    }
    expect(events.failed).toBe("")
    expect(session.finished).toBe(false)
  })

  it("stops its timer when told to, and has none when disabled", () => {
    const { session, ticks } = lonely()
    session.start()
    expect(ticks).toHaveLength(1)
    session.stop()
    expect(ticks).toHaveLength(0)

    const never = lonely(0)
    never.session.start()
    expect(never.ticks).toHaveLength(0)
  })

  it("lets a slow sync finish when the other device is only busy", async () => {
    const a = new Device("A")
    const b = new Device("B")
    a.partRows = 1
    seed(a, "big", 12, 1000)
    // 60 ms of silence is the limit, yet computing A's digests takes 150 ms with
    // nothing sent but pings. Without the pings B would give up.
    a.stallMs = b.stallMs = 60
    a.digestDelay = 150
    await connect(a, b).run()
    expect(a.failure).toBeNull()
    expect(b.failure).toBeNull()
    expect(b.rows.size).toBe(12)
    expect(a.result).toMatchObject({ rounds: 1 })
  })

  it("fails the waiting device when the other one goes silent", async () => {
    const a = new Device("A")
    const b = new Device("B")
    seed(a, "x", 5, 1000)
    a.stallMs = b.stallMs = 60
    const link = connect(a, b)
    // B stops hearing and answering after the hello (its phone went to sleep).
    const silent = link.sessions[1]
    const real = silent.onText.bind(silent)
    let heard = 0
    silent.onText = (text) => {
      heard += 1
      if (heard <= 1) real(text)
    }
    silent.onBinary = () => {}
    await link.run()
    expect(a.failure).toContain("has not answered")
    expect(a.result).toBeNull()
  })
})
