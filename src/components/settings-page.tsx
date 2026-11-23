import * as React from "react"
import {
  ArrowLeftIcon,
  BarChart3Icon,
  DownloadIcon,
  FileUpIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
        title="Data"
        description="Your data lives only in this browser. Move it between devices with a backup file."
      >
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={onImportJson}
          >
            <UploadIcon data-icon="inline-start" />
            Import JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            disabled={busy}
            onClick={onExportBackup}
          >
            <DownloadIcon data-icon="inline-start" />
            Export Backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            disabled={busy}
            onClick={onImportBackup}
          >
            <FileUpIcon data-icon="inline-start" />
            Import Backup
          </Button>
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
