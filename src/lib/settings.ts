/**
 * Settings that travel with the data (backups and device sync). Pure (no DB, no
 * React, no ts-fsrs).
 *
 * Each setting is one row `{ key, value, updatedAt }`. A device with no row for
 * a key uses the default and sends nothing for it, so a fresh install never
 * overwrites a tuned device. When two devices disagree the newer `updatedAt`
 * wins, key by key.
 */
import { parseWeights } from "./fsrs/params"
import {
  DEFAULT_LEECH_ACTION,
  DEFAULT_LEECH_THRESHOLD,
  parseLeechAction,
  parseLeechThreshold,
  type LeechAction,
} from "./leech"
import { DEFAULT_RETENTION, parseRetention } from "./retention"

/**
 * The state of the automatic FSRS fit: the fitted weights (null = defaults) and
 * how many reviews the log held when a fit was last attempted. The count is what
 * stops two synced devices from refitting the same history over and over.
 */
export interface FitState {
  weights: number[] | null
  reviews: number
}

export interface SettingValues {
  /** Desired retention, 0.7 to 0.97. */
  retention: number
  fit: FitState
  /** Refit the weights by itself as reviews pile up. */
  autoFit: boolean
  /** Lapses that make a leech; 0 = off. */
  leechThreshold: number
  leechAction: LeechAction
}

export type SettingKey = keyof SettingValues

export const DEFAULT_SETTINGS: SettingValues = {
  retention: DEFAULT_RETENTION,
  fit: { weights: null, reviews: 0 },
  autoFit: true,
  leechThreshold: DEFAULT_LEECH_THRESHOLD,
  leechAction: DEFAULT_LEECH_ACTION,
}

export interface SettingRow {
  key: SettingKey
  /** Already validated for its key (see `SETTING_PARSERS`). */
  value: unknown
  /** ms epoch of the last change; the newer row wins a merge. */
  updatedAt: number
}

function parseFit(stored: unknown): FitState | null {
  if (typeof stored !== "object" || stored === null) return null
  const { weights, reviews } = stored as Record<string, unknown>
  if (
    typeof reviews !== "number" ||
    !Number.isInteger(reviews) ||
    reviews < 0
  ) {
    return null
  }
  if (weights === null) return { weights: null, reviews }
  const parsed = parseWeights(weights)
  return parsed ? { weights: parsed, reviews } : null
}

function parseBool(stored: unknown): boolean | null {
  return typeof stored === "boolean" ? stored : null
}

/** Turns stored JSON into a usable value, or null if it isn't one. */
export const SETTING_PARSERS: {
  [K in SettingKey]: (stored: unknown) => SettingValues[K] | null
} = {
  retention: parseRetention,
  fit: parseFit,
  autoFit: parseBool,
  leechThreshold: parseLeechThreshold,
  leechAction: parseLeechAction,
}

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === "string" && Object.hasOwn(SETTING_PARSERS, key)
}

/** A clean row for a stored or incoming one, or null if any part is invalid. */
export function readSettingRow(v: unknown): SettingRow | null {
  if (typeof v !== "object" || v === null) return null
  const { key, value, updatedAt } = v as Record<string, unknown>
  if (!isSettingKey(key)) return null
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null
  const parsed = SETTING_PARSERS[key](value)
  return parsed === null ? null : { key, value: parsed, updatedAt }
}

/** Every setting's value: the stored one, or the default where there is no usable row. */
export function resolveSettings(rows: readonly SettingRow[]): SettingValues {
  const values: SettingValues = { ...DEFAULT_SETTINGS }
  const set = <K extends SettingKey>(key: K, value: unknown) => {
    const parsed = SETTING_PARSERS[key](value)
    if (parsed !== null) values[key] = parsed
  }
  for (const row of rows) set(row.key, row.value)
  return values
}

/** The larger `updatedAt` wins; an exact tie picks the same row on both devices. */
function pickSetting(local: SettingRow, incoming: SettingRow): SettingRow {
  if (incoming.updatedAt !== local.updatedAt) {
    return incoming.updatedAt > local.updatedAt ? incoming : local
  }
  return JSON.stringify(incoming.value) > JSON.stringify(local.value)
    ? incoming
    : local
}

/**
 * Merges incoming settings into local ones, key by key. Pure and idempotent:
 * `write` holds only the rows that differ from `local`, so merging a file into
 * its own result writes nothing.
 */
export function mergeSettings(
  local: readonly SettingRow[],
  incoming: readonly SettingRow[]
): { merged: SettingRow[]; write: SettingRow[] } {
  const rows = new Map(local.map((row) => [row.key, row]))
  const write = new Map<SettingKey, SettingRow>()
  for (const inc of incoming) {
    const cur = rows.get(inc.key)
    const winner = cur ? pickSetting(cur, inc) : inc
    if (winner !== cur) {
      rows.set(inc.key, winner)
      write.set(inc.key, winner)
    }
  }
  return { merged: [...rows.values()], write: [...write.values()] }
}
