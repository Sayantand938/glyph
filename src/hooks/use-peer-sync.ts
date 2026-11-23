import * as React from "react"

import { computeDigests, readBackupParts } from "@/db/backup-parts"
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
  analyzeSdp,
  codeWarning,
  connectFailureMessage,
  describeAnalysis,
  parseMarks,
  withMark,
  type Analysis,
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
import { keepSyncRunning } from "@/lib/sync/keep-running"

export type SyncPhase =
  | { name: "idle" }
  /** Building a pairing code. */
  | { name: "working" }
  /** The starting device shows its code and waits for the other's reply. */
  | { name: "offer"; code: string; warning: string | null }
  /** The joining device shows its reply and waits for the other to paste it. */
  | { name: "answer"; code: string; warning: string | null }
  | { name: "connecting" }
  | { name: "syncing"; progress: SyncProgress | null }
  | { name: "done"; stats: MergeStats; modes: SyncMode[]; rounds: number }
  | { name: "error"; message: string; details?: string[] }

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
  /** Gives back the screen wake lock and the sync lock (see `keepSyncRunning`). */
  release: (() => void) | null
  /** What each device's code says about its network (for a failure message). */
  mine: Analysis | null
  theirs: Analysis | null
  /** Whether a public STUN server was in use for this attempt. */
  stun: boolean
}

function newAttempt(stun: boolean): Attempt {
  return {
    mine: null,
    theirs: null,
    stun,
    link: null,
    offer: null,
    session: null,
    over: false,
    timer: null,
    release: null,
  }
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
    digests: computeDigests,
  }
}

/** The error screen for a connection that did not come up, with what each side found. */
function connectionError(
  a: Attempt,
  kind: "failed" | "timeout"
): Extract<SyncPhase, { name: "error" }> {
  const details: string[] = []
  if (a.mine) details.push(`This device: ${describeAnalysis(a.mine)}.`)
  if (a.theirs) details.push(`Other device: ${describeAnalysis(a.theirs)}.`)
  return {
    name: "error",
    message: connectFailureMessage({
      kind,
      mine: a.mine,
      theirs: a.theirs,
      stunOn: a.stun,
    }),
    details,
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
export function usePeerSync(options: { stun?: boolean } = {}) {
  const stun = options.stun === true
  const [phase, setPhase] = React.useState<SyncPhase>({ name: "idle" })
  const attempt = React.useRef<Attempt | null>(null)

  const teardown = React.useCallback(() => {
    const a = attempt.current
    attempt.current = null
    if (!a) return
    a.over = true
    a.session?.stop()
    if (a.timer) clearTimeout(a.timer)
    a.release?.()
    a.link?.close()
  }, [])

  // Leaving the page ends the connection.
  React.useEffect(() => teardown, [teardown])

  const handlersFor = React.useCallback((a: Attempt): LinkHandlers => {
    const end = (next: SyncPhase) => {
      if (a.over) return
      a.over = true
      if (a.timer) clearTimeout(a.timer)
      a.release?.()
      const link = a.link
      if (link) setTimeout(() => link.close(), CLOSE_DELAY_MS)
      setPhase(next)
    }

    return {
      onOpen(link) {
        if (a.over) return
        a.link = link
        if (a.timer) clearTimeout(a.timer)
        // Keep the screen on and tell other tabs a sync is running.
        a.release = keepSyncRunning()
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
        end(
          reason === "failed"
            ? connectionError(a, "failed")
            : {
                name: "error",
                message:
                  "The other device disconnected before the sync finished.",
              }
        )
      },
    }
  }, [])

  /** Device 1: make a code to show. */
  const start = React.useCallback(async () => {
    teardown()
    const a = newAttempt(stun)
    attempt.current = a
    setPhase({ name: "working" })
    try {
      const offer = await openOffer(handlersFor(a), { stun })
      if (attempt.current !== a) return offer.link.close()
      a.offer = offer
      a.link = offer.link
      a.mine = analyzeSdp(offer.localSdp)
      setPhase({
        name: "offer",
        code: offer.code,
        warning: codeWarning(a.mine),
      })
    } catch (error) {
      setPhase({
        name: "error",
        message: message(error, "Could not prepare a connection."),
      })
    }
  }, [handlersFor, teardown, stun])

  /** Device 1: take the reply shown on device 2. */
  const accept = React.useCallback(
    async (replyCode: string): Promise<string | null> => {
      const a = attempt.current
      if (!a?.offer) return "Start again."
      try {
        const remote = await a.offer.accept(replyCode)
        a.theirs = analyzeSdp(remote)
      } catch (error) {
        return message(error, "That reply code did not work.")
      }
      setPhase({ name: "connecting" })
      a.timer = setTimeout(() => {
        if (a.over) return
        a.over = true
        a.release?.()
        a.link?.close()
        setPhase(connectionError(a, "timeout"))
      }, CONNECT_TIMEOUT_MS)
      return null
    },
    []
  )

  /** Device 2: read the code shown on device 1 and make a reply to show. */
  const join = React.useCallback(
    async (startCode: string): Promise<string | null> => {
      teardown()
      const a = newAttempt(stun)
      attempt.current = a
      setPhase({ name: "working" })
      try {
        const answer = await openAnswer(startCode, handlersFor(a), { stun })
        if (attempt.current !== a) {
          answer.link.close()
          return null
        }
        a.link = answer.link
        a.mine = analyzeSdp(answer.localSdp)
        a.theirs = analyzeSdp(answer.remoteSdp)
        setPhase({
          name: "answer",
          code: answer.code,
          warning: codeWarning(a.mine),
        })
        return null
      } catch (error) {
        attempt.current = null
        setPhase({ name: "idle" })
        return message(error, "That code did not work.")
      }
    },
    [handlersFor, teardown, stun]
  )

  const reset = React.useCallback(() => {
    teardown()
    setPhase({ name: "idle" })
  }, [teardown])

  return { phase, start, accept, join, reset }
}
