/**
 * Pairing two devices that found each other on the local network (the finding
 * and the message channel are `src-tauri/src/discovery.rs`; this file is only
 * the conversation, with no DOM, Tauri or database).
 *
 * It replaces the two pasted codes: the device that picks the other one (the
 * initiator) asks, the other one (the responder) agrees, and then the usual
 * WebRTC offer and reply codes travel over the same channel as `offer` and
 * `answer` messages. What happens after that is unchanged.
 *
 * First time: the initiator shows a 4-digit number, the responder shows the
 * same number and the name of who is asking, and its user taps Accept. Both
 * devices then keep a shared key. Next time: the responder sends a challenge,
 * each side proves it holds the key (HMAC over both sides' random values), and
 * the sync starts with no tap. A fake device cannot answer the challenge, and
 * a fake "trusted" device cannot pass the initiator's check either.
 */

export type NearbyMsg =
  | { t: "req"; id: string; name: string; pin: string; cnonce: string }
  | { t: "challenge"; nonce: string; proof: string }
  | { t: "proof"; proof: string }
  | { t: "accept"; secret?: string }
  | { t: "decline" }
  | { t: "offer"; code: string }
  | { t: "answer"; code: string }

const MAX_TEXT = 200_000
const HEX = /^[0-9a-f]{8,128}$/

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null
}

/** Reads one message; anything malformed is `null`. */
export function parseNearby(text: string): NearbyMsg | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const m = raw as Record<string, unknown>
  switch (m.t) {
    case "req": {
      const id = str(m.id, 80)
      const name = str(m.name, 80)
      const pin =
        typeof m.pin === "string" && /^\d{4}$/.test(m.pin) ? m.pin : null
      const cnonce =
        typeof m.cnonce === "string" && HEX.test(m.cnonce) ? m.cnonce : null
      return id && name && pin && cnonce
        ? { t: "req", id, name, pin, cnonce }
        : null
    }
    case "challenge": {
      const nonce =
        typeof m.nonce === "string" && HEX.test(m.nonce) ? m.nonce : null
      const proof =
        typeof m.proof === "string" && HEX.test(m.proof) ? m.proof : null
      return nonce && proof ? { t: "challenge", nonce, proof } : null
    }
    case "proof": {
      const proof =
        typeof m.proof === "string" && HEX.test(m.proof) ? m.proof : null
      return proof ? { t: "proof", proof } : null
    }
    case "accept": {
      if (m.secret === undefined) return { t: "accept" }
      const secret =
        typeof m.secret === "string" && HEX.test(m.secret) ? m.secret : null
      return secret ? { t: "accept", secret } : null
    }
    case "decline":
      return { t: "decline" }
    case "offer":
    case "answer": {
      const code = str(m.code, MAX_TEXT)
      return code ? { t: m.t, code } : null
    }
    default:
      return null
  }
}

export function encodeNearby(msg: NearbyMsg): string {
  return JSON.stringify(msg)
}

// --- Remembered devices ----------------------------------------------------

export interface TrustedDevice {
  name: string
  secret: string
}
export type TrustedDevices = Record<string, TrustedDevice>

/** Reads the stored list; damaged entries are dropped. */
export function parseTrusted(text: string | null): TrustedDevices {
  if (!text) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: TrustedDevices = {}
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue
    const v = value as Record<string, unknown>
    if (
      typeof v.name === "string" &&
      typeof v.secret === "string" &&
      HEX.test(v.secret)
    ) {
      out[id] = { name: v.name, secret: v.secret }
    }
  }
  return out
}

export function withTrusted(
  list: TrustedDevices,
  id: string,
  device: TrustedDevice
): TrustedDevices {
  return { ...list, [id]: device }
}

export function withoutTrusted(
  list: TrustedDevices,
  id: string
): TrustedDevices {
  const next = { ...list }
  delete next[id]
  return next
}

// --- Crypto ----------------------------------------------------------------

export interface NearbyCrypto {
  /** HMAC-SHA-256 of `message` with `secret`, as lowercase hex. */
  hmac(secret: string, message: string): Promise<string>
  /** `bytes` random bytes as lowercase hex. */
  randomHex(bytes: number): string
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** The real thing, on the platform's Web Crypto (browsers, the Tauri webview, Node). */
export const webCrypto: NearbyCrypto = {
  async hmac(secret, message) {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
    return toHex(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))
    )
  },
  randomHex(bytes) {
    return toHex(crypto.getRandomValues(new Uint8Array(bytes)))
  },
}

/** A 4-digit confirm number. */
export function randomPin(c: NearbyCrypto): string {
  return String(parseInt(c.randomHex(4), 16) % 10_000).padStart(4, "0")
}

/** What one side signs; `role` keeps the two proofs from being swapped. */
function proofText(role: "r" | "i", cnonce: string, rnonce: string): string {
  return `${role}:${cnonce}:${rnonce}`
}

// --- The two sides -----------------------------------------------------------

export interface NearbyDeps {
  self: { id: string; name: string }
  /** The shared key of a remembered device, or null. */
  secretFor: (peerId: string) => string | null
  crypto: NearbyCrypto
}

export interface NearbyIO {
  send: (msg: NearbyMsg) => void
}

export interface InitiatorEvents {
  /**
   * The other device agreed: create the WebRTC offer and send it. `newSecret`
   * is a key to remember for this device (a first pairing), else null.
   */
  onReady: (newSecret: string | null) => void
  /** The other device's user said no. */
  onDeclined: () => void
  /** The other device sent its reply code. */
  onAnswer: (code: string) => void
  onFail: (text: string) => void
}

const FORGOTTEN =
  "That device is remembered on one side only. Remove it from the paired list on both devices and pair again."

/** The device whose user picked the other one from the list. */
export class NearbyInitiator {
  private stage: "idle" | "waiting" | "proven" | "ready" | "over" = "idle"
  private readonly cnonce: string

  constructor(
    private readonly deps: NearbyDeps,
    private readonly io: NearbyIO,
    private readonly events: InitiatorEvents,
    private readonly peerId: string,
    /** The number both screens show. */
    readonly pin: string
  ) {
    this.cnonce = deps.crypto.randomHex(16)
  }

  /** Sends the request. */
  start(): void {
    if (this.stage !== "idle") return
    this.stage = "waiting"
    this.io.send({
      t: "req",
      id: this.deps.self.id,
      name: this.deps.self.name,
      pin: this.pin,
      cnonce: this.cnonce,
    })
  }

  private fail(text: string) {
    if (this.stage === "over") return
    this.stage = "over"
    this.events.onFail(text)
  }

  async onMessage(msg: NearbyMsg): Promise<void> {
    if (this.stage === "over") return
    const secret = this.deps.secretFor(this.peerId)
    switch (msg.t) {
      case "challenge": {
        if (this.stage !== "waiting") return
        if (!secret) return this.fail(FORGOTTEN)
        const expected = await this.deps.crypto.hmac(
          secret,
          proofText("r", this.cnonce, msg.nonce)
        )
        if (expected !== msg.proof) {
          return this.fail(
            "The other device could not prove it is the one you paired with."
          )
        }
        this.stage = "proven"
        this.io.send({
          t: "proof",
          proof: await this.deps.crypto.hmac(
            secret,
            proofText("i", this.cnonce, msg.nonce)
          ),
        })
        return
      }
      case "accept": {
        if (this.stage === "proven") {
          this.stage = "ready"
          return this.events.onReady(null)
        }
        if (this.stage !== "waiting") return
        // A first pairing; but if this side remembers it, the other side forgot.
        if (secret) return this.fail(FORGOTTEN)
        this.stage = "ready"
        return this.events.onReady(msg.secret ?? null)
      }
      case "decline":
        this.stage = "over"
        return this.events.onDeclined()
      case "answer":
        if (this.stage !== "ready") return
        return this.events.onAnswer(msg.code)
      default:
        return
    }
  }

  /** The connection ended. */
  onClosed(): void {
    if (this.stage === "ready" || this.stage === "over") return
    this.fail("The other device closed the connection.")
  }
}

export interface Request {
  id: string
  name: string
  pin: string
}

export interface ResponderEvents {
  /** An unknown device asks: show its name and number, then `approve` or `decline`. */
  onRequest: (request: Request) => void
  /** The device is agreed (by the user, or by proof of the shared key). */
  onReady: (request: Request, newSecret: string | null) => void
  /** The initiator's offer code arrived; answer it. */
  onOffer: (code: string) => void
  onFail: (text: string) => void
}

/** The device that was picked. */
export class NearbyResponder {
  private stage: "idle" | "asking" | "challenged" | "ready" | "over" = "idle"
  private request: Request | null = null
  private cnonce = ""
  private nonce = ""
  private secret: string | null = null

  constructor(
    private readonly deps: NearbyDeps,
    private readonly io: NearbyIO,
    private readonly events: ResponderEvents
  ) {}

  private fail(text: string) {
    if (this.stage === "over") return
    this.stage = "over"
    this.events.onFail(text)
  }

  async onMessage(msg: NearbyMsg): Promise<void> {
    if (this.stage === "over") return
    switch (msg.t) {
      case "req": {
        if (this.stage !== "idle") return
        this.request = { id: msg.id, name: msg.name, pin: msg.pin }
        this.cnonce = msg.cnonce
        const secret = this.deps.secretFor(msg.id)
        if (secret) {
          this.secret = secret
          this.nonce = this.deps.crypto.randomHex(16)
          this.stage = "challenged"
          this.io.send({
            t: "challenge",
            nonce: this.nonce,
            proof: await this.deps.crypto.hmac(
              secret,
              proofText("r", this.cnonce, this.nonce)
            ),
          })
          return
        }
        this.stage = "asking"
        return this.events.onRequest(this.request)
      }
      case "proof": {
        if (this.stage !== "challenged" || !this.secret || !this.request) return
        const expected = await this.deps.crypto.hmac(
          this.secret,
          proofText("i", this.cnonce, this.nonce)
        )
        if (expected !== msg.proof) {
          this.io.send({ t: "decline" })
          return this.fail(
            "A device claiming to be one you paired with could not prove it."
          )
        }
        this.stage = "ready"
        this.io.send({ t: "accept" })
        return this.events.onReady(this.request, null)
      }
      case "offer":
        if (this.stage !== "ready") return
        return this.events.onOffer(msg.code)
      default:
        return
    }
  }

  /** The user accepted a first-time request. */
  approve(): void {
    if (this.stage !== "asking" || !this.request) return
    const secret = this.deps.crypto.randomHex(32)
    this.stage = "ready"
    this.io.send({ t: "accept", secret })
    this.events.onReady(this.request, secret)
  }

  /** The user said no. */
  decline(): void {
    if (this.stage === "over") return
    this.stage = "over"
    this.io.send({ t: "decline" })
  }

  /** The connection ended. */
  onClosed(): void {
    if (this.stage === "ready" || this.stage === "over") return
    this.fail("The other device closed the connection.")
  }
}
