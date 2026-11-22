import type { Metadata, Viewport } from "next"
import { JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { DbProvider } from "@/components/db-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
})

export const metadata: Metadata = {
  title: "Glyph",
  description: "Offline-first spaced-repetition MCQ study app.",
  appleWebApp: {
    capable: true,
    title: "Glyph",
    statusBarStyle: "black-translucent",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", jetbrainsMono.variable)}
    >
      <body>
        <ThemeProvider>
          <DbProvider>{children}</DbProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
