import * as React from "react"

import { createLayerStack, type LayerStack } from "@/lib/layers"

let layers: LayerStack | null = null

function getLayers(): LayerStack {
  if (!layers) {
    layers = createLayerStack(window.history)
    window.addEventListener("popstate", () => layers?.handlePop())
  }
  return layers
}

/**
 * Registers the calling page so the browser's (or phone's) Back button closes
 * it instead of leaving the app. While mounted, the page owns one history
 * entry. `onBack` closes the page (return nothing) or returns false to stay
 * open; `blocked` ignores Back, e.g. while a write is running. Closing the
 * page some other way (a button) just unmounts it and drops its entry.
 */
export function useHistoryLayer(onBack: () => boolean | void, blocked = false) {
  const latest = React.useRef({ onBack, blocked })
  React.useEffect(() => {
    latest.current = { onBack, blocked }
  })
  React.useEffect(
    () =>
      getLayers().add({
        onBack: () => latest.current.onBack(),
        blocked: () => latest.current.blocked,
      }),
    []
  )
}
