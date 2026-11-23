// Full class names (not built from the flag number) so Tailwind sees them.
const TEXT: readonly string[] = [
  "text-red-500",
  "text-orange-500",
  "text-green-500",
  "text-blue-500",
  "text-pink-500",
  "text-cyan-500",
  "text-purple-500",
]

const BORDER: readonly string[] = [
  "border-red-500",
  "border-orange-500",
  "border-green-500",
  "border-blue-500",
  "border-pink-500",
  "border-cyan-500",
  "border-purple-500",
]

/** Text colour class of a flag (1-7); empty for "no flag". */
export function flagText(flag: number): string {
  return TEXT[flag - 1] ?? ""
}

/** Border colour class of a flag (1-7); empty for "no flag". */
export function flagBorder(flag: number): string {
  return BORDER[flag - 1] ?? ""
}
