import katex from "katex"
import "katex/dist/katex.min.css"
import * as React from "react"

import { NoteImage } from "@/components/note-image"
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown"

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

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "text":
            return <React.Fragment key={i}>{n.text}</React.Fragment>
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                <Inlines nodes={n.children} />
              </strong>
            )
          case "italic":
            return (
              <em key={i}>
                <Inlines nodes={n.children} />
              </em>
            )
          case "strike":
            return (
              <del key={i}>
                <Inlines nodes={n.children} />
              </del>
            )
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
              >
                {n.text}
              </code>
            )
          case "math":
            return (
              <MathSpan key={i} tex={n.tex} display={n.display} raw={n.raw} />
            )
          case "image":
            return <NoteImage key={i} id={n.id} alt={n.alt} />
        }
      })}
    </>
  )
}

const HEADING_CLASS = {
  1: "text-xl font-semibold",
  2: "text-lg font-semibold",
  3: "text-base font-semibold",
} as const

// Blocks are spans (display: block) rather than p/ul/pre/h1 because RichText
// is also rendered inside a <button>, where those elements are not allowed.
function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <span className="block">
          <Inlines nodes={block.children} />
        </span>
      )
    case "heading":
      return (
        <span className={`block ${HEADING_CLASS[block.level]}`}>
          <Inlines nodes={block.children} />
        </span>
      )
    case "code":
      return (
        <code className="block overflow-x-auto rounded bg-muted p-2 font-mono text-[0.9em] whitespace-pre">
          {block.text}
        </code>
      )
    case "quote":
      return (
        <span className="block border-l-2 pl-3 text-muted-foreground">
          <Inlines nodes={block.children} />
        </span>
      )
    case "list":
      return (
        <span className="block">
          {block.items.map((item, i) => (
            <span key={i} className="flex gap-2">
              <span className="shrink-0" aria-hidden>
                {block.ordered ? `${i + 1}.` : "\u2022"}
              </span>
              <span className="min-w-0">
                <Inlines nodes={item} />
              </span>
            </span>
          ))}
        </span>
      )
  }
}

/**
 * Note text with a small Markdown subset (bold, italic, strike, inline code,
 * code fences, headings, lists, quotes), pasted images (`![](img:<id>)`) and
 * LaTeX via KaTeX. Everything is
 * built as React elements, never an HTML string (CLAUDE.md rule 10). Text with
 * no block structure renders as a bare fragment, so the caller's element keeps
 * its own whitespace and wrapping classes; several blocks are stacked spans.
 */
export function RichText({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text])
  if (blocks.length === 1 && blocks[0].kind === "paragraph") {
    return <Inlines nodes={blocks[0].children} />
  }
  return (
    <span className="flex flex-col gap-2">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </span>
  )
}
