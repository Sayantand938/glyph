import * as React from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { copyText } from "@/components/browse/copy-text"
import { PageShell } from "@/components/page-shell"
import { CodeEntry } from "@/components/sync/code-entry"
import { Button } from "@/components/ui/button"
import {
  defaultDeviceName,
  saveDeviceName,
  useNearby,
} from "@/hooks/use-nearby"
import { usePeerSync } from "@/hooks/use-peer-sync"
import { useStoredState } from "@/hooks/use-stored-state"
import { PUBLIC_STUN_URL } from "@/lib/sync/rtc"
import { formatMergeSummary } from "@/lib/backup"
import type { TrustedDevices } from "@/lib/sync"
import type { NearbyPeer } from "@/lib/sync/nearby-link"

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

function Warning({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  )
}

/** The one switch that makes this page call the internet; off unless chosen. */
function StunOption({
  on,
  onChange,
}: {
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="space-y-1">
        <span className="block font-medium">Use a public STUN server</span>
        <span className="block text-xs text-muted-foreground">
          Off by default, so nothing leaves your network. Turn it on, on both
          devices, if they are on different networks or cannot find each other.
          This device then asks{" "}
          {PUBLIC_STUN_URL.replace(/^stun:/, "").replace(/:\d+$/, "")} for its
          public address, which tells that server your IP address. Your
          questions and progress are never sent there; they still go straight
          between the devices.
        </span>
      </span>
    </label>
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

/** The 4-digit number both devices show while pairing for the first time. */
function PinBox({ pin }: { pin: string }) {
  return (
    <p
      aria-label={`Confirm number ${pin.split("").join(" ")}`}
      className="rounded-lg border bg-muted py-4 text-center font-mono text-4xl tracking-[0.4em]"
    >
      {pin}
    </p>
  )
}

/** The devices found on the network, with a Sync button each. */
function NearbyList({
  peers,
  trusted,
  onPick,
  onForget,
  name,
  onName,
}: {
  peers: NearbyPeer[]
  trusted: TrustedDevices
  onPick: (peer: NearbyPeer) => void
  onForget: (id: string) => void
  name: string
  onName: (next: string) => void
}) {
  const [draft, setDraft] = React.useState(name)
  const paired = Object.entries(trusted)
  return (
    <section className="space-y-3" aria-label="Devices nearby">
      <h3 className="text-sm font-semibold">Devices nearby</h3>
      {peers.length === 0 ? (
        <Waiting>
          Looking for other devices. Open Glyph on the other device, on the same
          wifi, and open Sync there too.
        </Waiting>
      ) : (
        <ul className="space-y-2">
          {peers.map((peer) => (
            <li
              key={peer.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span className="min-w-0 space-y-0.5">
                <span className="block truncate text-sm font-medium">
                  {peer.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {trusted[peer.id]
                    ? "Paired before: starts without asking."
                    : "First time: you confirm a number on both."}
                </span>
              </span>
              <Button type="button" size="sm" onClick={() => onPick(peer)}>
                <RefreshCwIcon />
                Sync
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label className="block space-y-1 text-xs text-muted-foreground">
        This device is called
        <input
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft.trim()
            if (next && next !== name) onName(next)
            else setDraft(name)
          }}
          className="block w-full rounded-lg border bg-background p-2 text-sm text-foreground sm:max-w-xs"
        />
      </label>
      {paired.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            Paired devices
          </h4>
          <ul className="space-y-1">
            {paired.map(([id, device]) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">{device.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Forget ${device.name}`}
                  onClick={() => onForget(id)}
                >
                  <Trash2Icon />
                  Forget
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Forget a device on both sides before pairing it again.
          </p>
        </div>
      )}
    </section>
  )
}

/**
 * Sync with another device on the same network, with no server: the devices
 * swap two pairing codes as text (copy on one, paste on the other, through any
 * chat or notes app), then connect directly and merge each other's data. See `use-peer-sync.ts`.
 */
export function SyncPage({ onBack }: { onBack: () => void }) {
  // Per device, off by default: it is the one thing here that calls out.
  const [stun, setStun] = useStoredState<boolean>(
    "glyph.syncStun",
    false,
    (stored) => (typeof stored === "boolean" ? stored : null)
  )
  const sync = usePeerSync({ stun })
  const { phase } = sync
  const [joining, setJoining] = React.useState(false)
  const [deviceName, setDeviceName] = React.useState(defaultDeviceName)
  const nearby = useNearby(sync, deviceName)
  const nearbyState = nearby.state
  const canNearby = nearbyState.name !== "unavailable"

  // Once the direct connection is being made, the sync screens take over.
  const syncOwnsScreen =
    phase.name === "connecting" ||
    phase.name === "syncing" ||
    phase.name === "done" ||
    phase.name === "error"
  const nearbyBusy =
    (nearbyState.name === "asking" ||
      nearbyState.name === "incoming" ||
      nearbyState.name === "pairing" ||
      nearbyState.name === "failed") &&
    !syncOwnsScreen

  const cancel = () => {
    setJoining(false)
    nearby.reset()
  }

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
        ) : phase.name === "error" || nearbyState.name === "failed" ? (
          <>
            <Button type="button" variant="outline" onClick={onBack}>
              Close
            </Button>
            <Button type="button" onClick={cancel}>
              Try again
            </Button>
          </>
        ) : nearbyState.name === "incoming" ? undefined : nearbyBusy ||
          phase.name !== "idle" ? (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={cancel}
          >
            Cancel
          </Button>
        ) : undefined
      }
    >
      {nearbyState.name === "asking" && !syncOwnsScreen && (
        <div className="space-y-3">
          <p className="text-sm">
            Asking <strong>{nearbyState.peer}</strong>. On that device, check
            that this number is shown, then tap Accept:
          </p>
          <PinBox pin={nearbyState.pin} />
          <Waiting>Waiting for {nearbyState.peer}...</Waiting>
        </div>
      )}

      {nearbyState.name === "incoming" && !syncOwnsScreen && (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{nearbyState.request.name}</strong> wants to sync with this
            device. Accept only if this number is shown on that device too:
          </p>
          <PinBox pin={nearbyState.request.pin} />
          <p className="text-xs text-muted-foreground">
            Both devices then remember each other, so the next sync starts
            without asking.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={nearby.decline}>
              Decline
            </Button>
            <Button type="button" onClick={nearby.approve}>
              Accept
            </Button>
          </div>
        </div>
      )}

      {nearbyState.name === "pairing" && !syncOwnsScreen && (
        <Waiting>Connecting to {nearbyState.peer}...</Waiting>
      )}

      {nearbyState.name === "failed" && !syncOwnsScreen && (
        <p role="alert" className="text-sm text-destructive">
          {nearbyState.message}
        </p>
      )}

      {phase.name === "idle" && !joining && !nearbyBusy && (
        <div className="space-y-4">
          {canNearby && (
            <NearbyList
              peers={nearby.peers}
              trusted={nearby.trusted}
              onPick={(peer) => void nearby.pick(peer)}
              onForget={nearby.forget}
              name={deviceName}
              onName={(next) => {
                saveDeviceName(next)
                setDeviceName(next)
              }}
            />
          )}
          {canNearby && (
            <h3 className="pt-2 text-sm font-semibold">
              Or use a pairing code
            </h3>
          )}
          <StunOption on={stun} onChange={setStun} />
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

      {phase.name === "idle" && joining && !nearbyBusy && (
        <div className="space-y-4">
          <StunOption on={stun} onChange={setStun} />
          <Step n={1} title="Paste the code from the first device">
            <CodeEntry onCode={sync.join} />
          </Step>
        </div>
      )}

      {phase.name === "working" && !nearbyBusy && (
        <Waiting>Preparing a connection...</Waiting>
      )}

      {phase.name === "offer" && !nearbyBusy && (
        <div className="space-y-6">
          <Step n={1} title="Send this code to the other device">
            <p className="text-xs text-muted-foreground">
              Copy it and send it to yourself (a chat app, email or notes). On
              the other device open Sync, choose Join and paste it.
            </p>
            <ShowCode code={phase.code} />
            <Warning text={phase.warning} />
          </Step>
          <Step n={2} title="Paste the reply it gives you">
            <CodeEntry onCode={sync.accept} />
          </Step>
        </div>
      )}

      {phase.name === "answer" && !nearbyBusy && (
        <Step n={2} title="Send this reply back to the first device">
          <p className="text-xs text-muted-foreground">
            Copy it and paste it on the first device. The sync starts by itself.
          </p>
          <ShowCode code={phase.code} />
          <Warning text={phase.warning} />
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
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-destructive">{phase.message}</p>
          {phase.details && phase.details.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {phase.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PageShell>
  )
}
