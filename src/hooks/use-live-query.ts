import * as React from "react"

import { subscribeTables, type TableName } from "@/db/live"

/**
 * Runs `querier` and runs it again whenever a write to one of `tables`
 * commits (from this window, a sync or a restored backup). Returns undefined
 * until the first result. `deps` work as for `useEffect`: a change starts a new
 * query, and the previous result stays until the new one arrives. A result from
 * a query that a newer run has overtaken is dropped.
 *
 * List every table the query reads, or it will not refresh when that table
 * changes.
 */
export function useLiveQuery<T>(
  querier: () => Promise<T>,
  deps: React.DependencyList,
  tables: readonly TableName[]
): T | undefined {
  const [value, setValue] = React.useState<T | undefined>(undefined)

  React.useEffect(() => {
    let active = true
    let latest = 0
    const run = () => {
      const mine = ++latest
      querier().then(
        (result) => {
          if (active && mine === latest) setValue(result)
        },
        (error: unknown) => console.error("Live query failed", error)
      )
    }
    run()
    const off = subscribeTables(tables, run)
    return () => {
      active = false
      off()
    }
    // `querier` and `tables` are recreated on every render; `deps` says when
    // the query really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return value
}
