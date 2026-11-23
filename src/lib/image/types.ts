/** Image types the app stores. Anything else is re-encoded before it is saved. */
export const IMAGE_MIMES = [
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
] as const

export type ImageMime = (typeof IMAGE_MIMES)[number]

export function isImageMime(value: unknown): value is ImageMime {
  return IMAGE_MIMES.some((m) => m === value)
}

/** The longest edge, in pixels, a stored image keeps. */
export const MAX_IMAGE_EDGE = 1600

/** Largest pasted file the app will try to read (before compression). */
export const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024

/** WebP quality used when re-encoding (screenshots with text stay sharp). */
export const WEBP_QUALITY = 0.85
