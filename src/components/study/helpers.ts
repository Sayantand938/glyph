import type { Phase } from "./types"

export const LABELS = ["A", "B", "C", "D"] as const

export const KEYBOARD_HELP =
  "Keyboard\nQuestion: 1-4 / A-D pick, E edit, Esc exit\nAfter wrong: Space next\nAfter right: Space/P/1 pass, F/2 fail\nAny time: Z undo"

export const currentTime = (): number => Date.now()

export function parseBool(stored: unknown): boolean | null {
  return typeof stored === "boolean" ? stored : null
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** The one-line shortcut reminder under the card. */
export function hintFor(kind: Phase["kind"]): string {
  switch (kind) {
    case "question":
      return "1-4 or A-D pick, E edit, Z undo, Esc exit"
    case "wrong":
      return "Space next, E edit, Z undo, Esc exit"
    case "right":
      return "Space or P pass, F fail, E edit, Z undo"
  }
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  )
}

export function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.tagName === "A")
  )
}

export function dropFocus() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}
