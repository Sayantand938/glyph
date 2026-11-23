import * as React from "react"
import { UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Drag-and-drop target plus a file-picker button for the JSON file. */
export function FileDrop({
  fileName,
  disabled,
  onFile,
}: {
  fileName: string | null
  disabled: boolean
  onFile: (file: File) => void
}) {
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files[0]
        if (dropped && !disabled) onFile(dropped)
      }}
      className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center ${dragging ? "bg-muted" : ""}`}
    >
      <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-xs text-muted-foreground">
        {fileName ?? "Drop a .json file here"}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
      >
        {fileName ? "Choose another file" : "Choose file"}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="JSON file"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          // Reset so picking the same file again re-triggers onChange.
          e.target.value = ""
          if (picked) onFile(picked)
        }}
      />
    </div>
  )
}
