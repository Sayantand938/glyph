import { describe, expect, it } from "vitest"

import {
  analyzeSdp,
  classifyAddress,
  codeWarning,
  comparePeers,
  connectFailureMessage,
  describeAnalysis,
  parseCandidates,
} from "./sync/diagnose"

/** Session descriptions as browsers write them, reduced to the lines that matter. */
const sdp = (...candidates: string[]) =>
  [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...candidates.map((c) => `a=${c}`),
    "a=ice-ufrag:abcd",
    "",
  ].join("\r\n")

/** Chrome: the host address is hidden behind a random .local name. */
const CHROME = sdp(
  "candidate:2001 1 udp 2113937151 7c1f0f1e-6d5e-4a3a-9c44-0d8f2a1c9b10.local 55001 typ host generation 0 ufrag abcd network-cost 999"
)
/** Firefox or a browser with camera permission: the real addresses. */
const HOME_A = sdp(
  "candidate:1 1 udp 2122260223 192.168.1.20 49234 typ host generation 0",
  "candidate:2 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 0",
  "candidate:3 1 udp 2122194687 fe80::1c2b:3d4e:5f60:7182 51000 typ host generation 0"
)
const HOME_B = sdp(
  "candidate:1 1 udp 2122260223 192.168.1.35 50111 typ host generation 0"
)
const OTHER_NET = sdp(
  "candidate:1 1 udp 2122260223 10.0.0.7 50111 typ host generation 0"
)
const NEIGHBOUR = sdp(
  "candidate:1 1 udp 2122260223 192.168.2.9 50111 typ host generation 0"
)
const WITH_STUN = sdp(
  "candidate:1 1 udp 2122260223 192.168.1.20 49234 typ host generation 0",
  "candidate:7 1 udp 1686052607 203.0.113.9 49234 typ srflx raddr 192.168.1.20 rport 49234 generation 0"
)
const VPN_ONLY = sdp(
  "candidate:1 1 udp 2122260223 127.0.0.1 49234 typ host generation 0",
  "candidate:2 1 udp 2122260223 169.254.12.4 49235 typ host generation 0"
)

describe("classifyAddress", () => {
  it.each([
    ["abc.local", "mdns"],
    ["192.168.0.4", "private"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.1", "private"],
    ["172.32.0.1", "public"],
    ["100.64.0.9", "shared"],
    ["169.254.1.1", "link-local"],
    ["127.0.0.1", "loopback"],
    ["8.8.8.8", "public"],
    ["fe80::1", "ipv6-link-local"],
    ["fd12:3456::1", "ipv6-private"],
    ["2001:db8::1", "ipv6-public"],
    ["::1", "loopback"],
    ["999.1.1.1", "unknown"],
    ["somehost", "unknown"],
  ])("%s is %s", (address, kind) => {
    expect(classifyAddress(address)).toBe(kind)
  })
})

describe("parseCandidates", () => {
  it("reads protocol, address, port and type", () => {
    expect(parseCandidates(WITH_STUN)).toEqual([
      {
        protocol: "udp",
        address: "192.168.1.20",
        port: 49234,
        type: "host",
        kind: "private",
      },
      {
        protocol: "udp",
        address: "203.0.113.9",
        port: 49234,
        type: "srflx",
        kind: "public",
      },
    ])
  })

  it("ignores other lines and a description with no candidates", () => {
    expect(parseCandidates("v=0\r\ns=-\r\n")).toEqual([])
    expect(parseCandidates("")).toEqual([])
  })
})

describe("analyzeSdp", () => {
  it("sees a hidden address", () => {
    const a = analyzeSdp(CHROME)
    expect(a.mdnsOnly).toBe(true)
    expect(a.none).toBe(false)
    expect(a.privateV4).toEqual([])
  })

  it("collects private IPv4 addresses once", () => {
    expect(analyzeSdp(HOME_A).privateV4).toEqual(["192.168.1.20"])
  })

  it("sees addresses nothing else can reach", () => {
    expect(analyzeSdp(VPN_ONLY).unreachableOnly).toBe(true)
  })

  it("sees an address from a STUN server", () => {
    const a = analyzeSdp(WITH_STUN)
    expect(a.hasServerAddress).toBe(true)
    expect(a.mdnsOnly).toBe(false)
  })

  it("sees no address at all", () => {
    expect(analyzeSdp(sdp()).none).toBe(true)
  })
})

describe("codeWarning", () => {
  it("warns about a code that cannot work and nothing else", () => {
    expect(codeWarning(analyzeSdp(sdp()))).toMatch(/no network address/)
    expect(codeWarning(analyzeSdp(VPN_ONLY))).toMatch(/VPN/)
    expect(codeWarning(analyzeSdp(CHROME))).toBeNull()
    expect(codeWarning(analyzeSdp(HOME_A))).toBeNull()
  })
})

describe("comparePeers", () => {
  it("likes two devices in the same /24", () => {
    expect(comparePeers(analyzeSdp(HOME_A), analyzeSdp(HOME_B))).toEqual({
      verdict: "likely",
      reason: null,
    })
  })

  it("says different networks are unlikely, with both prefixes", () => {
    const c = comparePeers(analyzeSdp(HOME_A), analyzeSdp(OTHER_NET))
    expect(c.verdict).toBe("unlikely")
    expect(c.reason).toContain("192.168.1.x")
    expect(c.reason).toContain("10.0.0.x")
  })

  it("is unsure about neighbouring subnets", () => {
    const c = comparePeers(analyzeSdp(HOME_A), analyzeSdp(NEIGHBOUR))
    expect(c.verdict).toBe("unknown")
    expect(c.reason).toMatch(/neighbouring/)
  })

  it("explains hidden addresses without blaming anything", () => {
    const c = comparePeers(analyzeSdp(CHROME), analyzeSdp(CHROME))
    expect(c.verdict).toBe("unknown")
    expect(c.reason).toMatch(/\.local/)
  })

  it("names the device that has no address", () => {
    expect(comparePeers(analyzeSdp(sdp()), analyzeSdp(HOME_A)).reason).toMatch(
      /^This device found no network address/
    )
    expect(comparePeers(analyzeSdp(HOME_A), analyzeSdp(sdp())).reason).toMatch(
      /^The other device found no network address/
    )
  })

  it("names the device that only has unreachable addresses", () => {
    const c = comparePeers(analyzeSdp(HOME_A), analyzeSdp(VPN_ONLY))
    expect(c.verdict).toBe("unlikely")
    expect(c.reason).toMatch(/^The other device only has addresses/)
  })
})

describe("connectFailureMessage", () => {
  const home = analyzeSdp(HOME_A)
  const other = analyzeSdp(OTHER_NET)

  it("puts the specific cause before the usual advice", () => {
    const text = connectFailureMessage({
      kind: "failed",
      mine: home,
      theirs: other,
      stunOn: false,
    })
    expect(text.startsWith("Could not connect.")).toBe(true)
    expect(text).toContain("different networks")
    expect(text).toContain("same wifi")
    expect(text).toContain("STUN")
  })

  it("says timed out, and leaves out the STUN tip once it is on", () => {
    const text = connectFailureMessage({
      kind: "timeout",
      mine: null,
      theirs: null,
      stunOn: true,
    })
    expect(text.startsWith("Timed out")).toBe(true)
    expect(text).not.toContain("STUN")
  })
})

describe("describeAnalysis", () => {
  it("reads like a sentence fragment", () => {
    expect(describeAnalysis(analyzeSdp(sdp()))).toBe("no network address found")
    expect(describeAnalysis(analyzeSdp(HOME_A))).toBe(
      "local address 192.168.1.20"
    )
    expect(describeAnalysis(analyzeSdp(CHROME))).toBe(
      "address hidden behind a .local name"
    )
    expect(describeAnalysis(analyzeSdp(WITH_STUN))).toContain("STUN server")
  })
})
