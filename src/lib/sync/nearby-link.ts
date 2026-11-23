/**
 * The desktop shell's side of finding nearby devices: thin wrappers around the
 * commands in `src-tauri/src/discovery.rs` and its events. Tauri-only, like
 * `rtc.ts` it is not unit-tested; the conversation is `nearby.ts`.
 */
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export interface NearbyPeer {
  id: string
  name: string
  hosts: string[]
  port: number
}

export interface NearbyHandlers {
  onPeers: (peers: NearbyPeer[]) => void
  onMessage: (conn: number, text: string) => void
  onClosed: (conn: number) => void
}

/** Whether this build can find nearby devices (the Tauri app, not a plain browser). */
export function nearbyAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/**
 * Starts announcing this device and listing the others; returns the function
 * that stops it. Nothing is announced until this is called.
 */
export async function startNearby(
  self: { id: string; name: string },
  handlers: NearbyHandlers
): Promise<() => void> {
  const unlisten = await Promise.all([
    listen<NearbyPeer[]>("nearby://peers", (e) => handlers.onPeers(e.payload)),
    listen<{ conn: number; message: string }>("nearby://message", (e) =>
      handlers.onMessage(e.payload.conn, e.payload.message)
    ),
    listen<{ conn: number }>("nearby://closed", (e) =>
      handlers.onClosed(e.payload.conn)
    ),
  ])
  try {
    await invoke("discovery_start", { id: self.id, name: self.name })
  } catch (error) {
    for (const off of unlisten) off()
    throw error
  }
  return () => {
    for (const off of unlisten) off()
    void invoke("discovery_stop").catch(() => {})
  }
}

export function connectNearby(peerId: string): Promise<number> {
  return invoke<number>("discovery_connect", { peer: peerId })
}

export function sendNearby(conn: number, message: string): Promise<void> {
  return invoke<void>("discovery_send", { conn, message })
}

export function closeNearby(conn: number): void {
  void invoke("discovery_close", { conn }).catch(() => {})
}
