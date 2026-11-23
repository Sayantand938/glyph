/**
 * The size an image should be stored at: unchanged if its longer edge is
 * within `maxEdge`, otherwise scaled down to it, keeping the aspect ratio.
 * Never scales up. Each side is at least 1.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
