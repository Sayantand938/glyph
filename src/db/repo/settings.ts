import {
  SETTING_PARSERS,
  type SettingKey,
  type SettingValues,
} from "@/lib/settings"

import { db } from "../database"
import { SETTINGS, getRow, putRows } from "../tables"

/**
 * Saves one setting. `updatedAt` is always later than the stored row's, so the
 * change wins a merge with another device. A value that does not parse for the
 * key is refused.
 */
export async function saveSetting<K extends SettingKey>(
  key: K,
  value: SettingValues[K],
  now = Date.now()
): Promise<void> {
  const parsed = SETTING_PARSERS[key](value)
  if (parsed === null) throw new Error(`Invalid value for setting "${key}".`)
  await db.transaction(async (tx) => {
    const current = await getRow(tx, SETTINGS, key)
    await putRows(tx, SETTINGS, [
      {
        key,
        value: parsed,
        updatedAt: Math.max(now, (current?.updatedAt ?? 0) + 1),
      },
    ])
  })
}
