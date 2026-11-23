import * as React from "react"
import {
  ArrowLeftIcon,
  BarChart3Icon,
  ChevronRightIcon,
  DownloadIcon,
  FileUpIcon,
  ShareIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SunIcon,
  UploadIcon,
} from "lucide-react"

import { BackupStatusLine } from "@/components/backup-status"
import { FsrsOptimizer } from "@/components/fsrs-optimizer"
import { Button } from "@/components/ui/button"
import {
  clampRetention,
  DEFAULT_RETENTION,
  MAX_RETENTION,
  MIN_RETENTION,
} from "@/db/scheduler"
import type { BackupStatus } from "@/hooks/use-backup-status"
import { useHistoryLayer } from "@/hooks/use-history-layer"
import { useSetting } from "@/hooks/use-settings"
import { useTheme, type Theme } from "@/hooks/use-theme"
import type { SnapshotMeta } from "@/lib/backup"
import { DEFAULT_LEECH_THRESHOLD, MAX_LEECH_THRESHOLD } from "@/lib/leech"
import { version } from "../../package.json"

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon aria-hidden /> },
  { value: "dark", label: "Dark", icon: <MoonIcon aria-hidden /> },
  { value: "system", label: "System", icon: <MonitorIcon aria-hidden /> },
]

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 border-b py-6 last:border-b-0">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function DataAction({
  icon,
  title,
  description,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex w-full items-center gap-3 bg-card p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 sm:p-4"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground transition-colors group-hover:bg-background [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  )
}

/** The copies made before file imports: put one back to undo an import. */
function ImportCopies({
  snapshots,
  busy,
  onRestore,
  onRemove,
}: {
  snapshots: SnapshotMeta[]
  busy: boolean
  onRestore: (meta: SnapshotMeta) => void
  onRemove: (meta: SnapshotMeta) => void
}) {
  if (snapshots.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Undo an import
      </p>
      <p className="text-xs text-muted-foreground">
        Before every backup import Glyph keeps a copy of your data here (the
        last {snapshots.length > 1 ? snapshots.length : "one"}, inside this
        browser). Putting one back replaces your data with it.
      </p>
      <ul className="divide-y overflow-hidden rounded-xl border">
        {snapshots.map((meta) => (
          <li
            key={meta.at}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <span className="min-w-0">
              <span className="block">
                {new Date(meta.at).toLocaleString()}
              </span>
              <span className="block text-xs text-muted-foreground">
                {meta.reason}: {meta.notes} questions, {meta.reviews} reviews,{" "}
                {(meta.bytes / 1e6).toFixed(1)} MB
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRestore(meta)}
              >
                Put back
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onRemove(meta)}
              >
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Full-page settings: theme, data (import / export), statistics (placeholder)
 * and app info. Results of the data actions show in the notice banner that
 * App renders above this page.
 */
export function SettingsPage({
  busy,
  onBack,
  onImportJson,
  onExportBackup,
  onImportBackup,
  onSync,
  status,
  shareReady,
  onShare,
  snapshots,
  onRestore,
  onRemoveSnapshot,
}: {
  snapshots: SnapshotMeta[]
  onRestore: (meta: SnapshotMeta) => void
  onRemoveSnapshot: (meta: SnapshotMeta) => void
  status: BackupStatus
  shareReady: boolean
  onShare: () => void
  busy: boolean
  onBack: () => void
  onSync: () => void
  onImportJson: () => void
  onExportBackup: () => void
  onImportBackup: () => void
}) {
  const { theme, setTheme } = useTheme()
  useHistoryLayer(onBack)
  const [retention, setRetention] = useSetting("retention")
  const [leechThreshold, setLeechThreshold] = useSetting("leechThreshold")
  const [leechAction, setLeechAction] = useSetting("leechAction")
  const [thresholdDraft, setThresholdDraft] = React.useState<string | null>(
    null
  )

  return (
    <div className="flex flex-col py-4">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="text-base font-semibold tracking-tight">Settings</h2>
      </div>

      <Section
        title="Appearance"
        description="Pick a theme, or follow your device."
      >
        <div
          role="group"
          aria-label="Theme"
          className="grid grid-cols-3 gap-2 sm:max-w-sm"
        >
          {THEMES.map(({ value, label, icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              size="sm"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              {icon}
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Scheduling"
        description="How likely you want to be to truly remember a card (not just guess it) when it comes due. Higher means more frequent reviews; lower means fewer, but more forgetting. Applies to reviews from now on. These settings sync with your backups and devices."
      >
        <div className="space-y-2 sm:max-w-sm">
          <div className="flex items-center justify-between text-sm">
            <label htmlFor="retention" className="text-muted-foreground">
              Desired retention
            </label>
            <span className="font-mono">{Math.round(retention * 100)}%</span>
          </div>
          <input
            id="retention"
            type="range"
            className="w-full accent-primary"
            min={Math.round(MIN_RETENTION * 100)}
            max={Math.round(MAX_RETENTION * 100)}
            step={1}
            value={Math.round(retention * 100)}
            onChange={(e) =>
              setRetention(clampRetention(+e.target.value / 100))
            }
          />
          <Button
            variant="outline"
            size="sm"
            disabled={retention === DEFAULT_RETENTION}
            onClick={() => setRetention(DEFAULT_RETENTION)}
          >
            Reset to {Math.round(DEFAULT_RETENTION * 100)}%
          </Button>
        </div>
        <FsrsOptimizer />
      </Section>

      <Section
        title="Leeches"
        description="A question you keep forgetting is often badly worded, or has a weak wrong option. When a question has been forgotten this many times it is tagged leech, so you can find it in Browse (Leeches) and fix it. This only marks questions; it never limits how many you study."
      >
        <div className="space-y-3 sm:max-w-sm">
          <div className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor="leech-threshold" className="text-muted-foreground">
              Lapses before a leech
            </label>
            <input
              id="leech-threshold"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_LEECH_THRESHOLD}
              step={1}
              className="h-8 w-20 rounded-lg border border-input bg-background px-2.5 text-right font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              // A draft lets the box be emptied while typing; it only saves a
              // valid whole number.
              value={thresholdDraft ?? String(leechThreshold)}
              onChange={(e) => {
                setThresholdDraft(e.target.value)
                const n = e.target.valueAsNumber
                if (Number.isInteger(n) && n >= 0 && n <= MAX_LEECH_THRESHOLD) {
                  setLeechThreshold(n)
                }
              }}
              onBlur={() => setThresholdDraft(null)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {leechThreshold === 0
              ? "Off: no question is marked."
              : `At ${leechThreshold} lapses, then every ${Math.max(1, Math.floor(leechThreshold / 2))} more.`}
          </p>
          <div
            role="group"
            aria-label="When a question becomes a leech"
            className="grid grid-cols-2 gap-2"
          >
            <Button
              variant={leechAction === "tag" ? "default" : "outline"}
              size="sm"
              aria-pressed={leechAction === "tag"}
              disabled={leechThreshold === 0}
              onClick={() => setLeechAction("tag")}
            >
              Tag only
            </Button>
            <Button
              variant={leechAction === "suspend" ? "default" : "outline"}
              size="sm"
              aria-pressed={leechAction === "suspend"}
              disabled={leechThreshold === 0}
              onClick={() => setLeechAction("suspend")}
            >
              Tag and suspend
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={
              leechThreshold === DEFAULT_LEECH_THRESHOLD &&
              leechAction === "tag"
            }
            onClick={() => {
              setLeechThreshold(DEFAULT_LEECH_THRESHOLD)
              setLeechAction("tag")
            }}
          >
            Reset to {DEFAULT_LEECH_THRESHOLD} lapses, tag only
          </Button>
        </div>
      </Section>

      <Section
        title="Data"
        description="Your data lives only in this browser. Move it between devices with a backup file."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Questions
            </p>
            <div className="divide-y overflow-hidden rounded-xl border">
              <DataAction
                icon={<UploadIcon aria-hidden />}
                title="Import questions"
                description="Add decks and questions from a JSON file."
                onClick={onImportJson}
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Devices
            </p>
            <div className="divide-y overflow-hidden rounded-xl border">
              <DataAction
                icon={<RefreshCwIcon aria-hidden />}
                title="Sync with another device"
                description="Merge with a phone or computer on the same wifi, no server."
                onClick={onSync}
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Backup
            </p>
            <div className="divide-y overflow-hidden rounded-xl border">
              <DataAction
                icon={<DownloadIcon aria-hidden />}
                title="Export backup"
                description="Save everything (decks, progress, images) to a file."
                disabled={busy}
                onClick={onExportBackup}
              />
              {shareReady && (
                <DataAction
                  icon={<ShareIcon aria-hidden />}
                  title="Share backup file"
                  description="The backup is ready. Tap to save it with the share sheet."
                  onClick={onShare}
                />
              )}
              <DataAction
                icon={<FileUpIcon aria-hidden />}
                title="Restore backup"
                description="Load a backup file and merge it into this device."
                disabled={busy}
                onClick={onImportBackup}
              />
            </div>
            <BackupStatusLine status={status} />
            <p className="text-xs text-muted-foreground">
              Backups are manual: export a file now and then (a synced folder
              such as Dropbox or OneDrive is a good place to keep it). Glyph
              reminds you when one is due.
            </p>
            <ImportCopies
              snapshots={snapshots}
              busy={busy}
              onRestore={onRestore}
              onRemove={onRemoveSnapshot}
            />
          </div>
        </div>
      </Section>

      <Section title="Statistics">
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <BarChart3Icon className="size-4 shrink-0" aria-hidden />
          <p>Review statistics are coming soon.</p>
        </div>
      </Section>

      <Section title="About">
        <dl className="flex items-center justify-between text-sm sm:max-w-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{version}</dd>
        </dl>
      </Section>
    </div>
  )
}
