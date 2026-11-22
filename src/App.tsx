export default function App() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between border-b py-4">
        <h1 className="text-base font-semibold tracking-tight">
          glyph<span className="animate-pulse">_</span>
        </h1>
        <span className="text-xs text-muted-foreground">v0.0.1</span>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-3 py-16">
        <p className="text-2xl font-semibold tracking-tight">
          spaced repetition
          <br />
          for multiple choice.
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Offline-first. Local data. No accounts.
        </p>
      </main>

      <footer className="border-t py-4 text-xs text-muted-foreground">
        press <kbd className="border px-1">d</kbd> to toggle dark mode
      </footer>
    </div>
  )
}
