import katex from "katex"
import "katex/dist/katex.min.css"
import * as React from "react"

import { splitMath } from "@/lib/math"

function MathSpan({
  tex,
  display,
  raw,
}: {
  tex: string
  display: boolean
  raw: string
}) {
  const ref = React.useRef<HTMLSpanElement>(null)

  // katex.render builds DOM nodes itself, so no HTML string is ever injected
  // (CLAUDE.md rule 10). The span has no React children, so React leaves it be.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      katex.render(tex, el, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        maxExpand: 1000,
      })
    } catch {
      el.textContent = raw
    }
  }, [tex, display, raw])

  return (
    <span
      ref={ref}
      className={display ? "block max-w-full overflow-x-auto" : undefined}
    />
  )
}

/**
 * Note text with LaTeX rendered by KaTeX. Plain parts stay plain text (React
 * escapes them); the delimiters are parsed by `splitMath`. Renders a fragment,
 * so the caller's element keeps its own whitespace and wrapping classes.
 */
export function RichText({ text }: { text: string }) {
  const segments = React.useMemo(() => splitMath(text), [text])
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ) : (
          <MathSpan
            key={i}
            tex={seg.tex}
            display={seg.display}
            raw={seg.raw}
          />
        )
      )}
    </>
  )
}
