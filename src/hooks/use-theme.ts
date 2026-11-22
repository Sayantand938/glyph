import * as React from "react"

export type Theme = "light" | "dark" | "system"

export interface ThemeContextValue {
  /** The stored preference. */
  theme: Theme
  /** What is actually applied: "system" resolved against the OS setting. */
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

export const THEME_STORAGE_KEY = "theme"

export const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>.")
  return value
}
