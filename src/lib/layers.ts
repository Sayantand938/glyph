/**
 * Makes the browser's Back button close the open full page instead of leaving
 * the app. Every open page (settings, browse, an editor...) is a "layer" on a
 * stack, and each layer owns one history entry. Pure: the history object and
 * the scheduler are injected so it can be tested without a browser.
 */

export interface Layer {
  /**
   * Back was pressed while this layer is on top. Close it and return nothing
   * (or true), or return false to stay open (e.g. to show a confirm page).
   */
  onBack: () => boolean | void
  /** True while closing would be unsafe, e.g. during a write. Back is ignored. */
  blocked: () => boolean
}

export interface HistoryLike {
  pushState(data: unknown, unused: string): void
  go(delta: number): void
}

export interface LayerStack {
  /** Adds a layer on top; the returned function removes it again. */
  add(layer: Layer): () => void
  /** Call from the window's `popstate` event. */
  handlePop(): void
}

export function createLayerStack(
  history: HistoryLike,
  schedule: (run: () => void) => void = (run) => queueMicrotask(run)
): LayerStack {
  const stack: Layer[] = []
  // History entries pushed by us that are still there.
  let entries = 0
  // popstate events caused by our own `go`, which must not close anything.
  let ignored = 0
  let queued = false

  // Brings the history entries in line with the layers, once per burst of
  // changes: a page swapped for another in one render needs no history work.
  function sync() {
    queued = false
    if (stack.length > entries) {
      while (entries < stack.length) {
        entries += 1
        history.pushState({ glyphLayer: entries }, "")
      }
    } else if (stack.length < entries) {
      const extra = entries - stack.length
      entries = stack.length
      ignored += 1
      history.go(-extra)
    }
  }

  function queue() {
    if (queued) return
    queued = true
    schedule(sync)
  }

  function remove(layer: Layer) {
    const index = stack.lastIndexOf(layer)
    if (index >= 0) stack.splice(index, 1)
  }

  return {
    add(layer) {
      stack.push(layer)
      queue()
      return () => {
        remove(layer)
        queue()
      }
    },
    handlePop() {
      if (ignored > 0) {
        ignored -= 1
        return
      }
      // The browser consumed one of our entries.
      if (entries > 0) entries -= 1
      const top = stack[stack.length - 1]
      if (!top) return
      if (top.blocked() || top.onBack() === false) {
        // Stays open: put its history entry back.
        queue()
        return
      }
      remove(top)
      queue()
    },
  }
}
