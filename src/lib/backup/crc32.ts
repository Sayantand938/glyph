/** CRC-32 (the zip/gzip polynomial), fed in pieces, for the backup file's footer. */
const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export class Crc32 {
  private value = 0xffffffff

  update(bytes: Uint8Array): this {
    let c = this.value
    for (let i = 0; i < bytes.length; i += 1) {
      c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    }
    this.value = c
    return this
  }

  /** 8 lowercase hex digits. */
  hex(): string {
    return ((this.value ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0")
  }
}
