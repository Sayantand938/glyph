import * as React from "react"
import { ClipboardPasteIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Takes a pairing code from the other device, pasted as text. `onCode` returns
 * an error text to show (or null when it worked).
 */
export function CodeEntry({
  onCode,
}: {
  onCode: (code: string) => Promise<string | null>
}) {
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const problem = await onCode(text)
    setBusy(false)
    if (problem) setError(problem)
  }

  // One tap on a phone; the clipboard may be refused, then paste by hand.
  const paste = async () => {
    setError(null)
    try {
      setText(await navigator.clipboard.readText())
    } catch {
      setError("Could not read the clipboard. Paste into the box instead.")
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor="pairing-paste" className="sr-only">
        Pairing code from the other device
      </label>
      <textarea
        id="pairing-paste"
        value={text}
        rows={4}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="glyph1:..."
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-none rounded-lg border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void paste()}
        >
          <ClipboardPasteIcon />
          Paste from clipboard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || text.trim() === ""}
          onClick={() => void submit()}
        >
          Use this code
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
