import { DownloadIcon, FileUpIcon, MenuIcon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Import JSON / Export Backup / Import Backup: three buttons from the `sm`
 * breakpoint up, one menu below it.
 */
export function HeaderMenu({
  busy,
  onImportJson,
  onExportBackup,
  onImportBackup,
}: {
  busy: boolean
  onImportJson: () => void
  onExportBackup: () => void
  onImportBackup: () => void
}) {
  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        <Button variant="outline" size="sm" onClick={onImportJson}>
          <UploadIcon data-icon="inline-start" />
          Import JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onExportBackup}
        >
          <DownloadIcon data-icon="inline-start" />
          Export Backup
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onImportBackup}
        >
          <FileUpIcon data-icon="inline-start" />
          Import Backup
        </Button>
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon-sm" />}
            aria-label="Menu"
          >
            <MenuIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onImportJson}>
              <UploadIcon aria-hidden />
              Import JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onClick={onExportBackup}>
              <DownloadIcon aria-hidden />
              Export Backup
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onClick={onImportBackup}>
              <FileUpIcon aria-hidden />
              Import Backup
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
