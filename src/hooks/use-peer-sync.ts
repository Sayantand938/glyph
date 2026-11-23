import * as React from "react"

import { countRows, readBackupParts } from "@/db/backup-parts"
import { importBackup } from "@/db/repo"
import {
  addMergeStats,
  emptyMergeStats,
  parseBackup,
  serializeBackup,
  type MergeStats,
} from "@/lib/backup"
import {
  SyncSession,
  parseMarks,
  withMark,
  type SyncDeps,
  type SyncMode,
  type SyncProgress,
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
  | { name: "syncing"; progress: SyncProgress | null }
  | { name: "done"; stats: MergeStats; modes: SyncMode[]; rounds: number }
  | { name: "error"; message: string }

/** How long the starting device waits after the reply before giving up. */
const CONNECT_TIMEOUT_MS = 25_000
/** Lets the last control message leave before the connection is closed. */
const CLOSE_DELAY_MS = 500

/** The state of one sync attempt; mutable on purpose, it lives in a ref. */
interface Attempt {
  link: Link | null
  offer: Offer | null
  session: SyncSession<MergeStats> | null
  /** Done or failed: later events are ignored. */
  over: boolean
  timer: ReturnType<typeof setTimeout> | null
}

function newAttempt(): Attempt {
  return { link: null, offer: null, session: null, over: false, timer: null }
}

const DEVICE_KEY = "glyph.deviceId"
const MARKS_KEY = "glyph.syncMarks"

/** A random id for this device, kept in localStorage (in memory if that fails). */
let memoryDeviceId: string | null = null
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    memoryDeviceId ??= crypto.randomUUID()
    return memoryDeviceId
  }
}

function readMarks() {
  try {
    return parseMarks(localStorage.getItem(MARKS_KEY))
  } catch {
    return {}
  }
}

/** What the session needs from this device: its data, its marks, its merge. */
function depsFor(): SyncDeps<MergeStats> {
  return {
    deviceId: deviceId(),
    now: () => Date.now(),
    markFor: (peer) => readMarks()[peer] ?? null,
    setMark: (peer, at) => {
      try {
        localStorage.setItem(
          MARKS_KEY,
          JSON.stringify(withMark(readMarks(), peer, at))
        )
      } catch {
        // No storage: the next sync is simply a full one.
      }
    },
    parts: async function* (since) {
      for await (const part of readBackupParts(since)) {
        yield serializeBackup(part)
      }
    },
    merge: async (text) => {
      const parsed = parseBackup(text)
      if (!parsed.ok) throw new Error(parsed.error)
      return importBackup(parsed.backup)
    },
    emptyStats: emptyMergeStats,
    addStats: addMergeStats,
    counts: countRows,
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * One sync between two devices on the same network, over WebRTC (see
 * `lib/sync/rtc.ts`). The conversation itself (what to send, in how many parts,
 * the check that both ended with the same rows) is `SyncSession`; this hook
 * only connects it to the data channel and the database. The first sync of two
 * devices sends everything; later ones only what changed since (see
 * `lib/sync/delta.ts`). The merge rules are those of a backup file.
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
    a.session?.stop()
    if (a.timer) clearTimeout(a.timer)
    a.link?.close()
  }, [])

  // Leaving the page ends the connection.
  React.useEffect(() => teardown, [teardown])

  const handlersFor = React.useCallback((a: Attempt): LinkHandlers => {
    const end = (next: SyncPhase) => {
      if (a.over) return
      a.over = true
      if (a.timer) clearTimeout(a.timer)
      const link = a.link
      if (link) setTimeout(() => link.close(), CLOSE_DELAY_MS)
      setPhase(next)
    }

    return {
      onOpen(link) {
        if (a.over) return
        a.link = link
        if (a.timer) clearTimeout(a.timer)
        setPhase({ name: "syncing", progress: null })
        const session = new SyncSession<MergeStats>(
          {
            sendText: (text) => link.send(text),
            sendChunks: (chunks) => link.sendChunks(chunks),
          },
          depsFor(),
          {
            onProgress: (progress) => {
              if (!a.over) setPhase({ name: "syncing", progress })
            },
            onDone: (stats, info) =>
              end({
                name: "done",
                stats,
                modes: info.modes,
                rounds: info.rounds,
              }),
            onFail: (text) => end({ name: "error", message: text }),
          }
        )
        a.session = session
        try {
          session.start()
        } catch (error) {
          end({
            name: "error",
            message: message(error, "Could not start the sync."),
          })
        }
      },
      onText(text) {
        a.session?.onText(text)
      },
      onBinary(data) {
        a.session?.onBinary(data)
      },
      onClose(reason) {
        if (a.over) return
        end({
          name: "error",
          message:
            reason === "failed"
              ? "Could not connect. The devices must be on the same wifi, and a guest network or a router setting that isolates devices can block this."
              : "The other device disconnected before the sync finished.",
        })
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
