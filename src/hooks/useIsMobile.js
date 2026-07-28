import { useEffect, useState } from 'react'

/**
 * Returns true when the viewport width is at or below `maxWidth` (default 720px).
 *
 * For structural layout switches that inline styles can't express through CSS
 * media queries — e.g. collapsing the public nav into a hamburger drawer.
 * Fluid sizing (padding, font-size) and reflowing grids should prefer CSS
 * `clamp()` / `repeat(auto-fit, …)` instead of this hook.
 */
export default function useIsMobile(maxWidth = 720) {
  const query = `(max-width: ${maxWidth}px)`
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = e => setIsMobile(e.matches)
    setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}
