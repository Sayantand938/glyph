/**
 * Browser-only helpers that keep a sync alive and tell other tabs about it
 * (the pure protocol is `session.ts`). Both are best effort: a browser without
 * the Screen Wake Lock or Web Locks API simply goes without.
 *
 *  - `keepSyncRunning()` asks the screen to stay on (a phone that locks its
 *    screen pauses the page and drops the connection) and holds a Web Lock
 *    named `SYNC_LOCK_NAME`, so a second tab on this device can see a sync is
 *    running (`syncIsRunning`) and keep its study screen from writing reviews
 *    in the middle of it.
 */

export const SYNC_LOCK_NAME = "glyph-sync"

/**
 * Starts keeping the screen on and the sync lock held. Returns the function
 * that gives both back; calling it twice is fine. The wake lock is released by
 * the browser whenever the tab is hidden, so it is asked for again when the tab
 * becomes visible.
 */
export function keepSyncRunning(): () => void {
  let stopped = false
  let sentinel: WakeLockSentinel | null = null
  let releaseLock: () => void = () => {}

  const askForScreen = async () => {
    try {
      const next = await navigator.wakeLock.request("screen")
      if (stopped) {
        void next.release()
        return
      }
      sentinel = next
    } catch {
      // Not supported, or refused (battery saver): carry on without.
    }
  }

  const onVisible = () => {
    if (stopped || document.visibilityState !== "visible") return
    if (!sentinel || sentinel.released) void askForScreen()
  }

  try {
    if ("wakeLock" in navigator) {
      void askForScreen()
      document.addEventListener("visibilitychange", onVisible)
    }
  } catch {
    // Carry on without.
  }

  try {
    if ("locks" in navigator) {
      const held = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      navigator.locks.request(SYNC_LOCK_NAME, () => held).catch(() => {})
    }
  } catch {
    // Carry on without.
  }

  return () => {
    if (stopped) return
    stopped = true
    releaseLock()
    try {
      document.removeEventListener("visibilitychange", onVisible)
      void sentinel?.release()
    } catch {
      // Already gone.
    }
    sentinel = null
  }
}

/** True while any tab of this app holds the sync lock (false if unknown). */
export async function syncIsRunning(): Promise<boolean> {
  try {
    if (!("locks" in navigator)) return false
    const state = await navigator.locks.query()
    return (state.held ?? []).some((lock) => lock.name === SYNC_LOCK_NAME)
  } catch {
    return false
  }
}
