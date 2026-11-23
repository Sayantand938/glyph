import { MAX_BACKUP_BYTES } from "@/lib/backup"

/**
 * The wire format of a sync, over one ordered WebRTC data channel. Each side
 * sends its whole backup as bytes: a `hello` text message with the byte count,
 * then binary chunks. The receiver merges it and answers `ok` (or `fail`).
 * Both directions run at once; the sync is finished when a device has merged
 * the other's backup and received the other's `ok`.
 */

/** Small enough for every browser's data channel (the interoperable limit is 16 KiB). */
export const CHUNK_BYTES = 16 * 1024

export type SyncMessage =
  | { t: "hello"; v: 1; bytes: number }
  | { t: "ok" }
  | { t: "fail"; reason: string }

export function helloMessage(bytes: number): string {
  return JSON.stringify({ t: "hello", v: 1, bytes })
}

export const OK_MESSAGE = JSON.stringify({ t: "ok" })

export function failMessage(reason: string): string {
  return JSON.stringify({ t: "fail", reason })
}

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
  if (m.t === "ok") return { t: "ok" }
  if (m.t === "fail") {
    return {
      t: "fail",
      reason: typeof m.reason === "string" ? m.reason.slice(0, 200) : "",
    }
  }
  if (
    m.t === "hello" &&
    m.v === 1 &&
    typeof m.bytes === "number" &&
    Number.isInteger(m.bytes) &&
    m.bytes >= 0
  ) {
    return { t: "hello", v: 1, bytes: m.bytes }
  }
  return null
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
 * data than that, or a promise above the backup size cap, is an error (the
 * other device is broken or hostile, and memory must not grow unbounded).
 */
export class Reassembler {
  private readonly buffer: Uint8Array
  private filled = 0

  private constructor(private readonly total: number) {
    this.buffer = new Uint8Array(total)
  }

  static begin(
    total: number,
    max = MAX_BACKUP_BYTES
  ): Reassembler | { error: string } {
    if (total > max) return { error: "The other device's data is too large." }
    return new Reassembler(total)
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
