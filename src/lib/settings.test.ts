import { describe, expect, it } from "vitest"

import { AUTO_FIT_STEP, autoFitStep, shouldAutoFit } from "./fsrs/auto"
import { DEFAULT_WEIGHTS, MIN_SCORED_REVIEWS } from "./fsrs"
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  readSettingRow,
  resolveSettings,
  type SettingRow,
} from "./settings"

const row = (
  key: SettingRow["key"],
  value: unknown,
  updatedAt: number
): SettingRow => ({ key, value, updatedAt })

describe("resolveSettings", () => {
  it("falls back to the defaults", () => {
    expect(resolveSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  it("uses stored values and ignores unusable ones", () => {
    const values = resolveSettings([
      row("retention", 0.9, 1),
      row("leechThreshold", "x", 1),
      row("leechAction", "suspend", 1),
    ])
    expect(values.retention).toBe(0.9)
    expect(values.leechThreshold).toBe(DEFAULT_SETTINGS.leechThreshold)
    expect(values.leechAction).toBe("suspend")
  })

  it("has no review or study cap setting", () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      "autoFit",
      "fit",
      "leechAction",
      "leechThreshold",
      "retention",
    ])
  })
})

describe("readSettingRow", () => {
  it("accepts a valid row and normalizes the value", () => {
    expect(readSettingRow(row("retention", 0.999, 5))).toEqual(
      row("retention", 0.97, 5)
    )
    expect(readSettingRow(row("autoFit", false, 5))).toEqual(
      row("autoFit", false, 5)
    )
  })

  it("accepts a fit with or without weights", () => {
    expect(
      readSettingRow(row("fit", { weights: null, reviews: 300 }, 1))
    ).toEqual(row("fit", { weights: null, reviews: 300 }, 1))
    const fit = readSettingRow(
      row("fit", { weights: [...DEFAULT_WEIGHTS], reviews: 0 }, 1)
    )
    expect(fit?.key).toBe("fit")
  })

  it("rejects unknown keys, bad values and bad times", () => {
    expect(readSettingRow(row("newLimit" as never, 30, 1))).toBeNull()
    expect(readSettingRow(row("retention", "0.9", 1))).toBeNull()
    expect(readSettingRow(row("fit", { weights: [1, 2], reviews: 3 }, 1))).toBe(
      null
    )
    expect(readSettingRow(row("fit", { weights: null, reviews: -1 }, 1))).toBe(
      null
    )
    expect(readSettingRow(row("autoFit", true, Number.NaN))).toBeNull()
    expect(readSettingRow(null)).toBeNull()
  })

  it("does not accept a key that only exists on Object.prototype", () => {
    expect(
      readSettingRow({ key: "toString", value: 1, updatedAt: 1 })
    ).toBeNull()
  })
})

describe("mergeSettings", () => {
  it("takes keys the device does not have", () => {
    const { merged, write } = mergeSettings([], [row("retention", 0.9, 1)])
    expect(merged).toEqual([row("retention", 0.9, 1)])
    expect(write).toEqual([row("retention", 0.9, 1)])
  })

  it("the newer change wins, key by key", () => {
    const local = [row("retention", 0.9, 10), row("leechThreshold", 5, 1)]
    const incoming = [row("retention", 0.8, 5), row("leechThreshold", 9, 2)]
    const { merged, write } = mergeSettings(local, incoming)
    expect(write).toEqual([row("leechThreshold", 9, 2)])
    expect(resolveSettings(merged).retention).toBe(0.9)
    expect(resolveSettings(merged).leechThreshold).toBe(9)
  })

  it("is idempotent", () => {
    const local = [row("retention", 0.9, 10)]
    const incoming = [row("retention", 0.8, 20), row("autoFit", false, 3)]
    const once = mergeSettings(local, incoming)
    expect(mergeSettings(once.merged, incoming).write).toEqual([])
  })

  it("a tie picks the same row on both devices", () => {
    const a = row("retention", 0.8, 5)
    const b = row("retention", 0.9, 5)
    const onA = mergeSettings([a], [b]).merged
    const onB = mergeSettings([b], [a]).merged
    expect(onA).toEqual(onB)
  })
})

describe("shouldAutoFit", () => {
  const on = { enabled: true }

  it("waits for enough reviews", () => {
    expect(
      shouldAutoFit({
        ...on,
        reviews: MIN_SCORED_REVIEWS - 1,
        lastFitReviews: 0,
      })
    ).toBe(false)
    expect(
      shouldAutoFit({ ...on, reviews: MIN_SCORED_REVIEWS, lastFitReviews: 0 })
    ).toBe(true)
  })

  it("refits every step after the last attempt", () => {
    const last = 500
    expect(
      shouldAutoFit({
        ...on,
        reviews: last + AUTO_FIT_STEP - 1,
        lastFitReviews: last,
      })
    ).toBe(false)
    expect(
      shouldAutoFit({
        ...on,
        reviews: last + AUTO_FIT_STEP,
        lastFitReviews: last,
      })
    ).toBe(true)
  })

  it("waits longer as the log grows", () => {
    expect(autoFitStep(0)).toBe(AUTO_FIT_STEP)
    expect(autoFitStep(1000)).toBe(AUTO_FIT_STEP)
    expect(autoFitStep(2000)).toBe(AUTO_FIT_STEP)
    expect(autoFitStep(2001)).toBe(201)
    expect(autoFitStep(20000)).toBe(2000)
    const last = 20000
    expect(
      shouldAutoFit({ ...on, reviews: last + 1999, lastFitReviews: last })
    ).toBe(false)
    expect(
      shouldAutoFit({ ...on, reviews: last + 2000, lastFitReviews: last })
    ).toBe(true)
  })

  it("does nothing when switched off or after the log shrank", () => {
    expect(
      shouldAutoFit({ enabled: false, reviews: 5000, lastFitReviews: 0 })
    ).toBe(false)
    expect(shouldAutoFit({ ...on, reviews: 400, lastFitReviews: 900 })).toBe(
      false
    )
  })
})
