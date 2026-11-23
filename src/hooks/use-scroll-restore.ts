import * as React from "react"

/**
 * Keeps a long page's scroll position across a full-page detour. While
 * `detour` is true another page is shown in its place (and starts at the top);
 * when it turns false again the page is scrolled back to where it was.
 */
export function useScrollRestore(detour: boolean) {
  const saved = React.useRef(0)
  const was = React.useRef(false)

  React.useEffect(() => {
    if (detour) return
    const onScroll = () => {
      saved.current = window.scrollY
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [detour])

  React.useLayoutEffect(() => {
    if (was.current && !detour) window.scrollTo(0, saved.current)
    was.current = detour
  }, [detour])
}
