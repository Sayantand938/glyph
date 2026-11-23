import type { Deck } from "@/db/types"
import type { DeckRef } from "@/lib/importer"

const fieldClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

function describeRef(ref: DeckRef | null, decks: readonly Deck[]): string {
  if (!ref) return ""
  if (ref.kind === "new") return `Will create "${ref.name}".`
  const deck = decks.find((d) => d.id === ref.id)
  return deck ? `Will use existing "${deck.name}".` : ""
}

/** A "pick an existing deck, or type a new name" pair (used for Subject and Topic). */
export function DeckField({
  id,
  label,
  noun,
  options,
  emptyOptionLabel,
  selectedId,
  onSelect,
  name,
  onName,
  selectDisabled = false,
  nameDisabled = false,
  resolved,
  liveDecks,
}: {
  id: string
  label: string
  /** Lowercase singular, for the placeholder and aria-label. */
  noun: string
  options: readonly Deck[]
  emptyOptionLabel: string
  selectedId: string
  onSelect: (id: string) => void
  name: string
  onName: (name: string) => void
  selectDisabled?: boolean
  nameDisabled?: boolean
  resolved: DeckRef | null
  liveDecks: readonly Deck[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <select
        id={id}
        className={fieldClass}
        value={selectedId}
        disabled={selectDisabled}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">{emptyOptionLabel}</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <input
        className={fieldClass}
        placeholder={`...or type a new ${noun}`}
        aria-label={`New ${noun} name`}
        value={name}
        disabled={nameDisabled}
        onChange={(e) => onName(e.target.value)}
      />
      <p className="min-h-4 text-xs text-muted-foreground">
        {describeRef(resolved, liveDecks)}
      </p>
    </div>
  )
}
