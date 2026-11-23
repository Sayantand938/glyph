import { FlagIcon } from "lucide-react"

import { flagName } from "@/lib/card-marks"
import { cn } from "@/lib/utils"

import { flagText } from "./flag-style"

/**
 * A flag in its colour: filled when `flag` is 1-7, an outline in the current
 * text colour for no flag. The colour name is the accessible label, so the
 * flag never depends on colour alone.
 */
export function FlagGlyph({
  flag,
  className,
  labelled = true,
}: {
  flag: number
  className?: string
  /** False when a visible label already names the flag. */
  labelled?: boolean
}) {
  const colour = flagText(flag)
  return (
    <FlagIcon
      className={cn(colour && `${colour} fill-current`, className)}
      aria-label={labelled ? flagName(flag) : undefined}
      aria-hidden={labelled ? undefined : true}
    />
  )
}
