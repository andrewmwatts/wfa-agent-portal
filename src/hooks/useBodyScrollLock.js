import { useEffect } from 'react'

// Freezes page scroll while a sheet / dialog is open. Reference-counted so that two
// overlays open at once (a policy dialog on top of Quick Search, say) can unmount in
// either order without leaving the page stuck unscrollable or unlocking too early.
let locks = 0
let saved = ''

export default function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined
    if (locks === 0) {
      saved = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    locks += 1
    return () => {
      locks -= 1
      if (locks === 0) document.body.style.overflow = saved
    }
  }, [active])
}
