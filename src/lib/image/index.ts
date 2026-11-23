/**
 * Image helpers for note text. Pure except `encode.ts` (browser-only); import
 * the pure parts from here and the encoder from "@/lib/image/encode".
 */
export { base64ToBytes, bytesToBase64, looksLikeBase64 } from "./base64"
export { imageSourcesInHtml, parseDataUrl } from "./clipboard"
export { fitWithin } from "./fit"
export { imageId } from "./id"
export {
  IMAGE_ID_PATTERN,
  IMAGE_ID_RE,
  imageIdsIn,
  imageIdsInNotes,
  imageToken,
  imageTokenRegex,
  insertAt,
} from "./tokens"
export {
  IMAGE_MIMES,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_INPUT_BYTES,
  WEBP_QUALITY,
  isImageMime,
  type ImageMime,
} from "./types"
