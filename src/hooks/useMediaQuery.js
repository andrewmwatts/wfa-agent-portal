import { useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 *
 * For layout switches CSS alone cannot express — e.g. rendering a list of cards
 * on a phone and a table on a tablet, so only one of them is in the DOM.
 * Purely visual changes should stay in Tailwind breakpoints.
 */
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    notify => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

// Tailwind's breakpoints, so JS and CSS agree on where "phone" ends.
export const useMinSm = () => useMediaQuery('(min-width: 640px)')
export const useMinMd = () => useMediaQuery('(min-width: 768px)')
export const useMinLg = () => useMediaQuery('(min-width: 1024px)')
export const useMinXl = () => useMediaQuery('(min-width: 1280px)')
