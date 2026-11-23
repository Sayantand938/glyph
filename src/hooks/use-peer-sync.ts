import * as React from "react"

import { importBackup } from "@/db/repo"
import { readBackupSnapshot } from "@/db/queries"
import {
  exportBackup,
  parseBackup,
  serializeBackup,
  type MergeStats,
} from "@/lib/backup"
import {
  OK_MESSAGE,
  Reassembler,
  failMessage,
  helloMessage,
  parseMessage,
  splitChunks,
} from "@/lib/sync"
import {
  openAnswer,
  openOffer,
  type Link,
  type LinkHandlers,
  type Offer,
} from "@/lib/sync/rtc"

export type SyncPhase =
  | { name: "idle" }
  /** Building a pairing code. */
  | { name: "working" }
  /** The starting device shows its code and waits for the other's reply. */
  | { name: "offer"; code: string }
  /** The joining device shows its reply and waits for the other to paste it. */
  | { name: "answer"; code: string }
  | { name: "connecting" }
  | { name: "syncing" }
  | { name: "done"; stats: MergeStats }
  | { name: "error"; message: string }

/** How long the starting device waits after the reply before giving up. */
const CONNECT_TIMEOUT_MS = 25_000
/** Lets the last control message leave before the connection is closed. */
const CLOSE_DELAY_MS = 500

/** The state of one sync attempt; mutable on purpose, it lives in a ref. */
interface Attempt {
  link: Link | null
  offer: Offer | null
  receiving: Reassembler | null
  /** Result of merging the other device's data into this one. */
  stats: MergeStats | null
  /** The other device has merged ours. */
  peerOk: boolean
  /** Done or failed: later events are ignored. */
  over: boolean
  timer: ReturnType<typeof setTimeout> | null
}

function newAttempt(): Attempt {
  return {
    link: null,
    offer: null,
    receiving: null,
    stats: null,
    peerOk: false,
    over: false,
    timer: null,
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * One sync between two devices on the same network, over WebRTC (see
 * `lib/sync/rtc.ts`). Both devices send their whole backup and merge the
 * other's with `importBackup`, so the merge rules are exactly those of a
 * backup file and running a sync twice is harmless.
 *
 * Roles: the device that calls `start` shows a code, the one that calls `join`
 * with that code shows a reply, and `accept` on the first takes the reply.
 * `accept` and `join` return an error text (for a bad code) or null.
 */
export function usePeerSync() {
  const [phase, setPhase] = React.useState<SyncPhase>({ name: "idle" })
  const attempt = React.useRef<Attempt | null>(null)

  const teardown = React.useCallback(() => {
    const a = attempt.current
    attempt.current = null
    if (!a) return
    a.over = true
    if (a.timer) clearTimeout(a.timer)
    a.link?.close()
  }, [])

  // Leaving the page ends the connection.
  React.useEffect(() => teardown, [teardown])

  const handlersFor = React.useCallback((a: Attempt): LinkHandlers => {
    const fail = (text: string, tellPeer: boolean) => {
      if (a.over) return
      a.over = true
      if (a.timer) clearTimeout(a.timer)
      if (tellPeer) {
        try {
          a.link?.send(failMessage(text))
        } catch {
          // Already disconnected: nobody to tell.
        }
      }
      const link = a.link
      if (link) setTimeout(() => link.close(), CLOSE_DELAY_MS)
      setPhase({ name: "error", message: text })
    }

    const finishIfBoth = () => {
      if (a.over || !a.stats || !a.peerOk) return
      a.over = true
      const link = a.link
      if (link) setTimeout(() => link.close(), CLOSE_DELAY_MS)
      setPhase({ name: "done", stats: a.stats })
    }

    const merge = async (bytes: Uint8Array) => {
      const parsed = parseBackup(new TextDecoder().decode(bytes))
      if (!parsed.ok) return fail(parsed.error, true)
      try {
        a.stats = await importBackup(parsed.backup)
      } catch (error) {
        return fail(
          message(error, "Could not save the other device's data."),
          true
        )
      }
      if (a.over) return
      try {
        a.link?.send(OK_MESSAGE)
      } catch (error) {
        return fail(message(error, "The connection closed."), false)
      }
      finishIfBoth()
    }

    const sendOurs = async (link: Link) => {
      const now = Date.now()
      const { data, images, settings } = await readBackupSnapshot()
      const bytes = new TextEncoder().encode(
        serializeBackup(exportBackup(data, now, images, settings))
      )
      link.send(helloMessage(bytes.length))
      await link.sendChunks(splitChunks(bytes))
    }

    return {
      onOpen(link) {
        if (a.over) return
        a.link = link
        if (a.timer) clearTimeout(a.timer)
        setPhase({ name: "syncing" })
        sendOurs(link).catch((error: unknown) =>
          fail(message(error, "Could not send this device's data."), false)
        )
      },
      onText(text) {
        const m = parseMessage(text)
        if (a.over || !m) return
        if (m.t === "hello") {
          if (a.receiving) return fail("The other device started twice.", true)
          const begun = Reassembler.begin(m.bytes)
          if ("error" in begun) return fail(begun.error, true)
          a.receiving = begun
          // An empty backup has no chunks to wait for.
          if (begun.complete) void merge(new Uint8Array())
        } else if (m.t === "ok") {
          a.peerOk = true
          finishIfBoth()
        } else {
          fail(
            m.reason
              ? `The other device stopped the sync: ${m.reason}`
              : "The other device stopped the sync.",
            false
          )
        }
      },
      onBinary(data) {
        if (a.over) return
        if (!a.receiving)
          return fail("Unexpected data from the other device.", true)
        const pushed = a.receiving.push(data)
        if (pushed.status === "error") return fail(pushed.error, true)
        if (pushed.status === "done") void merge(pushed.bytes)
      },
      onClose(reason) {
        if (a.over) return
        fail(
          reason === "failed"
            ? "Could not connect. The devices must be on the same wifi, and a guest network or a router setting that isolates devices can block this."
            : "The other device disconnected before the sync finished.",
          false
        )
      },
    }
  }, [])

  /** Device 1: make a code to show. */
  const start = React.useCallback(async () => {
    teardown()
    const a = newAttempt()
    attempt.current = a
    setPhase({ name: "working" })
    try {
      const offer = await openOffer(handlersFor(a))
      if (attempt.current !== a) return offer.link.close()
      a.offer = offer
      a.link = offer.link
      setPhase({ name: "offer", code: offer.code })
    } catch (error) {
      setPhase({
        name: "error",
        message: message(error, "Could not prepare a connection."),
      })
    }
  }, [handlersFor, teardown])

  /** Device 1: take the reply shown on device 2. */
  const accept = React.useCallback(
    async (replyCode: string): Promise<string | null> => {
      const a = attempt.current
      if (!a?.offer) return "Start again."
      try {
        await a.offer.accept(replyCode)
      } catch (error) {
        return message(error, "That reply code did not work.")
      }
      setPhase({ name: "connecting" })
      a.timer = setTimeout(() => {
        if (a.over) return
        a.over = true
        a.link?.close()
        setPhase({
          name: "error",
          message:
            "Timed out before the devices connected. They must be on the same wifi; a guest network or a router setting that isolates devices can block this.",
        })
      }, CONNECT_TIMEOUT_MS)
      return null
    },
    []
  )

  /** Device 2: read the code shown on device 1 and make a reply to show. */
  const join = React.useCallback(
    async (startCode: string): Promise<string | null> => {
      teardown()
      const a = newAttempt()
      attempt.current = a
      setPhase({ name: "working" })
      try {
        const answer = await openAnswer(startCode, handlersFor(a))
        if (attempt.current !== a) {
          answer.link.close()
          return null
        }
        a.link = answer.link
        setPhase({ name: "answer", code: answer.code })
        return null
      } catch (error) {
        attempt.current = null
        setPhase({ name: "idle" })
        return message(error, "That code did not work.")
      }
    },
    [handlersFor, teardown]
  )

  const reset = React.useCallback(() => {
    teardown()
    setPhase({ name: "idle" })
  }, [teardown])

  return { phase, start, accept, join, reset }
}
