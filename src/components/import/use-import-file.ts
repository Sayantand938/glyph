import * as React from "react"

import {
  MAX_IMPORT_BYTES,
  parseImportText,
  validateRows,
  type Validation,
} from "@/lib/importer"

export interface LoadedFile {
  name: string
  validation: Validation
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Reads, size-checks, parses and validates a picked import file. */
export function useImportFile() {
  const readToken = React.useRef(0)
  const [file, setFile] = React.useState<LoadedFile | null>(null)
  const [fileError, setFileError] = React.useState<string | null>(null)

  async function readFile(picked: File) {
    const token = ++readToken.current

    if (picked.size > MAX_IMPORT_BYTES) {
      setFile(null)
      setFileError(
        `That file is ${formatBytes(picked.size)}; the limit is ${formatBytes(MAX_IMPORT_BYTES)}.`
      )
      return
    }

    let text: string
    try {
      text = await picked.text()
    } catch {
      if (token !== readToken.current) return
      setFile(null)
      setFileError("Couldn't read that file.")
      return
    }
    if (token !== readToken.current) return

    const parsed = parseImportText(text)
    if (!parsed.ok) {
      setFile(null)
      setFileError(parsed.error)
      return
    }
    setFileError(null)
    setFile({ name: picked.name, validation: validateRows(parsed.rows) })
  }

  return { file, fileError, readFile }
}
