// Generates the placeholder PWA icons into public/icons.
// Black square with a white ">_" prompt mark. Run: node scripts/generate-icons.mjs
import { writeFile } from "node:fs/promises"
import { createElement as h } from "react"
import { ImageResponse } from "next/og.js"

// `inset` is the padding fraction around the mark (maskable icons need a safe zone).
function icon(size, inset) {
  const s = size * (1 - inset * 2)
  return h(
    "div",
    {
      style: {
        width: size,
        height: size,
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    h(
      "svg",
      { width: s, height: s, viewBox: "0 0 100 100" },
      h("polyline", {
        points: "24,30 54,50 24,70",
        fill: "none",
        stroke: "#fff",
        strokeWidth: 10,
        strokeLinecap: "square",
        strokeLinejoin: "miter",
      }),
      h("rect", { x: 56, y: 70, width: 24, height: 10, fill: "#fff" })
    )
  )
}

const targets = [
  ["icon-192.png", 192, 0.12],
  ["icon-512.png", 512, 0.12],
  ["maskable-512.png", 512, 0.22],
  ["apple-touch-icon.png", 180, 0.12],
]

for (const [name, size, inset] of targets) {
  const res = new ImageResponse(icon(size, inset), { width: size, height: size })
  await writeFile(`public/icons/${name}`, Buffer.from(await res.arrayBuffer()))
  console.log("wrote", name)
}
