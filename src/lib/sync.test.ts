import { describe, expect, it } from "vitest"

import {
  CHUNK_BYTES,
  Reassembler,
  decodePairing,
  encodePairing,
  endMessage,
  failMessage,
  hiMessage,
  okMessage,
  parseMessage,
  partMessage,
  pingMessage,
  planMessage,
  DIGEST_TABLES,
  DigestBuilder,
  cardStamp,
  deckStamp,
  differingTables,
  digestOf,
  digestsEqual,
  idStamp,
  noteStamp,
  parseDigests,
  settingStamp,
  splitChunks,
} from "@/lib/sync"

// Shaped like what a browser gives for a data-channel-only connection.
const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2113937151 3f2b1c9e-aaaa-4bbb-8ccc-0123456789ab.local 54321 typ host",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:0123456789abcdefghijklmn",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "",
].join("\r\n")

describe("pairing codes", () => {
  it("round-trips an offer and an answer", async () => {
    for (const kind of ["offer", "answer"] as const) {
      const code = await encodePairing(kind, SDP)
      expect(code.startsWith("glyph1:")).toBe(true)
      expect(await decodePairing(code)).toEqual({ ok: true, kind, sdp: SDP })
    }
  })

  it("stays short enough to copy around in a chat message", async () => {
    expect((await encodePairing("offer", SDP)).length).toBeLessThan(900)
  })

  it("ignores whitespace added by pasting", async () => {
    const code = await encodePairing("offer", SDP)
    const spaced = ` ${code.slice(0, 20)}\n${code.slice(20)} \r\n`
    expect(await decodePairing(spaced)).toEqual({
      ok: true,
      kind: "offer",
      sdp: SDP,
    })
  })

  it("rejects text that is not a code", async () => {
    for (const text of [
      "",
      "hello",
      "glyph1:o",
      "glyph2:o:AAAA",
      "glyph1:x:AAAA",
      "glyph1:o:not base64!",
      "glyph1:o:AAAA",
    ]) {
      expect((await decodePairing(text)).ok).toBe(false)
    }
  })

  it("rejects a corrupted code instead of throwing", async () => {
    const code = await encodePairing("offer", SDP)
    const half = code.slice(0, Math.floor(code.length / 2))
    expect((await decodePairing(half)).ok).toBe(false)
  })

  it("rejects a payload that is not a session description", async () => {
    const code = await encodePairing("offer", "hello world")
    expect((await decodePairing(code)).ok).toBe(false)
  })
})

describe("control messages", () => {
  const digests = {
    decks: digestOf(["d1", "d2"]),
    notes: digestOf(["n1|5|", "n2|6|", "n3|7|"]),
    cards: digestOf(["c1|0|1|0"]),
    reviews: digestOf(["r1", "r2"]),
    settings: digestOf([]),
    images: digestOf(["i1"]),
  }

  it("round-trips every message", () => {
    expect(parseMessage(hiMessage("dev-1"))).toEqual({
      t: "hi",
      v: 3,
      device: "dev-1",
    })
    expect(parseMessage(planMessage("delta", 1))).toEqual({
      t: "plan",
      mode: "delta",
      round: 1,
    })
    expect(parseMessage(partMessage(1234))).toEqual({ t: "part", bytes: 1234 })
    expect(parseMessage(endMessage(7))).toEqual({ t: "end", parts: 7 })
    expect(parseMessage(okMessage(digests))).toEqual({ t: "ok", digests })
    expect(parseMessage(pingMessage())).toEqual({ t: "ping" })
    expect(parseMessage(failMessage("nope"))).toEqual({
      t: "fail",
      reason: "nope",
    })
  })

  it("rejects anything else", () => {
    for (const text of [
      "",
      "not json",
      "null",
      "[]",
      '{"t":"unknown"}',
      '{"t":"hi","v":2}',
      '{"t":"hi","v":2,"device":""}',
      '{"t":"plan","mode":"some","round":1}',
      '{"t":"plan","mode":"full","round":0}',
      '{"t":"part","bytes":-1}',
      '{"t":"part","bytes":1.5}',
      '{"t":"part","bytes":"3"}',
      '{"t":"end","parts":-2}',
      '{"t":"ok"}',
      '{"t":"ok","counts":{"decks":1,"notes":1,"cards":1,"reviews":1}}',
      '{"t":"ok","digests":{"decks":{"count":1,"hash":"00000000deadbeef"}}}',
      JSON.stringify({
        t: "ok",
        digests: { ...digests, notes: { count: 1, hash: "not hex" } },
      }),
    ]) {
      expect(parseMessage(text)).toBeNull()
    }
  })

  it("caps a fail reason", () => {
    const m = parseMessage(failMessage("x".repeat(1000)))
    expect(m?.t === "fail" && m.reason.length).toBe(200)
  })
})

describe("chunks", () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251)

  it("splits and reassembles exactly", () => {
    const data = bytes(CHUNK_BYTES * 3 + 17)
    const chunks = splitChunks(data)
    expect(chunks.map((c) => c.length)).toEqual([
      CHUNK_BYTES,
      CHUNK_BYTES,
      CHUNK_BYTES,
      17,
    ])
    const r = Reassembler.begin(data.length)
    if (!("push" in r)) throw new Error("begin failed")
    let result = r.push(chunks[0])
    for (const chunk of chunks.slice(1)) {
      expect(result.status).toBe("more")
      result = r.push(chunk)
    }
    expect(result.status).toBe("done")
    if (result.status === "done") expect(result.bytes).toEqual(data)
  })

  it("splits nothing into no chunks, and that is already complete", () => {
    expect(splitChunks(new Uint8Array())).toEqual([])
    const r = Reassembler.begin(0)
    expect("push" in r && r.complete).toBe(true)
  })

  it("has no size cap, and only refuses what cannot be allocated", () => {
    // No size cap: a large promise is accepted...
    expect("push" in Reassembler.begin(150 * 1024 * 1024)).toBe(true)
    // ...and only what this device cannot allocate is an error, never a throw.
    expect("error" in Reassembler.begin(2 ** 50)).toBe(true)
  })

  it("rejects more data than was promised", () => {
    const r = Reassembler.begin(10)
    if (!("push" in r)) throw new Error("begin failed")
    expect(r.push(bytes(6)).status).toBe("more")
    expect(r.push(bytes(5)).status).toBe("error")
  })
})

describe("digests", () => {
  const stamps = Array.from({ length: 500 }, (_, i) => `row-${i}|${1000 + i}`)

  it("ignores the order of the rows", () => {
    expect(digestOf([...stamps].reverse())).toEqual(digestOf(stamps))
    const shuffled = [...stamps].sort((x, y) => (x < y ? 1 : -1))
    expect(digestOf(shuffled)).toEqual(digestOf(stamps))
  })

  it("changes when one stamp changes, a row is added or one is missing", () => {
    const base = digestOf(stamps)
    const edited = [...stamps]
    edited[250] = "row-250|1251"
    expect(digestOf(edited)).not.toEqual(base)
    expect(digestOf([...stamps, "row-new|1"]).hash).not.toBe(base.hash)
    expect(digestOf(stamps.slice(1)).hash).not.toBe(base.hash)
    // Same count, different content: only the hash tells.
    expect(digestOf(edited).count).toBe(base.count)
  })

  it("counts rows and gives 16 hex digits, also for no rows", () => {
    const d = digestOf(stamps)
    expect(d.count).toBe(500)
    expect(d.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(digestOf([])).toEqual({ count: 0, hash: "0000000000000000" })
    const builder = new DigestBuilder()
    builder.add("a")
    builder.add("b")
    expect(builder.result()).toEqual(digestOf(["b", "a"]))
  })

  it("does not cancel out a row that appears twice", () => {
    expect(digestOf(["a", "a"]).hash).not.toBe(digestOf([]).hash)
  })

  it("takes the stamp a row is merged by", () => {
    const note = { id: "n", contentUpdatedAt: 5, deletedAt: null }
    expect(noteStamp(note)).not.toBe(
      noteStamp({ ...note, contentUpdatedAt: 6 })
    )
    expect(noteStamp(note)).not.toBe(noteStamp({ ...note, deletedAt: 7 }))
    const deck = { id: "d", updatedAt: 1, deletedAt: null }
    expect(deckStamp(deck)).not.toBe(deckStamp({ ...deck, deletedAt: 2 }))
    const card = { cardId: "c", lastReview: 1, updatedAt: 2, markedAt: 3 }
    expect(cardStamp(card)).not.toBe(cardStamp({ ...card, markedAt: 4 }))
    expect(cardStamp(card)).not.toBe(cardStamp({ ...card, lastReview: 9 }))
    expect(settingStamp({ key: "retention", updatedAt: 1 })).not.toBe(
      settingStamp({ key: "retention", updatedAt: 2 })
    )
    expect(idStamp("x")).toBe("x")
  })

  it("names the tables that differ, in a fixed order", () => {
    const same = parseDigests(
      Object.fromEntries(DIGEST_TABLES.map((t) => [t, digestOf([t])]))
    )
    if (!same) throw new Error("digests did not parse")
    expect(digestsEqual(same, { ...same })).toBe(true)
    const other = {
      ...same,
      images: digestOf(["other"]),
      cards: digestOf(["other"]),
    }
    expect(digestsEqual(same, other)).toBe(false)
    expect(differingTables(same, other)).toEqual(["cards", "images"])
  })

  it("reads only complete, well-formed digests", () => {
    const good = Object.fromEntries(
      DIGEST_TABLES.map((t) => [t, digestOf([t])])
    )
    const zeros = "0".repeat(16)
    expect(parseDigests(good)).toEqual(good)
    expect(parseDigests(null)).toBeNull()
    expect(parseDigests({ ...good, images: undefined })).toBeNull()
    expect(
      parseDigests({ ...good, notes: { count: -1, hash: zeros } })
    ).toBeNull()
    expect(
      parseDigests({ ...good, notes: { count: 1.5, hash: zeros } })
    ).toBeNull()
    expect(
      parseDigests({ ...good, notes: { count: 1, hash: "ABCDEF0123456789" } })
    ).toBeNull()
  })
})
