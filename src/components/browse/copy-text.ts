/**
 * Copies text to the clipboard. Uses the async Clipboard API, and falls back
 * to a hidden textarea where it is missing or refused (older browsers, some
 * non-secure pages). Rejects when neither works.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the textarea route.
    }
  }

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  try {
    area.select()
    if (!document.execCommand("copy")) throw new Error("Copy was refused.")
  } finally {
    area.remove()
  }
}
