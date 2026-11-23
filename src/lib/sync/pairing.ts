import { base64ToBytes, bytesToBase64 } from "@/lib/image"

/**
 * Pairing codes: the one-off text two devices swap (copied on one, pasted on
 * the other) so they can open a direct WebRTC connection without any server. A code
 * is `glyph1:<o|a>:<base64 of the deflated session description>`; `o` is the
 * offer from the device that starts, `a` the answer from the one that joins.
 * Pure apart from `CompressionStream`, which browsers and Node both have.
 */

export type PairingKind = "offer" | "answer"

const PREFIX = "glyph1"
const KIND_TAG: Record<PairingKind, string> = { offer: "o", answer: "a" }

/** A session description is a few hundred bytes of ASCII; refuse anything big. */
const MAX_SDP_CHARS = 20_000

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function encodePairing(
  kind: PairingKind,
  sdp: string
): Promise<string> {
  const packed = await pipe(
    new TextEncoder().encode(sdp),
    new CompressionStream("deflate-raw")
  )
  return `${PREFIX}:${KIND_TAG[kind]}:${bytesToBase64(packed)}`
}

export type DecodedPairing =
  { ok: true; kind: PairingKind; sdp: string } | { ok: false; error: string }

/** Reads a code typed or pasted. Never throws. */
export async function decodePairing(text: string): Promise<DecodedPairing> {
  // Pasting often adds spaces or line breaks.
  const parts = text.replace(/\s+/g, "").split(":")
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, error: "That is not a Glyph pairing code." }
  }
  const kind: PairingKind | null =
    parts[1] === KIND_TAG.offer
      ? "offer"
      : parts[1] === KIND_TAG.answer
        ? "answer"
        : null
  if (kind === null || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[2])) {
    return { ok: false, error: "That pairing code is damaged." }
  }
  try {
    const bytes = await pipe(
      base64ToBytes(parts[2]),
      new DecompressionStream("deflate-raw")
    )
    const sdp = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    if (sdp.length > MAX_SDP_CHARS || !sdp.startsWith("v=0")) {
      return { ok: false, error: "That pairing code is damaged." }
    }
    return { ok: true, kind, sdp }
  } catch {
    return { ok: false, error: "That pairing code is damaged." }
  }
}
