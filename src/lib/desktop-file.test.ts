// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { isTauriApp, openWithDialog, saveWithDialog } from "./desktop-file"

describe("desktop file dialogs", () => {
  it("reports not-Tauri in a browser", () => {
    expect(isTauriApp()).toBe(false)
  })

  it("falls back cleanly when the native plugins are unavailable", async () => {
    await expect(saveWithDialog("backup.glyph", new Blob(["x"]))).resolves.toBe(
      "unavailable"
    )
    await expect(openWithDialog()).resolves.toBeNull()
  })
})
