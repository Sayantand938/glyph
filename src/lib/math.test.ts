import { describe, expect, it } from "vitest"

import { splitMath, type Segment } from "./math"

const text = (t: string): Segment => ({ kind: "text", text: t })
const inline = (tex: string, raw: string): Segment => ({
  kind: "math",
  tex,
  display: false,
  raw,
})
const display = (tex: string, raw: string): Segment => ({
  kind: "math",
  tex,
  display: true,
  raw,
})

describe("splitMath", () => {
  it("returns plain text untouched", () => {
    expect(splitMath("What is the capital of Peru?")).toEqual([
      text("What is the capital of Peru?"),
    ])
    expect(splitMath("")).toEqual([])
  })

  it("parses $...$ as inline math (the default form)", () => {
    expect(splitMath("Solve $x^2 = 4$ now")).toEqual([
      text("Solve "),
      inline("x^2 = 4", "$x^2 = 4$"),
      text(" now"),
    ])
  })

  it("parses \\(...\\) as inline math", () => {
    expect(splitMath("Solve \\(x^2 = 4\\) now")).toEqual([
      text("Solve "),
      inline("x^2 = 4", "\\(x^2 = 4\\)"),
      text(" now"),
    ])
  })

  it("parses $$...$$ and \\[...\\] as display math", () => {
    expect(splitMath("$$\\int_0^1 x\\,dx$$")).toEqual([
      display("\\int_0^1 x\\,dx", "$$\\int_0^1 x\\,dx$$"),
    ])
    expect(splitMath("a \\[ y = mx \\] b")).toEqual([
      text("a "),
      display(" y = mx ", "\\[ y = mx \\]"),
      text(" b"),
    ])
  })

  it("lets display math span lines but not a blank line", () => {
    expect(splitMath("$$a\n= b$$")).toEqual([display("a\n= b", "$$a\n= b$$")])
    expect(splitMath("$$a\n\nb$$")).toEqual([text("$$a\n\nb$$")])
  })

  it("handles several spans and mixed delimiters in one string", () => {
    expect(splitMath("$a$ and \\(b\\) and $$c$$")).toEqual([
      inline("a", "$a$"),
      text(" and "),
      inline("b", "\\(b\\)"),
      text(" and "),
      display("c", "$$c$$"),
    ])
  })

  it("leaves currency alone", () => {
    expect(splitMath("It costs $5 or $10.")).toEqual([
      text("It costs $5 or $10."),
    ])
    expect(splitMath("Between $5 and $10 inclusive")).toEqual([
      text("Between $5 and $10 inclusive"),
    ])
  })

  it("finds math after a currency amount", () => {
    expect(splitMath("It costs $5 or $x$.")).toEqual([
      text("It costs $5 or "),
      inline("x", "$x$"),
      text("."),
    ])
  })

  it("requires non-space next to the $ delimiters and no digit after the closer", () => {
    expect(splitMath("$ x$")).toEqual([text("$ x$")])
    expect(splitMath("$x $")).toEqual([text("$x $")])
    expect(splitMath("$x$5")).toEqual([text("$x$5")])
  })

  it("treats \\$ as a literal dollar sign", () => {
    expect(splitMath("\\$x\\$ is text")).toEqual([text("$x$ is text")])
  })

  it("keeps an escaped dollar inside math as TeX", () => {
    expect(splitMath("$a \\$ b$")).toEqual([inline("a \\$ b", "$a \\$ b$")])
  })

  it("keeps escaped backslashes inside math from closing it early", () => {
    expect(splitMath("\\(a \\\\) b\\)")).toEqual([
      inline("a \\\\) b", "\\(a \\\\) b\\)"),
    ])
  })

  it("leaves unclosed or empty delimiters as text", () => {
    expect(splitMath("a $b")).toEqual([text("a $b")])
    expect(splitMath("a \\(b")).toEqual([text("a \\(b")])
    expect(splitMath("a \\[b")).toEqual([text("a \\[b")])
    expect(splitMath("a $$b")).toEqual([text("a $$b")])
    expect(splitMath("$$$$")).toEqual([text("$$$$")])
    expect(splitMath("\\(\\)")).toEqual([text("\\(\\)")])
    expect(splitMath("\\(   \\)")).toEqual([text("\\(   \\)")])
  })

  it("treats a doubled backslash in text as a pair, not an escape for $", () => {
    expect(splitMath("\\\\$a$")).toEqual([text("\\\\"), inline("a", "$a$")])
  })

  it("leaves other backslashes in plain text alone", () => {
    expect(splitMath("C:\\temp\\new")).toEqual([text("C:\\temp\\new")])
  })

  it("never drops or reorders characters", () => {
    const samples = [
      "$a$ $5 \\$ $$b$$ \\(c\\) \\[d\\] $ e $",
      "x $ y \\( z $$ w",
    ]
    for (const s of samples) {
      const rebuilt = splitMath(s)
        .map((seg) => (seg.kind === "text" ? seg.text : seg.raw))
        .join("")
      // Only `\$` escapes are consumed (they become `$`).
      expect(rebuilt).toBe(s.replaceAll("\\$", "$"))
    }
  })
})
