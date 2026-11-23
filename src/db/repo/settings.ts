import {
  SETTING_PARSERS,
  type SettingKey,
  type SettingValues,
} from "@/lib/settings"

import { db } from "../database"

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
  await db.transaction("rw", db.settings, async () => {
    const current = await db.settings.get(key)
    await db.settings.put({
      key,
      value: parsed,
      updatedAt: Math.max(now, (current?.updatedAt ?? 0) + 1),
    })
  })
}

const LEGACY_RETENTION_KEY = "glyph.retention"
const LEGACY_WEIGHTS_KEY = "glyph.fsrsWeights"

function readLegacy(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

/**
 * One-time move of the retention and fitted weights from this device's
 * localStorage (where they lived before they synced) into the settings table,
 * so an upgrade keeps them. A key that already has a row is left alone. The old
 * keys are removed afterwards. The fit is recorded as made at the current review
 * count, so the automatic refit does not fire at once.
 */
export async function adoptLegacySettings(now = Date.now()): Promise<void> {
  const retention = SETTING_PARSERS.retention(readLegacy(LEGACY_RETENTION_KEY))
  const rawWeights = readLegacy(LEGACY_WEIGHTS_KEY)
  const fit = SETTING_PARSERS.fit({
    weights: rawWeights ?? null,
    reviews: await db.revlog.count(),
  })

  await db.transaction("rw", db.settings, async () => {
    if (retention !== null && !(await db.settings.get("retention"))) {
      await db.settings.put({ key: "retention", value: retention, updatedAt: now })
    }
    if (fit?.weights && !(await db.settings.get("fit"))) {
      await db.settings.put({ key: "fit", value: fit, updatedAt: now })
    }
  })

  try {
    localStorage.removeItem(LEGACY_RETENTION_KEY)
    localStorage.removeItem(LEGACY_WEIGHTS_KEY)
  } catch {
    // Blocked storage: nothing to clean up.
  }
}
