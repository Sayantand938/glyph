/**
 * Stands in for `virtual:pwa-register/react` in the Tauri build, which has no
 * service worker (the app files are bundled into the executable). Same shape
 * as the real hook, so `PwaToast` renders nothing.
 */
type Flag = [boolean, (value: boolean) => void]

export function useRegisterSW(): {
  offlineReady: Flag
  needRefresh: Flag
  updateServiceWorker: (reload?: boolean) => Promise<void>
} {
  const off: Flag = [false, () => {}]
  return {
    offlineReady: off,
    needRefresh: off,
    updateServiceWorker: async () => {},
  }
}
