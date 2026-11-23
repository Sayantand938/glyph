import { CheckIcon, EyeOffIcon, PauseIcon } from "lucide-react"

import { FlagGlyph } from "@/components/flag-icon"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { FLAG_VALUES, flagName } from "@/lib/card-marks"

function Hint({ text }: { text: string }) {
  return (
    <kbd className="ml-auto pl-4 font-sans text-xs text-muted-foreground">
      {text}
    </kbd>
  )
}

/**
 * Menu items to flag, suspend or bury one card, shared by the study toolbar
 * and the browse list. Picking the card's current flag clears it. With
 * `shortcuts` each item shows its keyboard shortcut (the study session).
 */
export function CardMarkItems({
  flag,
  suspended,
  buried,
  shortcuts = false,
  onFlag,
  onSuspend,
  onBury,
}: {
  flag: number
  suspended: boolean
  buried: boolean
  shortcuts?: boolean
  /** 0 clears the flag. */
  onFlag: (flag: number) => void
  onSuspend: () => void
  onBury: () => void
}) {
  return (
    <>
      {FLAG_VALUES.map((value) => (
        <DropdownMenuItem
          key={value}
          onClick={() => onFlag(flag === value ? 0 : value)}
        >
          <FlagGlyph flag={value} labelled={false} />
          {flagName(value)}
          {flag === value ? (
            <>
              <span className="sr-only">(current flag)</span>
              <CheckIcon aria-hidden className="ml-auto" />
            </>
          ) : (
            shortcuts && <Hint text={`Ctrl+${value}`} />
          )}
        </DropdownMenuItem>
      ))}
      {flag > 0 && (
        <DropdownMenuItem onClick={() => onFlag(0)}>
          <FlagGlyph flag={0} labelled={false} />
          Remove flag
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onSuspend}>
        <PauseIcon aria-hidden />
        {suspended ? "Unsuspend" : "Suspend"}
        {shortcuts && !suspended && <Hint text="S" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onBury}>
        <EyeOffIcon aria-hidden />
        {buried ? "Unbury" : "Bury until tomorrow"}
        {shortcuts && !buried && <Hint text="-" />}
      </DropdownMenuItem>
    </>
  )
}
