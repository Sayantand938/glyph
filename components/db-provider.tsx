"use client"

import * as React from "react"

import { initDatabase } from "@/db/database"

/**
 * Runs client-only database startup (persist + seed) and withholds children
 * until it finishes, so nothing queries an unseeded database.
 */
export function DbProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"loading" | "ready" | "error">(
    "loading"
  )

  React.useEffect(() => {
    let cancelled = false
    initDatabase().then(
      () => !cancelled && setState("ready"),
      (error: unknown) => {
        console.error("Database failed to start", error)
        if (!cancelled) setState("error")
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (state === "ready") return <>{children}</>
  if (state === "error") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-sm" role="alert">
        <p className="font-semibold">Couldn&apos;t open local storage.</p>
        <p className="mt-2 text-muted-foreground">
          Glyph keeps all data in your browser&apos;s IndexedDB. Make sure
          you&apos;re not in a private window and that site data isn&apos;t
          blocked, then reload.
        </p>
      </div>
    )
  }
  return null
}
