import * as React from "react"

import { initDatabase } from "@/db/database"

/**
 * Runs client-only database startup (open the SQLite file, migrate, seed) and
 * withholds children until it finishes, so nothing queries an unready database.
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
        <p className="font-semibold">Couldn&apos;t open the database.</p>
        <p className="mt-2 text-muted-foreground">
          Glyph keeps all data in a SQLite file in its app data folder. Make
          sure the folder is writable and the file isn&apos;t locked by another
          program, then restart the app.
        </p>
      </div>
    )
  }
  return null
}
