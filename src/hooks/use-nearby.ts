import * as React from "react"

import { deviceId, type usePeerSync } from "@/hooks/use-peer-sync"
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
  type NearbyRequest,
  type TrustedDevices,
} from "@/lib/sync"
import {
  closeNearby,
  connectNearby,
  nearbyAvailable,
  sendNearby,
  startNearby,
  type NearbyPeer,
} from "@/lib/sync/nearby-link"

type PeerSync = ReturnType<typeof usePeerSync>

export type NearbyState =
  /** A plain browser, not the app: use pairing codes. */
  | { name: "unavailable" }
  /** Looking: the list of devices is `peers`. */
  | { name: "browsing" }
  /** This device picked another and waits for its user (the number is shown on both). */
  | { name: "asking"; peer: string; pin: string }
  /** Another device asks to sync with this one. */
  | { name: "incoming"; request: NearbyRequest }
  /** Agreed; the connection is being set up (then `sync.phase` takes over). */
  | { name: "pairing"; peer: string }
  | { name: "failed"; message: string }

const TRUST_KEY = "glyph.trustedDevices"
const NAME_KEY = "glyph.deviceName"
/** How long to wait for the other person to tap Accept. */
const ANSWER_TIMEOUT_MS = 90_000

function readTrusted(): TrustedDevices {
  try {
    return parseTrusted(localStorage.getItem(TRUST_KEY))
  } catch {
    return {}
  }
}

function writeTrusted(list: TrustedDevices) {
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(list))
  } catch {
    // Not stored: the next sync asks for a tap again.
  }
}

/** A name to show on the other device: the saved one, else a guess from the platform. */
export function defaultDeviceName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY)
    if (saved && saved.trim()) return saved.trim().slice(0, 40)
  } catch {
    // Fall through to the guess.
  }
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/Android/i.test(ua)) return "Android phone"
  if (/Windows/i.test(ua)) return "Windows PC"
  if (/Mac/i.test(ua)) return "Mac"
  if (/Linux/i.test(ua)) return "Linux PC"
  return "Glyph device"
}

export function saveDeviceName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 40))
  } catch {
    // Not stored; the guess applies next time.
  }
}

/** The conversation with one other device over the local channel. */
interface Active {
  conn: number
  role: "initiator" | "responder"
  handle: (msg: NearbyMsg) => Promise<void>
  closed: () => void
  approve: () => void
  decline: () => void
  /** The offer (initiator) or reply (responder) code has been sent. */
  sent: boolean
  timer: ReturnType<typeof setTimeout> | null
}

function text(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error
      ? error
      : fallback
}

/**
 * Finding other devices on the network and pairing without pasting codes (see
 * `lib/sync/nearby.ts`). It only replaces how the two WebRTC codes travel: the
 * codes themselves, the connection and the sync are `usePeerSync`.
 */
export function useNearby(sync: PeerSync, deviceName: string) {
  const available = nearbyAvailable()
  const [state, setState] = React.useState<NearbyState>(
    available ? { name: "browsing" } : { name: "unavailable" }
  )
  const [peers, setPeers] = React.useState<NearbyPeer[]>([])
  const [trusted, setTrusted] = React.useState<TrustedDevices>(readTrusted)
  const active = React.useRef<Active | null>(null)
  const syncRef = React.useRef(sync)
  React.useEffect(() => {
    syncRef.current = sync
  })

  const stopTimer = React.useCallback(() => {
    const a = active.current
    if (a?.timer) clearTimeout(a.timer)
    if (a) a.timer = null
  }, [])

  /** Closes the local channel; the WebRTC link (if any) lives on. */
  const end = React.useCallback(() => {
    const a = active.current
    active.current = null
    if (!a) return
    if (a.timer) clearTimeout(a.timer)
    closeNearby(a.conn)
  }, [])

  const fail = React.useCallback(
    (message: string) => {
      end()
      syncRef.current.reset()
      setState({ name: "failed", message })
    },
    [end]
  )

  const remember = React.useCallback(
    (id: string, name: string, secret: string) => {
      const next = withTrusted(readTrusted(), id, { name, secret })
      writeTrusted(next)
      setTrusted(next)
    },
    []
  )

  const forget = React.useCallback((id: string) => {
    const next = withoutTrusted(readTrusted(), id)
    writeTrusted(next)
    setTrusted(next)
  }, [])

  const send = React.useCallback((conn: number, msg: NearbyMsg) => {
    sendNearby(conn, encodeNearby(msg)).catch(() => {
      // The channel is gone; its close event reports it.
    })
  }, [])

  const deps = React.useCallback(
    () => ({
      self: { id: deviceId(), name: deviceName },
      secretFor: (id: string) => readTrusted()[id]?.secret ?? null,
      crypto: webCrypto,
    }),
    [deviceName]
  )

  /** A device asked to sync with this one. */
  const beginResponder = React.useCallback(
    (conn: number): Active => {
      const responder = new NearbyResponder(
        deps(),
        { send: (m) => send(conn, m) },
        {
          onRequest: (request) => {
            setState({ name: "incoming", request })
            const a = active.current
            if (a) {
              a.timer = setTimeout(() => {
                responder.decline()
                end()
                setState({ name: "browsing" })
              }, ANSWER_TIMEOUT_MS)
            }
          },
          onReady: (request, secret) => {
            stopTimer()
            if (secret) remember(request.id, request.name, secret)
            setState({ name: "pairing", peer: request.name })
          },
          onOffer: async (code) => {
            const problem = await syncRef.current.join(code)
            if (problem) fail(problem)
          },
          onFail: (message) => fail(message),
        }
      )
      const a: Active = {
        conn,
        role: "responder",
        handle: (m) => responder.onMessage(m),
        closed: () => responder.onClosed(),
        approve: () => responder.approve(),
        decline: () => {
          responder.decline()
          end()
          setState({ name: "browsing" })
        },
        sent: false,
        timer: null,
      }
      active.current = a
      return a
    },
    [deps, send, remember, stopTimer, end, fail]
  )

  // Announce this device and list the others while the page is open.
  React.useEffect(() => {
    if (!available) return
    let stop: (() => void) | null = null
    let cancelled = false
    startNearby(
      { id: deviceId(), name: deviceName },
      {
        onPeers: setPeers,
        onMessage: (conn, raw) => {
          const msg = parseNearby(raw)
          if (!msg) return
          const a = active.current
          if (a && a.conn === conn) {
            void a.handle(msg)
            return
          }
          if (!a && msg.t === "req" && syncRef.current.phase.name === "idle") {
            void beginResponder(conn).handle(msg)
            return
          }
          // Busy with something else, or not a request: turn it away.
          send(conn, { t: "decline" })
          closeNearby(conn)
        },
        onClosed: (conn) => {
          if (active.current?.conn === conn) active.current.closed()
        },
      }
    ).then(
      (off) => {
        if (cancelled) off()
        else stop = off
      },
      (error) => {
        if (!cancelled) {
          setState({
            name: "failed",
            message: `Could not look for nearby devices: ${text(error, "unknown error")}`,
          })
        }
      }
    )
    return () => {
      cancelled = true
      stop?.()
      end()
      setPeers([])
    }
  }, [available, deviceName, beginResponder, send, end])

  // Pass the WebRTC codes along, and let go of the local channel once the
  // direct connection is being made (it is not needed after that).
  React.useEffect(() => {
    const a = active.current
    if (!a) return
    const phase = sync.phase
    if (a.role === "initiator" && phase.name === "offer" && !a.sent) {
      a.sent = true
      send(a.conn, { t: "offer", code: phase.code })
    } else if (a.role === "responder" && phase.name === "answer" && !a.sent) {
      a.sent = true
      send(a.conn, { t: "answer", code: phase.code })
    } else if (
      phase.name === "connecting" ||
      phase.name === "syncing" ||
      phase.name === "done" ||
      phase.name === "error"
    ) {
      end()
    }
  }, [sync.phase, send, end])

  /** The user picked a device from the list. */
  const pick = React.useCallback(
    async (peer: NearbyPeer) => {
      if (active.current || syncRef.current.phase.name !== "idle") return
      const pin = randomPin(webCrypto)
      setState({ name: "asking", peer: peer.name, pin })
      let conn: number
      try {
        conn = await connectNearby(peer.id)
      } catch (error) {
        setState({
          name: "failed",
          message: text(error, "Could not reach that device."),
        })
        return
      }
      const initiator = new NearbyInitiator(
        deps(),
        { send: (m) => send(conn, m) },
        {
          onReady: async (secret) => {
            stopTimer()
            if (secret) remember(peer.id, peer.name, secret)
            setState({ name: "pairing", peer: peer.name })
            await syncRef.current.start()
          },
          onDeclined: () => fail(`${peer.name} said no.`),
          onAnswer: async (code) => {
            const problem = await syncRef.current.accept(code)
            if (problem) fail(problem)
          },
          onFail: (message) => fail(message),
        },
        peer.id,
        pin
      )
      active.current = {
        conn,
        role: "initiator",
        handle: (m) => initiator.onMessage(m),
        closed: () => initiator.onClosed(),
        approve: () => {},
        decline: () => {},
        sent: false,
        timer: setTimeout(
          () => fail("The other device did not answer in time."),
          ANSWER_TIMEOUT_MS
        ),
      }
      initiator.start()
    },
    [deps, send, remember, stopTimer, fail]
  )

  /** Back to the list (cancel, or dismiss an error). */
  const reset = React.useCallback(() => {
    end()
    syncRef.current.reset()
    setState(available ? { name: "browsing" } : { name: "unavailable" })
  }, [end, available])

  return {
    state,
    peers,
    trusted,
    pick,
    approve: () => active.current?.approve(),
    decline: () => active.current?.decline(),
    forget,
    reset,
  }
}
