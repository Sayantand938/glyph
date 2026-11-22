import * as React from "react"

import { Dashboard } from "@/components/dashboard"
import type { StudyScope } from "@/components/deck-tree"
import { HeaderMenu } from "@/components/header-menu"
import { ImportModal } from "@/components/import-modal"
import { StudySession } from "@/components/study-session"
import { useBackupControls, type Notice } from "@/hooks/use-backup-controls"
import { formatSummary } from "@/lib/importer"

export default function App() {
  const [importOpen, setImportOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [studying, setStudying] = React.useState<{
    scope: StudyScope
    newLimit: number
  } | null>(null)
  const backup = useBackupControls(setNotice)

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between gap-3 border-b py-4">
        <h1 className="text-base font-semibold tracking-tight">
          glyph<span className="animate-pulse">_</span>
        </h1>
        {!studying && (
          <HeaderMenu
            busy={backup.busy}
            onImportJson={() => setImportOpen(true)}
            onExportBackup={() => void backup.exportFile()}
            onImportBackup={backup.chooseFile}
          />
        )}
        {backup.input}
      </header>

      <main className="flex flex-1 flex-col">
        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className="mt-4 flex items-start justify-between gap-3 rounded-lg border p-3 text-sm"
          >
            <p>{notice.text}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-xs text-muted-foreground underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {studying ? (
          <StudySession
            scope={studying.scope}
            newLimit={studying.newLimit}
            onExit={() => setStudying(null)}
          />
        ) : (
          <Dashboard
            onImportJson={() => setImportOpen(true)}
            onImportBackup={backup.chooseFile}
            onStudy={(scope, newLimit) => {
              setNotice(null)
              setStudying({ scope, newLimit })
            }}
          />
        )}
      </main>

      <footer className="border-t py-4 text-xs text-muted-foreground">
        press <kbd className="border px-1">d</kbd> to toggle dark mode
      </footer>

      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(summary) =>
          setNotice({ text: formatSummary(summary), tone: "info" })
        }
      />
    </div>
  )
}
