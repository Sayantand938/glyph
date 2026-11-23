import { parseDigests, type SyncDigests } from "./delta"

/**
 * The wire format of a sync, over one ordered WebRTC data channel. Both devices
 * talk at once.
 *
 *   hi    each device says who it is (a random id kept on the device)
 *   plan  a round starts: `delta` (only rows changed since the last sync) or
 *         `full` (everything); `round` 1 is the first, 2 the repeat after a
 *         mismatch
 *   part  `bytes` of JSON follow as binary chunks: one part of a backup (see
 *         `readBackupParts`); a round is any number of parts, each merged as it
 *         arrives, so no message or buffer is ever as big as the whole data
 *   end   the round has no more parts; `parts` is how many were sent
 *   ok    every part of the other device's round is merged; `digests` are this
 *         device's fingerprints then (per table, the row count and a hash of
 *         every row's id and change stamp), which must equal the other's
 *   ping  "still here": sent every few seconds by both devices, so a quiet
 *         connection means the other device is gone (asleep, out of wifi), not
 *         just busy merging
 *   fail  something went wrong
 */

/**
 * Version 3 compares digests at the end; version 2 compared row counts and
 * version 1 sent one whole backup. Older versions are refused with a message.
 */
export const SYNC_VERSION = 3

/** Small enough for every browser's data channel (the interoperable limit is 16 KiB). */
export const CHUNK_BYTES = 16 * 1024

export type SyncMode = "delta" | "full"

export type SyncMessage =
  | { t: "hi"; v: number; device: string }
  | { t: "plan"; mode: SyncMode; round: number }
  | { t: "part"; bytes: number }
  | { t: "end"; parts: number }
  | { t: "ok"; digests: SyncDigests }
  | { t: "ping" }
  | { t: "fail"; reason: string }

export function hiMessage(device: string): string {
  return JSON.stringify({ t: "hi", v: SYNC_VERSION, device })
}

export function planMessage(mode: SyncMode, round: number): string {
  return JSON.stringify({ t: "plan", mode, round })
}

export function partMessage(bytes: number): string {
  return JSON.stringify({ t: "part", bytes })
}

export function endMessage(parts: number): string {
  return JSON.stringify({ t: "end", parts })
}

export function okMessage(digests: SyncDigests): string {
  return JSON.stringify({ t: "ok", digests })
}

export function pingMessage(): string {
  return JSON.stringify({ t: "ping" })
}

export function failMessage(reason: string): string {
  return JSON.stringify({ t: "fail", reason })
}

const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0

/** Reads a control message from the other device; null if it is not one we know. */
export function parseMessage(text: string): SyncMessage | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null) return null
  const m = data as Record<string, unknown>
  switch (m.t) {
    case "hi":
      return typeof m.v === "number" &&
        typeof m.device === "string" &&
        m.device.length >= 1 &&
        m.device.length <= 80
        ? { t: "hi", v: m.v, device: m.device }
        : null
    case "plan":
      return (m.mode === "delta" || m.mode === "full") &&
        isCount(m.round) &&
        m.round >= 1
        ? { t: "plan", mode: m.mode, round: m.round }
        : null
    case "part":
      return isCount(m.bytes) ? { t: "part", bytes: m.bytes } : null
    case "end":
      return isCount(m.parts) ? { t: "end", parts: m.parts } : null
    case "ok": {
      const digests = parseDigests(m.digests)
      return digests ? { t: "ok", digests } : null
    }
    case "ping":
      return { t: "ping" }
    case "fail":
      return {
        t: "fail",
        reason: typeof m.reason === "string" ? m.reason.slice(0, 200) : "",
      }
    default:
      return null
  }
}

/** Cuts bytes into chunks that are views of the same buffer (no copy). */
export function splitChunks(
  bytes: Uint8Array,
  size = CHUNK_BYTES
): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, i + size))
  }
  return chunks
}

export type PushResult =
  | { status: "more" }
  | { status: "done"; bytes: Uint8Array }
  | { status: "error"; error: string }

/**
 * Collects the chunks of one backup. `bytes` is what the `hello` promised; more
 * data than that is an error. There is no size cap: a backup grows with every
 * review and must always be able to sync. Only what this device cannot hold is
 * refused (the allocation fails), as an error rather than a crash.
 */
export class Reassembler {
  private readonly buffer: Uint8Array
  private filled = 0

  private constructor(private readonly total: number) {
    this.buffer = new Uint8Array(total)
  }

  static begin(total: number): Reassembler | { error: string } {
    try {
      return new Reassembler(total)
    } catch {
      return {
        error:
          "This device does not have enough memory to receive the other device's data.",
      }
    }
  }

  /** True once nothing more is expected (an empty backup is complete at once). */
  get complete(): boolean {
    return this.filled === this.total
  }

  push(chunk: Uint8Array): PushResult {
    if (this.filled + chunk.length > this.total) {
      return { status: "error", error: "The other device sent too much data." }
    }
    this.buffer.set(chunk, this.filled)
    this.filled += chunk.length
    return this.complete
      ? { status: "done", bytes: this.buffer }
      : { status: "more" }
  }
}
