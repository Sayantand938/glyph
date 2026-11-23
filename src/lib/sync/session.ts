/**
 * One sync between two devices, as a state machine with no DB, no React and no
 * WebRTC (those are `deps` and `io`), so the whole protocol is unit-tested with
 * two fake devices wired together.
 *
 * Both devices run the same code at once:
 *   1. say hi (a random device id and the protocol version);
 *   2. send a round: `delta` (rows changed since the last complete sync with this
 *      device) or, with no usable mark, `full`; a round is a list of parts;
 *   3. merge the other device's parts as they arrive, then answer `ok` with this
 *      device's digests (per table, the row count and a hash of every row's id
 *      and change stamp);
 *   4. when both digests are known they must match: then the sync is complete
 *      and the mark for the other device is set; if not, and a `delta` was
 *      involved, both repeat as a `full` round once (self-healing); otherwise it
 *      fails and names the tables that differ.
 * The mark is only set after that check, so a bad mark can cost one full sync
 * but never lets two devices silently drift apart.
 *
 * Both devices also ping each other every few seconds; one that hears nothing
 * for `STALL_MS` gives up with a clear message instead of waiting forever (the
 * other device went to sleep or off the wifi).
 */
import {
  DIGEST_LABELS,
  deltaSince,
  differingTables,
  type SyncDigests,
} from "./delta"
import {
  Reassembler,
  SYNC_VERSION,
  endMessage,
  failMessage,
  hiMessage,
  okMessage,
  parseMessage,
  partMessage,
  pingMessage,
  planMessage,
  splitChunks,
  type SyncMode,
} from "./protocol"

export interface SyncDeps<Stats> {
  /** This device's id (stable, random, kept on the device). */
  deviceId: string
  now(): number
  /** When the last complete sync with `peer` started, or null. */
  markFor(peer: string): number | null
  setMark(peer: string, at: number): void
  /**
   * The JSON text of each part of a backup to send: rows changed after `since`,
   * or everything when `since` is null. Parts must be small and self-contained
   * (see `readBackupParts`).
   */
  parts(since: number | null): AsyncIterable<string>
  /** Parses and merges one received part. Throws an Error with a readable message. */
  merge(text: string): Promise<Stats>
  emptyStats(): Stats
  addStats(a: Stats, b: Stats): Stats
  /** Fingerprints this device's data, once the other device's round is merged. */
  digests(): Promise<SyncDigests>
  /**
   * Calls `fn` every `ms` until the returned function is called. Defaults to
   * `setInterval`; tests pass a fake.
   */
  every?(fn: () => void, ms: number): () => void
  /** How long a silent connection is tolerated (`STALL_MS` if absent; 0 = forever). */
  stallMs?: number
}

/** A connection that stays silent this long (ms) is declared dead. */
export const STALL_MS = 30_000
/** The silence is counted in this many ticks; a ping goes out on each. */
const STALL_TICKS = 6

export interface SyncIO {
  sendText(text: string): void
  sendChunks(chunks: Uint8Array[]): Promise<void>
}

export interface SyncProgress {
  mode: SyncMode
  round: number
  sentParts: number
  receivedParts: number
}

export interface SyncEvents<Stats> {
  onProgress?(progress: SyncProgress): void
  onDone(
    stats: Stats,
    info: { rounds: number; modes: SyncMode[]; peer: string }
  ): void
  /** The sync is over, failed. `peerTold`: the other device was sent the reason. */
  onFail(message: string, peerTold: boolean): void
}

interface Incoming {
  round: number
  mode: SyncMode
  reassembler: Reassembler | null
  merged: number
  /** Chain of merges, so parts are merged one at a time, in order. */
  chain: Promise<void>
}

const encoder = new TextEncoder()

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export class SyncSession<Stats> {
  private peer: string | null = null
  private startedAt = 0
  private over = false
  private round = 0
  private ourMode: SyncMode = "full"
  private incoming: Incoming | null = null
  private sentParts = 0
  private ourOk: { round: number; digests: SyncDigests } | null = null
  private peerOk: { round: number; digests: SyncDigests } | null = null
  private stopTicking: (() => void) | null = null
  /** Ticks since anything arrived from the other device. */
  private quietTicks = 0
  private stats: Stats
  private readonly modes: SyncMode[] = []

  constructor(
    private readonly io: SyncIO,
    private readonly deps: SyncDeps<Stats>,
    private readonly events: SyncEvents<Stats>
  ) {
    this.stats = deps.emptyStats()
  }

  /** Call when the connection is open. */
  start(): void {
    this.io.sendText(hiMessage(this.deps.deviceId))
    this.startWatchdog()
  }

  /** The connection ended (or never opened). Later events are ignored. */
  stop(): void {
    this.end()
  }

  private end(): void {
    this.over = true
    this.stopTicking?.()
    this.stopTicking = null
  }

  /**
   * Pings the other device on every tick and gives up when nothing at all has
   * arrived from it for `STALL_TICKS` ticks. Anything received counts (a part, a
   * ping, an `ok`), so a big slow sync never trips it while the other device
   * keeps answering, and a device busy merging keeps the line alive by pinging.
   */
  private startWatchdog(): void {
    const stallMs = this.deps.stallMs ?? STALL_MS
    if (stallMs <= 0 || this.over) return
    const every =
      this.deps.every ??
      ((fn: () => void, ms: number) => {
        const id = setInterval(fn, ms)
        return () => clearInterval(id)
      })
    this.stopTicking = every(
      () => {
        if (this.over) return
        this.quietTicks += 1
        if (this.quietTicks >= STALL_TICKS) {
          const seconds = Math.round(stallMs / 1000)
          return this.fail(
            `The other device has not answered for ${seconds} seconds. It may have gone to sleep, lost the wifi or closed Glyph. Keep both screens on and try again; what arrived is already saved.`,
            true
          )
        }
        try {
          this.io.sendText(pingMessage())
        } catch {
          // The connection is gone; the silence will say so.
        }
      },
      Math.max(1, Math.round(stallMs / STALL_TICKS))
    )
  }

  get finished(): boolean {
    return this.over
  }

  onText(text: string): void {
    if (this.over) return
    this.quietTicks = 0
    const m = parseMessage(text)
    if (!m) return
    switch (m.t) {
      case "ping":
        return
      case "hi":
        return this.onHi(m.v, m.device)
      case "plan":
        this.incoming = {
          round: m.round,
          mode: m.mode,
          reassembler: null,
          merged: 0,
          chain: Promise.resolve(),
        }
        return
      case "part":
        return this.onPart(m.bytes)
      case "end":
        return this.onEnd(m.parts)
      case "ok":
        if (!this.incoming) return
        this.peerOk = { round: this.incoming.round, digests: m.digests }
        void this.evaluate()
        return
      case "fail":
        this.end()
        this.events.onFail(
          m.reason
            ? `The other device stopped the sync: ${m.reason}`
            : "The other device stopped the sync.",
          false
        )
    }
  }

  onBinary(data: Uint8Array): void {
    if (this.over) return
    this.quietTicks = 0
    const inc = this.incoming
    if (!inc?.reassembler) {
      return this.fail("Unexpected data from the other device.", true)
    }
    const pushed = inc.reassembler.push(data)
    if (pushed.status === "error") return this.fail(pushed.error, true)
    if (pushed.status === "done") {
      inc.reassembler = null
      this.enqueue(inc, pushed.bytes)
    }
  }

  private onHi(version: number, device: string): void {
    if (this.peer !== null) {
      return this.fail("The other device started twice.", true)
    }
    if (version !== SYNC_VERSION) {
      return this.fail(
        "The other device runs a different version of Glyph. Update both and try again.",
        true
      )
    }
    if (device === this.deps.deviceId) {
      return this.fail(
        "Both are the same device (they share the same stored data), so there is nothing to sync.",
        true
      )
    }
    this.peer = device
    this.startedAt = this.deps.now()
    void this.sendRound(1)
  }

  private onPart(bytes: number): void {
    const inc = this.incoming
    if (!inc) return this.fail("Unexpected data from the other device.", true)
    if (inc.reassembler) {
      return this.fail("The other device sent a part inside a part.", true)
    }
    const begun = Reassembler.begin(bytes)
    if ("error" in begun) return this.fail(begun.error, true)
    if (begun.complete) {
      this.enqueue(inc, new Uint8Array())
      return
    }
    inc.reassembler = begun
  }

  private onEnd(parts: number): void {
    const inc = this.incoming
    if (!inc) return this.fail("Unexpected data from the other device.", true)
    inc.chain = inc.chain.then(async () => {
      if (this.over) return
      if (inc.reassembler || inc.merged !== parts) {
        return this.fail("The other device's data was incomplete.", true)
      }
      const digests = await this.deps.digests()
      if (this.over) return
      this.ourOk = { round: inc.round, digests }
      this.io.sendText(okMessage(digests))
      void this.evaluate()
    })
    inc.chain = inc.chain.catch((error: unknown) =>
      this.fail(messageOf(error, "Could not finish the sync."), true)
    )
  }

  /** Merges one received part after the ones before it. */
  private enqueue(inc: Incoming, bytes: Uint8Array): void {
    inc.chain = inc.chain
      .then(async () => {
        if (this.over) return
        if (bytes.length > 0) {
          const stats = await this.deps.merge(new TextDecoder().decode(bytes))
          this.stats = this.deps.addStats(this.stats, stats)
        }
        inc.merged += 1
        this.progress()
      })
      .catch((error: unknown) =>
        this.fail(
          messageOf(error, "Could not save the other device's data."),
          true
        )
      )
  }

  /** When both devices' counts for the same round are known: finish or repeat. */
  private async evaluate(): Promise<void> {
    const ours = this.ourOk
    const theirs = this.peerOk
    const inc = this.incoming
    if (this.over || !ours || !theirs || !inc || !this.peer) return
    if (ours.round !== theirs.round || ours.round !== this.round) return
    this.ourOk = null
    this.peerOk = null

    const differing = differingTables(ours.digests, theirs.digests)
    if (differing.length === 0) {
      this.deps.setMark(this.peer, this.startedAt)
      this.end()
      this.events.onDone(this.stats, {
        rounds: this.round,
        modes: this.modes,
        peer: this.peer,
      })
      return
    }
    // Something was missed (a bad mark, a row that came by way of a third device
    // or a restored backup, a picture that never arrived). Both sides see the
    // same digests, so both repeat in full, once.
    if (
      this.round === 1 &&
      (this.ourMode === "delta" || inc.mode === "delta")
    ) {
      await this.sendRound(2)
      return
    }
    const names = differing.map((table) => DIGEST_LABELS[table]).join(", ")
    this.fail(
      `The two devices still differ in ${names} after a full sync. Their data is merged as far as possible. If you studied or edited on either device during the sync, try again; if it keeps happening, restore a backup on the device that is missing data.`,
      true
    )
  }

  /** Sends this device's side of a round. Round 1 is a delta if a mark allows. */
  private async sendRound(round: number): Promise<void> {
    const peer = this.peer
    if (peer === null) return
    this.round = round
    this.sentParts = 0
    const since = round === 1 ? deltaSince(this.deps.markFor(peer)) : null
    this.ourMode = since === null ? "full" : "delta"
    this.modes.push(this.ourMode)
    try {
      this.io.sendText(planMessage(this.ourMode, round))
      for await (const text of this.deps.parts(since)) {
        if (this.over) return
        const bytes = encoder.encode(text)
        this.io.sendText(partMessage(bytes.length))
        await this.io.sendChunks(splitChunks(bytes))
        this.sentParts += 1
        this.progress()
      }
      if (this.over) return
      this.io.sendText(endMessage(this.sentParts))
    } catch (error) {
      this.fail(messageOf(error, "Could not send this device's data."), false)
    }
  }

  private progress(): void {
    this.events.onProgress?.({
      mode: this.ourMode,
      round: this.round,
      sentParts: this.sentParts,
      receivedParts: this.incoming?.merged ?? 0,
    })
  }

  private fail(message: string, tellPeer: boolean): void {
    if (this.over) return
    this.end()
    if (tellPeer) {
      try {
        this.io.sendText(failMessage(message))
      } catch {
        // Already disconnected: nobody to tell.
      }
    }
    this.events.onFail(message, tellPeer)
  }
}
