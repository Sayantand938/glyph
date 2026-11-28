import * as React from "react"

import {
  THEME_STORAGE_KEY,
  ThemeContext,
  useTheme,
  type Theme,
} from "@/hooks/use-theme"
import { reportPageTheme } from "@/lib/page-chrome"

const DARK_QUERY = "(prefers-color-scheme: dark)"

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored
    }
  } catch {
    // Storage can be blocked; fall back to the OS setting.
  }
  return "system"
}

/**
 * Light/dark/system theme. Applies the `dark` class to <html>. The first paint
 * is handled by the inline script in index.html so there is no flash.
 */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(readStoredTheme)
  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia(DARK_QUERY).matches
  )

  React.useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme

  React.useEffect(() => {
    const root = document.documentElement
    // Suppress transitions for one frame so the swap is instant.
    const style = document.createElement("style")
    style.textContent = "*,*::before,*::after{transition:none!important}"
    document.head.appendChild(style)
    root.classList.toggle("dark", resolvedTheme === "dark")
    root.style.colorScheme = resolvedTheme
    reportPageTheme(resolvedTheme === "dark")
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => style.remove())
    )
    return () => {
      cancelAnimationFrame(frame)
      style.remove()
    }
  }, [resolvedTheme])

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Preference just won't persist.
    }
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
