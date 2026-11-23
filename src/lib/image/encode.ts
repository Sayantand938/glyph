/**
 * Turns a pasted image file into what gets stored: downscaled to
 * `MAX_IMAGE_EDGE` and re-encoded as WebP when that makes it smaller, with a
 * content-hash id. This is the one file in `src/lib/image` that uses browser
 * APIs (createImageBitmap, canvas), so it is not unit-tested; the pure pieces
 * it calls are.
 */
import type { ImageRow } from "@/db/types"

import { bytesToBase64 } from "./base64"
import { fitWithin } from "./fit"
import { imageId } from "./id"
import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_INPUT_BYTES,
  WEBP_QUALITY,
  isImageMime,
} from "./types"

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function encodeImage(file: Blob): Promise<ImageRow> {
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("That image is larger than 15 MB.")
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("Couldn't read that image.")
  }

  try {
    let blob: Blob = file
    let { width, height } = bitmap

    // GIFs are kept as they are so an animation survives.
    if (file.type !== "image/gif") {
      const fit = fitWithin(width, height, MAX_IMAGE_EDGE)
      const resized = fit.width !== width || fit.height !== height

      const canvas = document.createElement("canvas")
      canvas.width = fit.width
      canvas.height = fit.height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Couldn't process that image.")
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, fit.width, fit.height)

      // Some browsers can't encode WebP and quietly return a PNG instead.
      const webp = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY)
      let candidate: Blob | null = webp?.type === "image/webp" ? webp : null
      if (!candidate && (resized || !isImageMime(file.type))) {
        candidate = await canvasToBlob(canvas, "image/png")
      }

      if (
        candidate &&
        (resized || !isImageMime(file.type) || candidate.size < file.size)
      ) {
        blob = candidate
        width = fit.width
        height = fit.height
      }
    }

    const mime = blob.type
    if (!isImageMime(mime)) throw new Error("That image type isn't supported.")
    return {
      id: await imageId(await blob.arrayBuffer()),
      mime,
      width,
      height,
      data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    }
  } finally {
    bitmap.close()
  }
}
