/**
 * Why two devices may fail to connect, read from the session descriptions in
 * the pairing codes. Pure (text in, text out).
 *
 * Each code carries the sender's candidate addresses (`a=candidate:` lines).
 * With no ICE servers (the default; nothing leaves the network) a connection
 * needs the devices to reach each other's addresses directly. That fails on a
 * guest network that isolates clients, between two different networks, when a
 * VPN takes over the routes, or when a browser hides its address behind a
 * `.local` name and the network does not carry multicast DNS. This module tells
 * those cases apart as far as the descriptions allow, so the error says what to
 * try instead of "could not connect".
 */

export type AddressKind =
  | "mdns"
  | "private"
  | "shared"
  | "link-local"
  | "loopback"
  | "public"
  | "ipv6-link-local"
  | "ipv6-private"
  | "ipv6-public"
  | "unknown"

export interface Candidate {
  protocol: string
  address: string
  port: number
  /** `host`, `srflx` (seen from a STUN server), `prflx` or `relay`. */
  type: string
  kind: AddressKind
}

/** The kind of an address as written in a candidate line. */
export function classifyAddress(address: string): AddressKind {
  const a = address.toLowerCase()
  if (a.endsWith(".local")) return "mdns"
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a)
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])]
    if ([x, y, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) {
      return "unknown"
    }
    if (x === 127) return "loopback"
    if (x === 10) return "private"
    if (x === 172 && y >= 16 && y <= 31) return "private"
    if (x === 192 && y === 168) return "private"
    if (x === 169 && y === 254) return "link-local"
    if (x === 100 && y >= 64 && y <= 127) return "shared"
    return "public"
  }
  if (a.includes(":")) {
    if (a === "::1") return "loopback"
    if (a.startsWith("fe80:")) return "ipv6-link-local"
    if (a.startsWith("fc") || a.startsWith("fd")) return "ipv6-private"
    return "ipv6-public"
  }
  return "unknown"
}

/** The candidates in a session description. */
export function parseCandidates(sdp: string): Candidate[] {
  const found: Candidate[] = []
  for (const line of sdp.split(/\r?\n/)) {
    const match = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\S+)/i.exec(
      line.trim()
    )
    if (!match) continue
    found.push({
      protocol: match[1].toLowerCase(),
      address: match[2],
      port: Number(match[3]),
      type: match[4].toLowerCase(),
      kind: classifyAddress(match[2]),
    })
  }
  return found
}

export interface Analysis {
  candidates: Candidate[]
  /** No address at all: the device is offline, or the browser blocked WebRTC. */
  none: boolean
  /** Every address is a `.local` name (the browser hides the real ones). */
  mdnsOnly: boolean
  /** Only loopback or link-local addresses: not reachable from another device. */
  unreachableOnly: boolean
  /** An address from a server (STUN) or a relay is present. */
  hasServerAddress: boolean
  /** Private IPv4 addresses, like "192.168.1.20". */
  privateV4: string[]
}

export function analyzeSdp(sdp: string): Analysis {
  const candidates = parseCandidates(sdp)
  const reachable = candidates.filter(
    (c) => c.kind !== "loopback" && c.kind !== "link-local"
  )
  const hasServerAddress = candidates.some(
    (c) => c.type === "srflx" || c.type === "relay"
  )
  return {
    candidates,
    none: candidates.length === 0,
    mdnsOnly:
      candidates.length > 0 &&
      !hasServerAddress &&
      candidates.every((c) => c.kind === "mdns"),
    unreachableOnly: candidates.length > 0 && reachable.length === 0,
    hasServerAddress,
    privateV4: [
      ...new Set(
        candidates.filter((c) => c.kind === "private").map((c) => c.address)
      ),
    ],
  }
}

/** The first three parts of an IPv4 address ("192.168.1"), or its first two. */
function prefix(address: string, parts: 2 | 3): string {
  return address.split(".").slice(0, parts).join(".")
}

/** A one-line description of what a device found, for the details list. */
export function describeAnalysis(a: Analysis): string {
  if (a.none) return "no network address found"
  const types = new Set(a.candidates.map((c) => c.kind))
  const parts: string[] = []
  if (a.privateV4.length > 0)
    parts.push(`local address ${a.privateV4.join(", ")}`)
  if (types.has("mdns")) parts.push("address hidden behind a .local name")
  if (types.has("ipv6-private") || types.has("ipv6-public")) parts.push("IPv6")
  if (types.has("shared")) parts.push("shared (carrier-grade) address")
  if (a.hasServerAddress) parts.push("address seen by a STUN server")
  if (parts.length === 0)
    parts.push("only addresses other devices cannot reach")
  return parts.join(", ")
}

/**
 * A warning to show as soon as this device has made its code, when the code
 * itself already shows the connection cannot work; null when it looks fine.
 */
export function codeWarning(a: Analysis): string | null {
  if (a.none) {
    return "This device found no network address, so no other device can reach it. Check that wifi or ethernet is on and that the browser is allowed to use WebRTC, then start again."
  }
  if (a.unreachableOnly) {
    return "This device only found addresses that other devices cannot reach (it may be offline, or a VPN is taking over the network). Turn off the VPN and start again."
  }
  return null
}

export type Verdict = "likely" | "unknown" | "unlikely"

export interface Comparison {
  verdict: Verdict
  /** Why, in a sentence, or null when there is nothing to say. */
  reason: string | null
}

/** Whether two devices can probably reach each other, from both descriptions. */
export function comparePeers(mine: Analysis, theirs: Analysis): Comparison {
  if (mine.none || theirs.none) {
    return {
      verdict: "unlikely",
      reason: `${mine.none ? "This" : "The other"} device found no network address.`,
    }
  }
  if (mine.unreachableOnly || theirs.unreachableOnly) {
    return {
      verdict: "unlikely",
      reason: `${mine.unreachableOnly ? "This" : "The other"} device only has addresses that nothing else can reach (offline, or a VPN is in the way).`,
    }
  }
  if (mine.privateV4.length > 0 && theirs.privateV4.length > 0) {
    const same24 = mine.privateV4.some((a) =>
      theirs.privateV4.some((b) => prefix(a, 3) === prefix(b, 3))
    )
    if (same24) return { verdict: "likely", reason: null }
    const same16 = mine.privateV4.some((a) =>
      theirs.privateV4.some((b) => prefix(a, 2) === prefix(b, 2))
    )
    if (same16) {
      return {
        verdict: "unknown",
        reason:
          "The devices are on neighbouring parts of one network. If the router keeps them apart (a guest wifi, or wifi and ethernet on separate segments), they cannot connect.",
      }
    }
    return {
      verdict: "unlikely",
      reason: `The devices look to be on different networks (this one ${prefix(mine.privateV4[0], 3)}.x, the other ${prefix(theirs.privateV4[0], 3)}.x). Join both to the same wifi.`,
    }
  }
  if (mine.mdnsOnly || theirs.mdnsOnly) {
    return {
      verdict: "unknown",
      reason:
        "A browser hides its network address behind a .local name for privacy. That works on most home wifi, but not where the router blocks multicast DNS (many guest networks, hotspots and mesh systems) or when a VPN is on.",
    }
  }
  return { verdict: "unknown", reason: null }
}

export type FailureKind = "failed" | "timeout"

/**
 * What to tell the person when the connection did not come up: the plain
 * cause when the descriptions show it, and the usual ones otherwise.
 */
export function connectFailureMessage(options: {
  kind: FailureKind
  mine: Analysis | null
  theirs: Analysis | null
  stunOn: boolean
}): string {
  const { kind, mine, theirs, stunOn } = options
  const head =
    kind === "timeout"
      ? "Timed out before the devices connected."
      : "Could not connect."
  const known = mine && theirs ? comparePeers(mine, theirs) : null
  const lines = [head]
  if (known?.reason) lines.push(known.reason)
  lines.push(
    "Things to try: put both devices on the same wifi (not a guest network, which often isolates devices), turn off any VPN on either, and make sure the codes were from this attempt (a start code can only be used once)."
  )
  if (!stunOn) {
    lines.push(
      'If the devices are on different networks, or the wifi hides them from each other, turn on "Use a public STUN server" on both devices and try again.'
    )
  }
  return lines.join(" ")
}
