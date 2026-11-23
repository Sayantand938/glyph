import * as React from "react"

import { Rating, type Grade } from "@/db/scheduler"
import { flagFromKeyCode } from "@/lib/card-marks"

import { isButtonTarget, isMenuTarget, isTypingTarget } from "./helpers"
import type { Phase } from "./types"

export interface StudyKeyContext {
  /** False while an edit, confirm or help page is open, or before the queue loads. */
  active: boolean
  phase: Phase["kind"] | null
  empty: boolean
  finished: boolean
  gone: boolean
  hasCard: boolean
  onExitRequest: () => void
  onLeave: () => void
  onUndo: () => void
  onEdit: () => void
  onPick: (slot: number) => void
  onNext: () => void
  onSkipGone: () => void
  onGrade: (rating: Grade) => void
  onSuspend: () => void
  onBury: () => void
  /** Ctrl+1 .. Ctrl+7: toggle that flag on the current card. */
  onFlag: (flag: number) => void
  onHelp: () => void
}

/**
 * Keyboard shortcuts (the full list is `SHORTCUT_GROUPS` in helpers.ts). The
 * listener is registered once (capture phase, so it runs before dialog
 * handlers) and calls the latest handler.
 */
export function useStudyKeys(ctx: StudyKeyContext) {
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.altKey) return
    if (!ctx.active || isTypingTarget(event.target)) return
    // An open menu (flag / suspend / bury) handles its own keys.
    if (isMenuTarget(event.target)) return
    if (ctx.phase === null) return

    const onCard = ctx.hasCard && !ctx.empty && !ctx.finished && !ctx.gone

    // Ctrl+1 .. Ctrl+7 sets a flag. Read from `code`, so it works on any layout.
    if (event.ctrlKey) {
      const flag = event.shiftKey ? null : flagFromKeyCode(event.code)
      if (flag !== null && onCard) {
        ctx.onFlag(flag)
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    const key = event.key.toLowerCase()
    const confirmKey = key === " " || key === "enter"
    // A focused button handles Space/Enter itself.
    if (confirmKey && isButtonTarget(event.target)) return

    let handled = true
    if (key === "escape") ctx.onExitRequest()
    else if (key === "z") ctx.onUndo()
    else if (key === "?") ctx.onHelp()
    else if (ctx.empty || ctx.finished) {
      if (confirmKey) ctx.onLeave()
      else handled = false
    } else if (ctx.gone) {
      if (confirmKey) ctx.onSkipGone()
      else handled = false
    } else if (!ctx.hasCard) handled = false
    else if (key === "e") ctx.onEdit()
    else if (key === "s" || key === "@") ctx.onSuspend()
    else if (key === "-") ctx.onBury()
    else if (ctx.phase === "question") {
      const slot = "1234".indexOf(key)
      const letter = "abcd".indexOf(key)
      if (key.length === 1 && slot >= 0) ctx.onPick(slot)
      else if (key.length === 1 && letter >= 0) ctx.onPick(letter)
      else handled = false
    } else if (ctx.phase === "wrong") {
      if (confirmKey) ctx.onNext()
      else handled = false
    } else if (confirmKey || key === "p" || key === "1") {
      ctx.onGrade(Rating.Good)
    } else if (key === "f" || key === "2") ctx.onGrade(Rating.Again)
    else handled = false

    if (handled) {
      // Stop here so a dialog opened by this key doesn't see the same event
      // (an Escape that opens the exit dialog would close it again at once).
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const latestOnKey = React.useRef(onKey)
  React.useEffect(() => {
    latestOnKey.current = onKey
  })
  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => latestOnKey.current(event)
    window.addEventListener("keydown", listener, true)
    return () => window.removeEventListener("keydown", listener, true)
  }, [])
}
