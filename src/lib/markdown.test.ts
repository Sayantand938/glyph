import { describe, expect, it } from "vitest"

import { parseInline, parseMarkdown, type Inline } from "./markdown"

const t = (text: string): Inline => ({ kind: "text", text })

describe("parseInline", () => {
  it("leaves plain text as one node", () => {
    expect(parseInline("What is the capital of Peru?")).toEqual([
      t("What is the capital of Peru?"),
    ])
    expect(parseInline("")).toEqual([])
  })

  it("parses bold, italic and strike", () => {
    expect(parseInline("a **b** c")).toEqual([
      t("a "),
      { kind: "bold", children: [t("b")] },
      t(" c"),
    ])
    expect(parseInline("a *b* _c_ ~~d~~")).toEqual([
      t("a "),
      { kind: "italic", children: [t("b")] },
      t(" "),
      { kind: "italic", children: [t("c")] },
      t(" "),
      { kind: "strike", children: [t("d")] },
    ])
  })

  it("nests emphasis", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      {
        kind: "bold",
        children: [t("a "), { kind: "italic", children: [t("b")] }, t(" c")],
      },
    ])
  })

  it("leaves arithmetic and snake_case alone", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([t("2 * 3 * 4")])
    expect(parseInline("use snake_case_name here")).toEqual([
      t("use snake_case_name here"),
    ])
    expect(parseInline("a ** b")).toEqual([t("a ** b")])
    expect(parseInline("unclosed **bold")).toEqual([t("unclosed **bold")])
  })

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([t("*not italic*")])
  })

  it("parses code spans and keeps their contents literal", () => {
    expect(parseInline("run `a **b** $x$` now")).toEqual([
      t("run "),
      { kind: "code", text: "a **b** $x$" },
      t(" now"),
    ])
    expect(parseInline("``a ` b``")).toEqual([{ kind: "code", text: "a ` b" }])
  })

  it("keeps math intact and lets emphasis wrap it", () => {
    expect(parseInline("Solve $a_1 * b_2$ now")).toEqual([
      t("Solve "),
      { kind: "math", tex: "a_1 * b_2", display: false, raw: "$a_1 * b_2$" },
      t(" now"),
    ])
    expect(parseInline("**value $x$**")).toEqual([
      {
        kind: "bold",
        children: [
          t("value "),
          { kind: "math", tex: "x", display: false, raw: "$x$" },
        ],
      },
    ])
    expect(parseInline("costs $5 or $10")).toEqual([t("costs $5 or $10")])
  })

  it("drops private-use characters so they cannot forge atoms", () => {
    expect(parseInline("a" + String.fromCharCode(0xe000) + "b")).toEqual([
      t("ab"),
    ])
  })
})

describe("parseMarkdown", () => {
  it("returns one paragraph for plain text, keeping single newlines", () => {
    expect(parseMarkdown("line one\nline two")).toEqual([
      { kind: "paragraph", children: [t("line one\nline two")] },
    ])
    expect(parseMarkdown("")).toEqual([])
  })

  it("splits paragraphs on blank lines", () => {
    expect(parseMarkdown("a\n\nb")).toEqual([
      { kind: "paragraph", children: [t("a")] },
      { kind: "paragraph", children: [t("b")] },
    ])
  })

  it("parses headings, capping the level at 3", () => {
    expect(parseMarkdown("# One\n###### Six")).toEqual([
      { kind: "heading", level: 1, children: [t("One")] },
      { kind: "heading", level: 3, children: [t("Six")] },
    ])
  })

  it("keeps a trailing # that is part of the text", () => {
    expect(parseMarkdown("# C#")).toEqual([
      { kind: "heading", level: 1, children: [t("C#")] },
    ])
    expect(parseMarkdown("## Title ##")).toEqual([
      { kind: "heading", level: 2, children: [t("Title")] },
    ])
  })

  it("needs a space after # so hashtags stay text", () => {
    expect(parseMarkdown("#hashtag")).toEqual([
      { kind: "paragraph", children: [t("#hashtag")] },
    ])
  })

  it("parses fenced code blocks verbatim", () => {
    expect(parseMarkdown("before\n```js\nconst a = **1**\n\n$x$\n```\nafter")).toEqual([
      { kind: "paragraph", children: [t("before")] },
      { kind: "code", text: "const a = **1**\n\n$x$" },
      { kind: "paragraph", children: [t("after")] },
    ])
  })

  it("treats an unclosed fence as running to the end", () => {
    expect(parseMarkdown("```\nabc\ndef")).toEqual([
      { kind: "code", text: "abc\ndef" },
    ])
  })

  it("parses bullet and numbered lists, which can interrupt a paragraph", () => {
    expect(parseMarkdown("Pick:\n- a\n* **b**\n1. c\n2) d")).toEqual([
      { kind: "paragraph", children: [t("Pick:")] },
      {
        kind: "list",
        ordered: false,
        items: [[t("a")], [{ kind: "bold", children: [t("b")] }]],
      },
      { kind: "list", ordered: true, items: [[t("c")], [t("d")]] },
    ])
  })

  it("does not read *italic* at line start as a bullet", () => {
    expect(parseMarkdown("*italic* start")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "italic", children: [t("italic")] }, t(" start")],
      },
    ])
  })

  it("parses quotes", () => {
    expect(parseMarkdown("> a\n> b")).toEqual([
      { kind: "quote", children: [t("a\nb")] },
    ])
  })

  it("does not break display math across block syntax", () => {
    const [block, ...rest] = parseMarkdown("$$\n- x\n# y\n$$")
    expect(rest).toEqual([])
    expect(block).toEqual({
      kind: "paragraph",
      children: [
        {
          kind: "math",
          tex: "\n- x\n# y\n",
          display: true,
          raw: "$$\n- x\n# y\n$$",
        },
      ],
    })
  })

  it("normalises CRLF", () => {
    expect(parseMarkdown("a\r\nb")).toEqual([
      { kind: "paragraph", children: [t("a\nb")] },
    ])
  })
})
