import * as React from "react"
import { ListIcon, SettingsIcon } from "lucide-react"

import { BrowsePage } from "@/components/browse/browse-page"
import { BackupReminder } from "@/components/backup-status"
import { Dashboard } from "@/components/dashboard"
import type { StudyScope } from "@/components/deck-tree"
import { ImportPage } from "@/components/import/import-page"
import { ImportReviewPage } from "@/components/import-review-page"
import { SettingsPage } from "@/components/settings-page"
import { SyncPage } from "@/components/sync/sync-page"
import { DeckPage } from "@/components/deck-page"
import { StudySession } from "@/components/study/study-session"
import { Button } from "@/components/ui/button"
import { useBackupStatus } from "@/hooks/use-backup-status"
import { useBackupControls, type Notice } from "@/hooks/use-backup-controls"
import { useSyncRunning } from "@/hooks/use-sync-running"
import { formatSummary } from "@/lib/importer"
import type { StudyOptions } from "@/lib/study-options"

export default function App() {
  const [importOpen, setImportOpen] = React.useState(false)
  const [syncOpen, setSyncOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // A clicked deck opens its screen (study options and actions), then the session.
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
  // A sync in another tab of this app: studying waits (see `useSyncRunning`).
  const syncRunning = useSyncRunning()
  // Backups are manual; the dashboard only reminds when one is due.
  const backupStatus = useBackupStatus(backup.busy)

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
          !backup.review &&
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
        {notice && !importOpen && !backup.review && (
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

        {!studying &&
          !picking &&
          !importOpen &&
          !syncOpen &&
          !browsing &&
          !settingsOpen && (
            <BackupReminder
              status={backupStatus}
              busy={backup.busy}
              onExport={() => void backup.exportFile()}
            />
          )}

        {syncRunning && (studying || picking) && (
          <p
            role="status"
            className="mt-4 rounded-lg border p-3 text-sm text-muted-foreground"
          >
            A sync is running in another tab. Studying is paused until it
            finishes, so no review is written in the middle of it.
          </p>
        )}

        {backup.review ? (
          <ImportReviewPage
            review={backup.review}
            onConfirm={backup.confirmReview}
            onCancel={backup.cancelReview}
          />
        ) : syncOpen ? (
          <SyncPage onBack={() => setSyncOpen(false)} />
        ) : importOpen ? (
          <ImportPage
            onClose={() => setImportOpen(false)}
            onImported={(summary) =>
              setNotice({ text: formatSummary(summary), tone: "info" })
            }
          />
        ) : studying ? (
          <div inert={syncRunning} className={syncRunning ? "opacity-50" : ""}>
            <StudySession
              scope={studying.scope}
              options={studying.options}
              locked={syncRunning}
              onExit={() => setStudying(null)}
            />
          </div>
        ) : picking ? (
          <DeckPage
            scope={picking}
            locked={syncRunning}
            onBack={() => setPicking(null)}
            onStart={(scope, options) => {
              setStudying({ scope, options })
              setPicking(null)
            }}
            onBrowse={(scope) => {
              setNotice(null)
              setPicking(null)
              setBrowsing({ scope })
            }}
          />
        ) : browsing ? (
          <BrowsePage scope={browsing.scope} onBack={() => setBrowsing(null)} />
        ) : settingsOpen ? (
          <SettingsPage
            busy={backup.busy}
            status={backupStatus}
            snapshots={backup.snapshots}
            onRestore={backup.startRestore}
            onRemoveSnapshot={(meta) => void backup.removeSnapshot(meta)}
            shareReady={backup.shareReady}
            onShare={() => void backup.shareNow()}
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
            onOpen={(scope) => {
              setNotice(null)
              setPicking(scope)
            }}
          />
        )}
      </main>

      <footer className="border-t py-3 text-xs text-muted-foreground">
        Glyph v{__APP_VERSION__}
      </footer>
    </div>
  )
}
