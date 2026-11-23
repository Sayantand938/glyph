import * as React from "react"
import { CheckCircle2Icon, CopyIcon, Loader2Icon } from "lucide-react"

import { copyText } from "@/components/browse/copy-text"
import { PageShell } from "@/components/page-shell"
import { CodeEntry } from "@/components/sync/code-entry"
import { Button } from "@/components/ui/button"
import { usePeerSync } from "@/hooks/use-peer-sync"
import { formatMergeSummary } from "@/lib/backup"

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A code as selectable text with a copy button. */
function ShowCode({ code }: { code: string }) {
  const [copied, setCopied] = React.useState<"yes" | "failed" | null>(null)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            copyText(code).then(
              () => setCopied("yes"),
              () => setCopied("failed")
            )
          }
        >
          <CopyIcon />
          Copy code
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {copied === "yes" && "Copied."}
          {copied === "failed" && "Could not copy. Select the text below."}
        </span>
      </div>
      <textarea
        readOnly
        rows={5}
        value={code}
        aria-label="Pairing code"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-lg border bg-muted p-2 font-mono text-xs"
      />
    </div>
  )
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {children}
    </p>
  )
}

/**
 * Sync with another device on the same network, with no server: the devices
 * swap two pairing codes as text (copy on one, paste on the other, through any
 * chat or notes app), then connect directly and merge each other's data. See `use-peer-sync.ts`.
 */
export function SyncPage({ onBack }: { onBack: () => void }) {
  const sync = usePeerSync()
  const { phase } = sync
  const [joining, setJoining] = React.useState(false)

  // Going back mid-sync would cut the connection while data is being written.
  const locked = phase.name === "syncing"

  return (
    <PageShell
      title="Sync with another device"
      description="Both devices need Glyph open on the same wifi. Nothing goes through the internet or any server."
      onBack={onBack}
      backDisabled={locked}
      footer={
        phase.name === "done" ? (
          <Button type="button" onClick={onBack}>
            Done
          </Button>
        ) : phase.name === "error" ? (
          <>
            <Button type="button" variant="outline" onClick={onBack}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                setJoining(false)
                sync.reset()
              }}
            >
              Try again
            </Button>
          </>
        ) : phase.name === "idle" ? undefined : (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => {
              setJoining(false)
              sync.reset()
            }}
          >
            Cancel
          </Button>
        )
      }
    >
      {phase.name === "idle" && !joining && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick one device to start, and join from the other. After a sync both
            devices have the same questions and progress; where both changed the
            same thing, the newer change wins, like restoring a backup. The
            first sync sends everything; after that only what changed.
          </p>
          <div className="grid gap-2 sm:max-w-sm">
            <Button type="button" onClick={() => void sync.start()}>
              Start on this device
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setJoining(true)}
            >
              Join from another device
            </Button>
          </div>
        </div>
      )}

      {phase.name === "idle" && joining && (
        <Step n={1} title="Paste the code from the first device">
          <CodeEntry onCode={sync.join} />
        </Step>
      )}

      {phase.name === "working" && <Waiting>Preparing a connection...</Waiting>}

      {phase.name === "offer" && (
        <div className="space-y-6">
          <Step n={1} title="Send this code to the other device">
            <p className="text-xs text-muted-foreground">
              Copy it and send it to yourself (a chat app, email or notes). On
              the other device open Sync, choose Join and paste it.
            </p>
            <ShowCode code={phase.code} />
          </Step>
          <Step n={2} title="Paste the reply it gives you">
            <CodeEntry onCode={sync.accept} />
          </Step>
        </div>
      )}

      {phase.name === "answer" && (
        <Step n={2} title="Send this reply back to the first device">
          <p className="text-xs text-muted-foreground">
            Copy it and paste it on the first device. The sync starts by itself.
          </p>
          <ShowCode code={phase.code} />
          <Waiting>Waiting for the first device...</Waiting>
        </Step>
      )}

      {phase.name === "connecting" && <Waiting>Connecting...</Waiting>}

      {phase.name === "syncing" && (
        <div className="space-y-2">
          <Waiting>Syncing. Keep both devices open.</Waiting>
          {phase.progress && (
            <p className="text-xs text-muted-foreground">
              {phase.progress.round === 2
                ? "The devices differed after the quick sync, so everything is being sent once to be sure. "
                : phase.progress.mode === "full"
                  ? "Sending everything (the first sync of these two devices). "
                  : "Sending only what changed. "}
              Sent {phase.progress.sentParts} parts, received{" "}
              {phase.progress.receivedParts}.
            </p>
          )}
        </div>
      )}

      {phase.name === "done" && (
        <div role="status" className="flex items-start gap-2 text-sm">
          <CheckCircle2Icon
            className="mt-0.5 size-4 shrink-0 text-green-600"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-medium">Sync complete.</p>
            <p className="text-muted-foreground">
              This device: {formatMergeSummary(phase.stats)} The other device
              did the same with this device&apos;s data.
            </p>
            <p className="text-muted-foreground">
              {phase.rounds === 2
                ? "The devices differed after the quick sync, so everything was sent once to be sure."
                : phase.modes[0] === "delta"
                  ? "Only what changed since your last sync was sent."
                  : "This was the first sync of these two devices, so everything was sent. Next time only what changed is sent."}
            </p>
          </div>
        </div>
      )}

      {phase.name === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {phase.message}
        </p>
      )}
    </PageShell>
  )
}
