import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { db } from "@/db/database"
import { saveSetting } from "@/db/repo"
import {
  DEFAULT_SETTINGS,
  resolveSettings,
  type SettingKey,
  type SettingValues,
} from "@/lib/settings"

/**
 * Every setting that syncs with the data (retention, fitted weights, auto-fit,
 * leech rule), read live from the database: a change from another tab, or one
 * that arrives in a sync or a restored backup, shows up at once. Until the
 * first read finishes (a few milliseconds) the defaults are returned and
 * `loaded` is false.
 */
export function useSettings(): SettingValues & { loaded: boolean } {
  const rows = useLiveQuery(() => db.settings.toArray(), [])
  return React.useMemo(
    () => ({
      ...(rows ? resolveSettings(rows) : DEFAULT_SETTINGS),
      loaded: rows !== undefined,
    }),
    [rows]
  )
}

/**
 * One setting and its setter. The new value shows at once (a slider being
 * dragged must not jump back while the write is in flight) and hands over to the
 * stored value as soon as that matches. A failed write is dropped, so the old
 * value shows again.
 */
export function useSetting<K extends SettingKey>(
  key: K
): [SettingValues[K], (next: SettingValues[K]) => void] {
  const settings = useSettings()
  const stored = settings[key]
  const [pending, setPending] = React.useState<{
    value: SettingValues[K]
  } | null>(null)

  // Adjusting state while rendering: once the database has caught up, stop
  // overriding it, so a later change from a sync or another tab shows through.
  if (pending && JSON.stringify(pending.value) === JSON.stringify(stored)) {
    setPending(null)
  }

  const set = React.useCallback(
    (next: SettingValues[K]) => {
      setPending({ value: next })
      saveSetting(key, next).catch(() => setPending(null))
    },
    [key]
  )
  return [pending ? pending.value : stored, set]
}
