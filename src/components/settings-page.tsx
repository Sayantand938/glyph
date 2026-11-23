import * as React from "react"
import {
  ArrowLeftIcon,
  BarChart3Icon,
  ChevronRightIcon,
  DownloadIcon,
  FileUpIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  clampRetention,
  DEFAULT_RETENTION,
  MAX_RETENTION,
  MIN_RETENTION,
} from "@/db/scheduler"
import { useHistoryLayer } from "@/hooks/use-history-layer"
import { useRetention } from "@/hooks/use-retention"
import { useTheme, type Theme } from "@/hooks/use-theme"
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
}: {
  busy: boolean
  onBack: () => void
  onImportJson: () => void
  onExportBackup: () => void
  onImportBackup: () => void
}) {
  const { theme, setTheme } = useTheme()
  useHistoryLayer(onBack)
  const [retention, setRetention] = useRetention()

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
        description="How likely you want to be to remember a card when it comes due. Higher means more frequent reviews; lower means fewer, but more forgetting. Applies to reviews from now on."
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
              <DataAction
                icon={<FileUpIcon aria-hidden />}
                title="Restore backup"
                description="Load a backup file and merge it into this device."
                disabled={busy}
                onClick={onImportBackup}
              />
            </div>
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
