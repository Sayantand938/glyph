import * as React from "react"

import { syncIsRunning } from "@/lib/sync/keep-running"

/** How often another tab's sync is looked for (the Web Locks API has no event). */
const POLL_MS = 1500

/**
 * True while a device sync is running in any tab of this app. The study screen
 * uses it to hold off: a review written in the middle of a sync can make the
 * two devices' final check disagree.
 */
export function useSyncRunning(): boolean {
  const [running, setRunning] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    const look = () =>
      void syncIsRunning().then((value) => {
        if (alive) setRunning(value)
      })
    look()
    const id = setInterval(look, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return running
}
