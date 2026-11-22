import * as React from "react"
import { UploadIcon } from "lucide-react"

import { ImportModal } from "@/components/import-modal"
import { Button } from "@/components/ui/button"
import { formatSummary } from "@/lib/importer"

// Temporary shell: the real dashboard arrives in Phase 5.
export default function App() {
  const [importOpen, setImportOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-3 border-b py-4">
        <h1 className="text-base font-semibold tracking-tight">
          glyph<span className="animate-pulse">_</span>
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <UploadIcon data-icon="inline-start" />
            Import JSON
          </Button>
          <span className="text-xs text-muted-foreground">v0.0.1</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-3 py-16">
        {notice && (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {notice}
          </p>
        )}
        <p className="text-2xl font-semibold tracking-tight">
          spaced repetition
          <br />
          for multiple choice.
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Offline-first. Local data. No accounts.
        </p>
      </main>

      <footer className="border-t py-4 text-xs text-muted-foreground">
        press <kbd className="border px-1">d</kbd> to toggle dark mode
      </footer>

      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(summary) => setNotice(formatSummary(summary))}
      />
    </div>
  )
}
