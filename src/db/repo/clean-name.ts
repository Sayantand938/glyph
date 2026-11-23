export function cleanName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Name cannot be empty.")
  return trimmed
}
