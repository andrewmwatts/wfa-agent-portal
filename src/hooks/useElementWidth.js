import { useLayoutEffect, useState } from 'react'

/**
 * Tracks an element's rendered width, for layouts that depend on the space a component
 * actually has rather than on the screen: a list beside open panes is far narrower than
 * the viewport. Pass the element from a callback ref (`ref={setEl}`) so it works when
 * the element mounts later. Returns 0 until the element has been measured.
 */
export default function useElementWidth(el) {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!el) { setWidth(0); return undefined }
    setWidth(Math.round(el.getBoundingClientRect().width))
    const ro = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return width
}
