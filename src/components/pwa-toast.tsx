import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"

/**
 * Registers the service worker and tells the user when the app is ready to
 * work offline or when a new version is waiting. Updates are never applied
 * behind the user's back (registerType is "prompt"): reloading mid-session
 * would throw away the study queue.
 */
export function PwaToast() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Service worker registration failed", error)
    },
  })

  if (!offlineReady && !needRefresh) return null

  const dismiss = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border bg-background p-3 text-sm shadow-lg"
    >
      <p>
        {needRefresh
          ? "Update available. Reloading ends the current study session."
          : "Ready to work offline."}
      </p>
      <div className="flex shrink-0 gap-2">
        {needRefresh && (
          <Button size="sm" onClick={() => void updateServiceWorker(true)}>
            Reload
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={dismiss}>
          {needRefresh ? "Later" : "OK"}
        </Button>
      </div>
    </div>
  )
}
