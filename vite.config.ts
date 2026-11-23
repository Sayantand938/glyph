import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf8"
  )
) as { version: string }

// The Tauri CLI sets TAURI_ENV_PLATFORM while it runs the dev/build commands.
// The desktop app bundles its files, so it has no service worker or manifest.
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM)

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 5173, strictPort: isTauri },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...(isTauri
        ? {
            "virtual:pwa-register/react": fileURLToPath(
              new URL("./src/lib/pwa-register-stub.ts", import.meta.url)
            ),
          }
        : {}),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    !isTauri &&
      VitePWA({
        registerType: "prompt",
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        },
        manifest: {
          name: "Glyph",
          short_name: "Glyph",
          description: "Offline-first spaced-repetition MCQ study app.",
          start_url: "/",
          display: "standalone",
          background_color: "#000000",
          theme_color: "#000000",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
  ],
})
