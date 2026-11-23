import { describe, expect, it } from "vitest"

import {
  base64ToBytes,
  bytesToBase64,
  fitWithin,
  imageId,
  imageIdsIn,
  imageIdsInNotes,
  imageSourcesInHtml,
  imageToken,
  insertAt,
  looksLikeBase64,
  parseDataUrl,
} from "./image"
import { missingImages } from "./backup"

const A = "0123456789abcdef0123456789abcdef"
const B = "fedcba9876543210fedcba9876543210"

describe("imageToken / imageIdsIn", () => {
  it("builds a token and finds it again", () => {
    expect(imageToken(A)).toBe(`![](img:${A})`)
    expect(imageToken(A, "a [b]\nc")).toBe(`![a bc](img:${A})`)
    expect(
      imageIdsIn(`see ${imageToken(A)} and ${imageToken(B, "x")}`)
    ).toEqual([A, B])
  })

  it("lists each id once, in order of first use", () => {
    expect(
      imageIdsIn(`${imageToken(B)} ${imageToken(A)} ${imageToken(B)}`)
    ).toEqual([B, A])
  })

  it("ignores URLs and malformed ids", () => {
    expect(imageIdsIn("![x](https://example.com/a.png)")).toEqual([])
    expect(imageIdsIn("![x](img:short)")).toEqual([])
    expect(imageIdsIn(`![x](img:${A.toUpperCase()})`)).toEqual([])
    expect(imageIdsIn(`[x](img:${A})`)).toEqual([])
  })

  it("collects ids from question, options and extra of many notes", () => {
    const ids = imageIdsInNotes([
      { question: imageToken(A), options: ["a", "b", "c", "d"], extra: "" },
      { question: "q", options: ["a", imageToken(B), "c", "d"], extra: "" },
      { question: "q", options: ["a", "b", "c", "d"], extra: imageToken(A) },
    ])
    expect([...ids].sort()).toEqual([A, B].sort())
  })
})

describe("insertAt", () => {
  it("inserts at the caret and returns the caret after the text", () => {
    expect(insertAt("", 0, 0, "T", "\n")).toEqual({ value: "T", caret: 1 })
  })

  it("separates the token from neighbouring words", () => {
    expect(insertAt("ab cd", 2, 2, "T", " ")).toEqual({
      value: "ab T cd",
      caret: 4,
    })
    expect(insertAt("abcd", 2, 2, "T", "\n")).toEqual({
      value: "ab\nT\ncd",
      caret: 5,
    })
  })

  it("adds no separator next to whitespace", () => {
    expect(insertAt("ab\n", 3, 3, "T", "\n").value).toBe("ab\nT")
    expect(insertAt("ab\ncd", 3, 3, "T", "\n").value).toBe("ab\nT\ncd")
  })

  it("replaces a selection and clamps out-of-range positions", () => {
    expect(insertAt("hello", 1, 4, "T", " ").value).toBe("h T o")
    expect(insertAt("abc", 99, 120, "T", " ").value).toBe("abc T")
    expect(insertAt("abc", -5, -1, "T", " ").value).toBe("T abc")
  })
})

describe("fitWithin", () => {
  it("leaves small images alone and never scales up", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 })
  })

  it("scales the longer edge down to the limit, keeping the ratio", () => {
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 })
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 })
  })

  it("keeps each side at least 1 pixel", () => {
    expect(fitWithin(100000, 10, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe("base64", () => {
  it("round-trips bytes, including large ones", () => {
    const bytes = new Uint8Array(100_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=")
  })

  it("recognises base64 loosely", () => {
    expect(looksLikeBase64("aGk=")).toBe(true)
    expect(looksLikeBase64("")).toBe(false)
    expect(looksLikeBase64("not base64!")).toBe(false)
  })
})

describe("imageId", () => {
  it("is the first 32 hex digits of the SHA-256", async () => {
    const bytes = new TextEncoder().encode("abc")
    // SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 ...
    expect(await imageId(bytes.buffer)).toBe("ba7816bf8f01cfea414140de5dae2223")
  })

  it("is stable for equal bytes and differs for different bytes", async () => {
    const a = new Uint8Array([1, 2, 3]).buffer
    const b = new Uint8Array([1, 2, 4]).buffer
    expect(await imageId(a)).toBe(
      await imageId(new Uint8Array([1, 2, 3]).buffer)
    )
    expect(await imageId(a)).not.toBe(await imageId(b))
  })
})

describe("imageSourcesInHtml", () => {
  it("lists the src of every img tag, in order", () => {
    const html =
      '<meta charset="utf-8"><p>hi</p><img alt="a" src="https://x.test/a.png" width="3">' +
      "<IMG SRC='data:image/png;base64,AAAA'><img src=\"\"><img alt=x>"
    expect(imageSourcesInHtml(html)).toEqual([
      "https://x.test/a.png",
      "data:image/png;base64,AAAA",
    ])
  })

  it("returns nothing for html without images or for empty input", () => {
    expect(imageSourcesInHtml("<p>text <b>only</b></p>")).toEqual([])
    expect(imageSourcesInHtml("")).toEqual([])
  })
})

describe("parseDataUrl", () => {
  it("decodes a base64 image data URL", () => {
    expect(parseDataUrl("data:image/png;base64,aGk=")).toEqual({
      mime: "image/png",
      bytes: new Uint8Array([104, 105]),
    })
    expect(parseDataUrl("data:image/webp;base64,aG\nk=")?.mime).toBe(
      "image/webp"
    )
  })

  it("rejects links, non-images and non-base64 data", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull()
    expect(parseDataUrl("blob:https://example.com/1234")).toBeNull()
    expect(parseDataUrl("data:text/html;base64,aGk=")).toBeNull()
    expect(parseDataUrl("data:image/svg+xml;utf8,<svg/>")).toBeNull()
    expect(parseDataUrl("data:image/png;base64,not base64!")).toBeNull()
    expect(parseDataUrl("data:image/png;base64,")).toBeNull()
  })
})

describe("missingImages", () => {
  const img = (id: string) => ({
    id,
    mime: "image/webp",
    width: 1,
    height: 1,
    data: "AA==",
  })

  it("returns only images the device lacks, once each", () => {
    expect(
      missingImages([A], [img(A), img(B), img(B)]).map((i) => i.id)
    ).toEqual([B])
    expect(missingImages([], [])).toEqual([])
  })
})
