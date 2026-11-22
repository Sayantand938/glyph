import "@fontsource-variable/jetbrains-mono"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import { DbProvider } from "@/components/db-provider"
import { ThemeProvider } from "@/components/theme-provider"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <DbProvider>
        <App />
      </DbProvider>
    </ThemeProvider>
  </StrictMode>
)
