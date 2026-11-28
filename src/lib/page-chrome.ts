/** The Android host bridge (src-tauri/android-overrides/MainActivity.kt). */
interface PageChromeBridge {
  setDarkTheme?: (dark: boolean) => void
}

declare global {
  interface Window {
    GlyphPage?: PageChromeBridge
  }
}

/**
 * Tell the Android shell which theme the page resolved to.
 *
 * The status bar and the gesture bar are painted by the native window, not by CSS
 * (that web view reports `env(safe-area-inset-*)` as 0), so without this the bands
 * above and below the page keep the Android theme colour and read as a different
 * shade from the page. Nothing to do in a browser or the desktop shell, where the
 * bridge is absent.
 */
export function reportPageTheme(dark: boolean): void {
  const send = () => window.GlyphPage?.setDarkTheme?.(dark)
  send()
  // The bridge is registered by the shell once its web view exists, which can be
  // after the first render; a repeat is harmless because the call is idempotent.
  for (const delay of [100, 400, 1500]) {
    window.setTimeout(send, delay)
  }
}
