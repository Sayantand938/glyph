/**
 * Native file dialogs for the desktop app.
 *
 * The browser download and `<input type="file">` paths still work (and are what
 * a phone or the dev server uses), but on the desktop a real Save/Open dialog
 * is what a daily driver needs: the person chooses where a backup goes, and an
 * import does not depend on the webview's file picker.
 *
 * The plugins are imported lazily so a plain browser build never loads them.
 * Any failure (an old build, a denied scope, a cancelled dialog) falls back to
 * the old path through the return value.
 */

export const BACKUP_FILTERS = [
  { name: "Glyph backup", extensions: ["glyph", "json", "jsonl", "gz"] },
]

/** True inside the Tauri webview; false in a browser or the Vite dev server. */
export function isTauriApp(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  )
}

export type SaveResult = "saved" | "cancelled" | "unavailable"

/** Bytes copied per write; a backup can be hundreds of MB. */
const WRITE_CHUNK = 8 * 1024 * 1024

/** Shows the system Save dialog and streams `blob` there 8 MB at a time. */
export async function saveWithDialog(
  filename: string,
  blob: Blob
): Promise<SaveResult> {
  if (!isTauriApp()) return "unavailable"
  try {
    const [{ save }, fs] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ])
    const path = await save({ defaultPath: filename, filters: BACKUP_FILTERS })
    if (!path) return "cancelled"
    const handle = await fs.create(path)
    try {
      for (let at = 0; at < blob.size; at += WRITE_CHUNK) {
        const part = blob.slice(at, Math.min(at + WRITE_CHUNK, blob.size))
        await handle.write(new Uint8Array(await part.arrayBuffer()))
      }
    } finally {
      await handle.close()
    }
    return "saved"
  } catch (error) {
    console.error("Native save failed; falling back", error)
    return "unavailable"
  }
}

/**
 * Shows the system Open dialog and reads the chosen file. Returns null when
 * cancelled or when the native plugins are unavailable.
 */
export async function openWithDialog(): Promise<File | null> {
  if (!isTauriApp()) return null
  try {
    const [{ open }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ])
    const path = await open({
      multiple: false,
      directory: false,
      filters: BACKUP_FILTERS,
    })
    if (!path || Array.isArray(path)) return null
    const bytes = await readFile(path)
    const name = path.split(/[\\/]/).pop() || "backup"
    return new File([new Uint8Array(bytes)], name)
  } catch (error) {
    console.error("Native open failed; falling back", error)
    return null
  }
}
