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
  planMessage,
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
  const counts = { decks: 2, notes: 3, cards: 3, reviews: 40 }

  it("round-trips every message", () => {
    expect(parseMessage(hiMessage("dev-1"))).toEqual({
      t: "hi",
      v: 2,
      device: "dev-1",
    })
    expect(parseMessage(planMessage("delta", 1))).toEqual({
      t: "plan",
      mode: "delta",
      round: 1,
    })
    expect(parseMessage(partMessage(1234))).toEqual({ t: "part", bytes: 1234 })
    expect(parseMessage(endMessage(7))).toEqual({ t: "end", parts: 7 })
    expect(parseMessage(okMessage(counts))).toEqual({ t: "ok", counts })
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
      '{"t":"ok","counts":{"decks":1,"notes":1,"cards":1}}',
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
