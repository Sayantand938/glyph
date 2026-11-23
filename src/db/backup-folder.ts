/**
 * The folder for automatic backups (browser only; Chrome and Edge on a
 * computer, where `showDirectoryPicker` exists). The folder handle is kept in
 * its own small IndexedDB database, not in the Glyph one: a handle belongs to
 * this device, is never part of a backup or a sync, and must not change the
 * schema.
 */
import { autoBackupName, autoBackupsToDelete } from "@/lib/backup"

import { makeBackupFile } from "./backup-file"

type Mode = { mode: "readwrite" }

/** The parts of the File System Access API this file uses (not in lib.dom). */
export interface FolderHandle {
  readonly name: string
  queryPermission(descriptor: Mode): Promise<PermissionState>
  requestPermission(descriptor: Mode): Promise<PermissionState>
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>
      close(): Promise<void>
    }>
  }>
  removeEntry(name: string): Promise<void>
  keys(): AsyncIterable<string>
}

type Picker = (options: { mode: "readwrite" }) => Promise<FolderHandle>

const DB_NAME = "glyph-local"
const STORE = "handles"
const KEY = "backup-folder"

export function folderBackupSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: Picker })
      .showDirectoryPicker === "function"
  )
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openStore()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

/** The saved folder, or null (none chosen, or storage is not available). */
export async function loadBackupFolder(): Promise<FolderHandle | null> {
  try {
    const value = await withStore("readonly", (s) => s.get(KEY))
    return (value as FolderHandle | undefined) ?? null
  } catch {
    return null
  }
}

/** Asks the person for a folder and remembers it. Null when they cancel. */
export async function chooseBackupFolder(): Promise<FolderHandle | null> {
  const pick = (window as unknown as { showDirectoryPicker: Picker })
    .showDirectoryPicker
  let handle: FolderHandle
  try {
    handle = await pick.call(window, { mode: "readwrite" })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null
    }
    throw error
  }
  await withStore("readwrite", (s) => s.put(handle, KEY))
  return handle
}

export async function forgetBackupFolder(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(KEY))
}

/** "granted", or "prompt" when the person must be asked again (needs a click). */
export async function folderPermission(
  handle: FolderHandle
): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: "readwrite" })
  } catch {
    return "denied"
  }
}

export async function askFolderPermission(
  handle: FolderHandle
): Promise<boolean> {
  try {
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted"
  } catch {
    return false
  }
}

/**
 * Writes today's automatic backup into the folder (replacing today's earlier
 * one) and deletes the older automatic ones beyond the seven newest. The file
 * is checked before it is written, and nothing but our own `glyph-auto-*` files
 * is ever deleted. Returns the file name and size.
 */
export async function writeAutoBackup(
  handle: FolderHandle,
  now = Date.now()
): Promise<{ name: string; bytes: number; notes: number }> {
  const made = await makeBackupFile(now)
  const name = autoBackupName(now, made.compressed)
  const file = await handle.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(made.blob)
  await writable.close()

  const names: string[] = []
  for await (const entry of handle.keys()) names.push(entry)
  for (const old of autoBackupsToDelete(names)) {
    try {
      await handle.removeEntry(old)
    } catch {
      // Could not delete an old file (open elsewhere): leave it.
    }
  }
  return { name, bytes: made.blob.size, notes: made.info.rows.notes }
}
