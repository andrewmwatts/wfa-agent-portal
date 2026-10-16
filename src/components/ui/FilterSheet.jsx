import { useEffect } from 'react'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'

// Phone filter panel: a bottom sheet that holds every control which narrows a list,
// so the page itself keeps only search and the one-tap presets. Nothing outside it
// changes until the footer button is tapped (callers apply as the fields change and
// the button simply closes and reports the result count).
//
//   <FilterSheet open onClose title="Filters" onReset applyLabel="Show 38 policies">…</FilterSheet>

export default function FilterSheet({ open, onClose, title = 'Filters', onReset, applyLabel = 'Done', children }) {
  useBodyScrollLock(open) // freeze the page behind the sheet

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end !mt-0" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden="true" />

      <div className="relative flex flex-col max-h-[calc(100dvh-var(--header-h))] bg-white dark:bg-primary border-t border-gray-200 dark:border-white/15 rounded-t-2xl shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-gray-300 dark:bg-white/30 shrink-0" aria-hidden="true" />

        <div className="flex items-center pl-5 pr-2 h-14 shrink-0">
          <h2 className="flex-1 text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="h-11 px-3 text-sm font-semibold text-gray-700 dark:text-white underline underline-offset-4 decoration-gray-300 dark:decoration-white/40"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-500 dark:text-white/70 hover:bg-gray-100 dark:hover:bg-white/10"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-4">{children}</div>

        <div className="shrink-0 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-white/10 bg-white dark:bg-primary">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-[52px] rounded-xl text-base font-semibold border border-accent bg-primary text-white dark:bg-white dark:text-primary transition-colors hover:bg-primary/85 dark:hover:bg-white/90"
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// A labelled field row used inside the sheet, so every page's filter fields look alike.
export function SheetField({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block mb-1.5 text-[11.5px] font-semibold uppercase tracking-widest text-gray-500 dark:text-white/60">
        {label}
      </span>
      {children}
    </label>
  )
}

// Native <select>/<input> styling for sheet fields: 48px tall, 16px text (no iOS zoom).
export const SHEET_INPUT =
  'w-full h-12 rounded-xl border border-gray-300 dark:border-white/20 bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white text-base px-3.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'
