/**
 * Content-addressed image id: the first 32 hex digits (128 bits) of the
 * SHA-256 of the stored bytes. The same picture always gets the same id, so a
 * screenshot pasted twice is stored once. Needs `crypto.subtle`, which browsers
 * only provide on secure origins (https and localhost).
 */
export async function imageId(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error("Images need a secure (https) connection to be saved.")
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes))
  let hex = ""
  for (const byte of digest.subarray(0, 16)) {
    hex += byte.toString(16).padStart(2, "0")
  }
  return hex
}
