import * as React from "react"
import { ListIcon, SettingsIcon } from "lucide-react"

import { BrowsePage } from "@/components/browse/browse-page"
import { Dashboard } from "@/components/dashboard"
import type { StudyScope } from "@/components/deck-tree"
import { ImportPage } from "@/components/import/import-page"
import { PwaToast } from "@/components/pwa-toast"
import { SettingsPage } from "@/components/settings-page"
import { SyncPage } from "@/components/sync/sync-page"
import { StudyOptionsPage } from "@/components/study/study-options-page"
import { StudySession } from "@/components/study/study-session"
import { Button } from "@/components/ui/button"
import { useAutoFit } from "@/hooks/use-auto-fit"
import { useBackupControls, type Notice } from "@/hooks/use-backup-controls"
import { formatSummary } from "@/lib/importer"
import type { StudyOptions } from "@/lib/study-options"

export default function App() {
  const [importOpen, setImportOpen] = React.useState(false)
  const [syncOpen, setSyncOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // Study is two steps: pick what to include, then the session itself.
  const [picking, setPicking] = React.useState<StudyScope | null>(null)
  const [studying, setStudying] = React.useState<{
    scope: StudyScope
    options: StudyOptions
  } | null>(null)
  // `scope: null` browses every deck.
  const [browsing, setBrowsing] = React.useState<{
    scope: StudyScope | null
  } | null>(null)
  const backup = useBackupControls(setNotice)
  // Refit the FSRS weights between study sessions as reviews pile up. Not while
  // studying, and not during a sync (which writes thousands of reviews and would
  // restart the fit after every part).
  useAutoFit(studying !== null || syncOpen)

  return (
    <div
      className={`mx-auto flex min-h-svh w-full flex-col px-4 sm:px-6 ${
        // The browse table has many columns; give it room on wide screens.
        browsing ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      <header className="flex items-center justify-between gap-3 border-b py-4">
        <h1 className="text-base font-semibold tracking-tight">
          glyph<span className="animate-pulse">_</span>
        </h1>
        {!importOpen &&
          !syncOpen &&
          !studying &&
          !picking &&
          !settingsOpen &&
          !browsing && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Browse all questions"
                title="Browse all questions"
                onClick={() => {
                  setNotice(null)
                  setBrowsing({ scope: null })
                }}
              >
                <ListIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Settings"
                onClick={() => {
                  setNotice(null)
                  setSettingsOpen(true)
                }}
              >
                <SettingsIcon />
              </Button>
            </div>
          )}
        {backup.input}
      </header>

      <main className="flex flex-1 flex-col">
        {notice && !importOpen && (
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

        {syncOpen ? (
          <SyncPage onBack={() => setSyncOpen(false)} />
        ) : importOpen ? (
          <ImportPage
            onClose={() => setImportOpen(false)}
            onImported={(summary) =>
              setNotice({ text: formatSummary(summary), tone: "info" })
            }
          />
        ) : studying ? (
          <StudySession
            scope={studying.scope}
            options={studying.options}
            onExit={() => setStudying(null)}
          />
        ) : picking ? (
          <StudyOptionsPage
            scope={picking}
            onBack={() => setPicking(null)}
            onStart={(options) => {
              setStudying({ scope: picking, options })
              setPicking(null)
            }}
          />
        ) : browsing ? (
          <BrowsePage scope={browsing.scope} onBack={() => setBrowsing(null)} />
        ) : settingsOpen ? (
          <SettingsPage
            busy={backup.busy}
            onBack={() => {
              setNotice(null)
              setSettingsOpen(false)
            }}
            onImportJson={() => setImportOpen(true)}
            onSync={() => setSyncOpen(true)}
            onExportBackup={() => void backup.exportFile()}
            onImportBackup={backup.chooseFile}
          />
        ) : (
          <Dashboard
            onImportJson={() => setImportOpen(true)}
            onImportBackup={backup.chooseFile}
            onStudy={(scope) => {
              setNotice(null)
              setPicking(scope)
            }}
            onBrowse={(scope) => {
              setNotice(null)
              setBrowsing({ scope })
            }}
          />
        )}
      </main>

      <footer className="border-t py-3 text-xs text-muted-foreground">
        Glyph v{__APP_VERSION__}
      </footer>

      <PwaToast />
    </div>
  )
}
