/** Base64 for putting image bytes in a JSON backup. `btoa`/`atob` exist in browsers and Node. */

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Loose shape check for backup parsing (does not decode). */
export function looksLikeBase64(text: string): boolean {
  return text.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text)
}
