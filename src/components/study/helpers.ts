import type { Phase } from "./types"

export const LABELS = ["A", "B", "C", "D"] as const

export const KEYBOARD_HELP = "Keyboard shortcuts (press ? for the full list)"

export interface Shortcut {
  /** Keys that do it; any one of them works. */
  keys: readonly string[]
  label: string
}

export interface ShortcutGroup {
  title: string
  items: readonly Shortcut[]
}

/** Every study shortcut, for the help page. Keep in step with use-study-keys.ts. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Answering",
    items: [
      { keys: ["1", "2", "3", "4"], label: "Pick the option in that position" },
      { keys: ["A", "B", "C", "D"], label: "Pick the option with that letter" },
      { keys: ["Space", "Enter"], label: "Next card, after a wrong answer" },
      { keys: ["Space", "P", "1"], label: "Pass, after a right answer" },
      { keys: ["F", "2"], label: "Fail, after a right answer (a guess)" },
    ],
  },
  {
    title: "This card",
    items: [
      { keys: ["E"], label: "Edit the question" },
      { keys: ["S", "@"], label: "Suspend (undo it from Browse or with Z)" },
      { keys: ["-"], label: "Bury until tomorrow" },
      {
        keys: ["Ctrl+1 to Ctrl+7"],
        label: "Set a flag; the same key clears it",
      },
    ],
  },
  {
    title: "Session",
    items: [
      { keys: ["Z"], label: "Undo the last answer, suspend or bury" },
      { keys: ["Esc"], label: "Leave the session" },
      { keys: ["?"], label: "Show this list" },
    ],
  },
]

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
      return "1-4 or A-D pick, E edit, S suspend, - bury, Z undo, ? all keys"
    case "wrong":
      return "Space next, E edit, S suspend, - bury, Z undo, ? all keys"
    case "right":
      return "Space or P pass, F fail, E edit, S suspend, Z undo, ? all keys"
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

/** True when the key came from inside a menu, which handles its own keys. */
export function isMenuTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('[role="menu"], [role="menuitem"]') !== null
  )
}

export function dropFocus() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}
