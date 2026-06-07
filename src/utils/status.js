// Single source of truth for policy status classification + colors.

// Active = still in the pipeline; Final = terminal outcome.
export const ACTIVE_STATUSES = new Set(['', 'pending', 'incomplete'])
export const FINAL_STATUSES  = new Set(['issued', 'declined', 'not taken', 'withdrawn', 'cancelled', 'lapsed'])

// Display ordering for status dropdowns / sorting.
export const STATUS_ORDER = [
  'incomplete', 'pending', 'issued', 'lapse pending',
  'first premium not paid', 'declined', 'not taken',
  'withdrawn', 'cancelled', 'lapsed',
]

export function statusWeight(s) {
  const idx = STATUS_ORDER.indexOf(s?.toLowerCase())
  return idx === -1 ? 99 : idx
}

// Tailwind classes for a policy status badge. Single source for the colors
// previously inlined in PoliciesPage / RecruitingPage / LapsePage.
export function getPolicyStatusClass(status) {
  const s = status?.toLowerCase()
  if (s === 'incomplete')             return 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
  if (s === 'issued')                 return 'bg-green-500/20 text-green-600 dark:text-green-300'
  if (s === 'lapse pending')          return 'bg-red-500/20 text-red-500 dark:text-red-300'
  if (s === 'first premium not paid') return 'bg-red-500/20 text-red-500 dark:text-red-300'
  if (s === 'declined')               return 'bg-red-500/10 text-red-400 dark:text-red-400/80'
  if (s === 'withdrawn')              return 'bg-red-500/10 text-red-400 dark:text-red-400/80'
  if (s === 'not taken')              return 'bg-red-500/10 text-red-400 dark:text-red-400/80'
  if (FINAL_STATUSES.has(s))          return 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/30'
  return 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/60'
}
