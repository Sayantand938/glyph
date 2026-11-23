import { describe, expect, it } from "vitest"

import {
  NearbyInitiator,
  NearbyResponder,
  encodeNearby,
  parseNearby,
  parseTrusted,
  randomPin,
  webCrypto,
  withTrusted,
  withoutTrusted,
  type NearbyMsg,
  type Request,
} from "@/lib/sync/nearby"

const A = { id: "a".repeat(8), name: "Laptop" }
const B = { id: "b".repeat(8), name: "Phone" }

/** Two devices wired together; messages are delivered in order, one at a time. */
function pair(opts: {
  aKey?: string | null
  bKey?: string | null
  /** Replace what the responder sends (an impostor). */
  tamper?: (msg: NearbyMsg) => NearbyMsg
}) {
  const log = {
    ready: [] as (string | null)[],
    answer: [] as string[],
    offer: [] as string[],
    failA: [] as string[],
    failB: [] as string[],
    declined: 0,
    requests: [] as Request[],
    readyB: [] as (string | null)[],
  }
  const toA: NearbyMsg[] = []
  const toB: NearbyMsg[] = []
  const initiator = new NearbyInitiator(
    { self: A, secretFor: () => opts.aKey ?? null, crypto: webCrypto },
    { send: (m) => toB.push(m) },
    {
      onReady: (s) => log.ready.push(s),
      onDeclined: () => log.declined++,
      onAnswer: (c) => log.answer.push(c),
      onFail: (t) => log.failA.push(t),
    },
    B.id,
    "4821"
  )
  const responder = new NearbyResponder(
    { self: B, secretFor: () => opts.bKey ?? null, crypto: webCrypto },
    { send: (m) => toA.push(opts.tamper ? opts.tamper(m) : m) },
    {
      onRequest: (r) => log.requests.push(r),
      onReady: (_r, s) => log.readyB.push(s),
      onOffer: (c) => log.offer.push(c),
      onFail: (t) => log.failB.push(t),
    }
  )
  async function pump() {
    for (let i = 0; i < 20 && (toA.length || toB.length); i++) {
      while (toB.length) await responder.onMessage(toB.shift()!)
      while (toA.length) await initiator.onMessage(toA.shift()!)
    }
  }
  return { initiator, responder, log, pump, toB }
}

describe("messages", () => {
  it("round-trips every kind", () => {
    const hex = "ab".repeat(16)
    const msgs: NearbyMsg[] = [
      { t: "req", id: A.id, name: "Laptop", pin: "0042", cnonce: hex },
      { t: "challenge", nonce: hex, proof: hex },
      { t: "proof", proof: hex },
      { t: "accept" },
      { t: "accept", secret: hex },
      { t: "decline" },
      { t: "offer", code: "glyph1:o:abc" },
      { t: "answer", code: "glyph1:a:abc" },
    ]
    for (const m of msgs) expect(parseNearby(encodeNearby(m))).toEqual(m)
  })

  it("rejects malformed messages", () => {
    for (const bad of [
      "",
      "nope",
      "[]",
      "{}",
      '{"t":"req","id":"x","name":"y","pin":"12","cnonce":"abababab"}',
      '{"t":"req","id":"x","name":"y","pin":"1234","cnonce":"zz"}',
      '{"t":"accept","secret":"not hex!"}',
      '{"t":"offer","code":""}',
      '{"t":"shout"}',
    ]) {
      expect(parseNearby(bad)).toBeNull()
    }
  })
})

describe("remembered devices", () => {
  it("keeps good entries and drops damaged ones", () => {
    const text = JSON.stringify({
      ok: { name: "Phone", secret: "ab".repeat(16) },
      noSecret: { name: "x" },
      badSecret: { name: "x", secret: "zzzz" },
      notObject: 5,
    })
    expect(Object.keys(parseTrusted(text))).toEqual(["ok"])
    expect(parseTrusted("not json")).toEqual({})
    expect(parseTrusted(null)).toEqual({})
    expect(parseTrusted("[1]")).toEqual({})
  })

  it("adds and removes without touching the original", () => {
    const base = withTrusted({}, "a", { name: "A", secret: "ab".repeat(8) })
    const more = withTrusted(base, "b", { name: "B", secret: "cd".repeat(8) })
    expect(Object.keys(base)).toEqual(["a"])
    expect(Object.keys(withoutTrusted(more, "a"))).toEqual(["b"])
    expect(Object.keys(more)).toEqual(["a", "b"])
  })
})

describe("randomPin", () => {
  it("is four digits", () => {
    for (let i = 0; i < 50; i++) expect(randomPin(webCrypto)).toMatch(/^\d{4}$/)
  })
})

describe("first pairing", () => {
  it("asks the responder's user, then both get the same new key", async () => {
    const t = pair({})
    t.initiator.start()
    await t.pump()
    expect(t.log.requests).toEqual([{ id: A.id, name: "Laptop", pin: "4821" }])
    expect(t.log.ready).toEqual([]) // nothing happens before the user agrees

    t.responder.approve()
    await t.pump()
    expect(t.log.ready).toHaveLength(1)
    expect(t.log.ready[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(t.log.readyB).toEqual(t.log.ready) // the same key on both sides
  })

  it("carries the offer and the answer after the agreement", async () => {
    const t = pair({})
    t.initiator.start()
    await t.pump()
    t.responder.approve()
    await t.pump()
    await t.responder.onMessage({ t: "offer", code: "glyph1:o:x" })
    expect(t.log.offer).toEqual(["glyph1:o:x"])
    await t.initiator.onMessage({ t: "answer", code: "glyph1:a:y" })
    expect(t.log.answer).toEqual(["glyph1:a:y"])
  })

  it("ignores an offer before the user agreed", async () => {
    const t = pair({})
    t.initiator.start()
    await t.pump()
    await t.responder.onMessage({ t: "offer", code: "glyph1:o:x" })
    expect(t.log.offer).toEqual([])
  })

  it("tells the initiator when the user says no", async () => {
    const t = pair({})
    t.initiator.start()
    await t.pump()
    t.responder.decline()
    await t.pump()
    expect(t.log.declined).toBe(1)
    expect(t.log.ready).toEqual([])
  })

  it("does not use an answer before the responder agreed", async () => {
    const t = pair({})
    t.initiator.start()
    await t.initiator.onMessage({ t: "answer", code: "glyph1:a:y" })
    expect(t.log.answer).toEqual([])
  })
})

describe("a remembered device", () => {
  const key = "ab".repeat(32)

  it("starts with no tap and no new key", async () => {
    const t = pair({ aKey: key, bKey: key })
    t.initiator.start()
    await t.pump()
    expect(t.log.requests).toEqual([])
    expect(t.log.ready).toEqual([null])
    expect(t.log.readyB).toEqual([null])
    expect(t.log.failA).toEqual([])
    expect(t.log.failB).toEqual([])
  })

  it("is refused when the two sides hold different keys", async () => {
    // The initiator checks the responder's proof first and stops there.
    const t = pair({ aKey: "cd".repeat(32), bKey: key })
    t.initiator.start()
    await t.pump()
    expect(t.log.ready).toEqual([])
    expect(t.log.readyB).toEqual([])
    expect(t.log.failA).toHaveLength(1)
  })

  it("is refused by the initiator when the responder cannot prove the key", async () => {
    // An impostor answers the challenge with a made-up proof.
    const t = pair({
      aKey: key,
      bKey: key,
      tamper: (m) =>
        m.t === "challenge" ? { ...m, proof: "00".repeat(32) } : m,
    })
    t.initiator.start()
    await t.pump()
    expect(t.log.ready).toEqual([])
    expect(t.log.failA).toHaveLength(1)
    expect(t.log.readyB).toEqual([])
  })

  it("does not trust a device that skips the challenge", async () => {
    // The initiator remembers B, but B shows a prompt as for a stranger.
    const t = pair({ aKey: key, bKey: null })
    t.initiator.start()
    await t.pump()
    t.responder.approve()
    await t.pump()
    expect(t.log.ready).toEqual([])
    expect(t.log.failA[0]).toMatch(/remembered on one side only/)
  })

  it("is refused by the initiator when the responder forgot it", async () => {
    // The responder challenges, but the initiator holds no key.
    const t = pair({ aKey: null, bKey: key })
    t.initiator.start()
    await t.pump()
    expect(t.log.ready).toEqual([])
    expect(t.log.failA[0]).toMatch(/remembered on one side only/)
  })

  it("rejects a replayed proof from an earlier attempt", async () => {
    const first = pair({ aKey: key, bKey: key })
    first.initiator.start()
    const req = first.toB[0]
    await first.pump()
    expect(first.log.readyB).toEqual([null])

    // A new attempt (new nonces) cannot be answered with the old messages.
    const second = pair({ aKey: key, bKey: key })
    await second.responder.onMessage(req)
    await second.responder.onMessage({ t: "proof", proof: "11".repeat(32) })
    expect(second.log.readyB).toEqual([])
    expect(second.log.failB).toHaveLength(1)
  })
})

describe("closing", () => {
  it("fails the initiator when the channel closes before the agreement", () => {
    const t = pair({})
    t.initiator.start()
    t.initiator.onClosed()
    expect(t.log.failA).toHaveLength(1)
  })

  it("does not fail after the agreement (the channel may close then)", async () => {
    const t = pair({})
    t.initiator.start()
    await t.pump()
    t.responder.approve()
    await t.pump()
    t.initiator.onClosed()
    expect(t.log.failA).toEqual([])
  })
})
