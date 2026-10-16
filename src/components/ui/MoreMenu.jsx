import { useEffect, useRef, useState } from 'react'

// "More actions" overflow button + dropdown, for headers that cannot fit every button
// on a phone. items: [{ label, onClick, hidden?, danger? }]. Hidden items are dropped,
// and the button disappears if nothing is left.

export default function MoreMenu({ items, label = 'More actions', className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const visible = items.filter(i => !i.hidden)

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (visible.length === 0) return null

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1.5 min-w-[200px] z-40 bg-white dark:bg-primary border border-gray-200 dark:border-white/15 rounded-xl shadow-xl py-1.5">
          {visible.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick() }}
              className={`w-full text-left px-4 h-11 text-sm font-medium transition-colors
                ${item.danger
                  ? 'text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10'
                  : 'text-gray-800 dark:text-white/85 hover:bg-gray-100 dark:hover:bg-white/10'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
