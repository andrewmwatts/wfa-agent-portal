import { useEffect, useRef, useState } from 'react'

// Kept as local literals rather than importing from PolicyEditModal.jsx to
// avoid a circular import (PolicyEditModal imports this component).
const INPUT_CLS     = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'
const INPUT_ERR_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-red-400 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400/40'

// Agent name-lookup typeahead — shared by every policy create/edit surface
// (PolicyEditModal's Agent field, and SplitPolicyModal's new-agent picker).
export default function AgentLookup({ personnel, value, onSelect, onClear, error }) {
  const selected = value ? personnel.find(p => p.sfg_id === value) ?? null : null

  const [query, setQuery] = useState(
    selected ? (selected.name || selected.preferred_name || selected.full_name || '') : ''
  )
  const [open,  setOpen]  = useState(false)
  const containerRef      = useRef(null)

  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  useEffect(() => { if (!value) setQuery('') }, [value])

  const results = query.trim().length > 0
    ? personnel
        .filter(p => {
          const name = (p.name || p.preferred_name || p.full_name || '').toLowerCase()
          const id   = (p.sfg_id ?? '').toLowerCase()
          const q    = query.trim().toLowerCase()
          return name.includes(q) || id.startsWith(q)
        })
        .slice(0, 8)
    : []

  function handleInputChange(e) {
    setQuery(e.target.value)
    onClear()
    setOpen(true)
  }

  function handleSelect(person) {
    setQuery(person.name || person.preferred_name || person.full_name || person.sfg_id)
    onSelect(person)
    setOpen(false)
  }

  function handleClear() {
    setQuery('')
    onClear()
    setOpen(false)
  }

  const cls = (error ? INPUT_ERR_CLS : INPUT_CLS) + ' pr-14'

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        placeholder="Search by name…"
        className={cls}
        autoComplete="off"
      />

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {selected && <span className="text-green-500 text-xs font-bold">✓</span>}
        {query && (
          <button type="button" onClick={handleClear} tabIndex={-1}
            className="text-gray-300 hover:text-gray-500 dark:text-white/30 dark:hover:text-white/60 text-xs leading-none transition-colors">
            ✕
          </button>
        )}
      </div>

      {selected && (
        <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5 font-mono">{selected.sfg_id}</p>
      )}

      {open && results.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl overflow-hidden">
          {results.map(p => (
            <li key={p.sfg_id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleSelect(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/10 flex items-center justify-between gap-3 transition-colors"
              >
                <span className="text-gray-900 dark:text-white truncate">
                  {p.name || p.preferred_name || p.full_name}
                </span>
                <span className="text-xs text-gray-400 dark:text-white/40 shrink-0 font-mono">{p.sfg_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-400 dark:text-white/40">
          No matches found
        </div>
      )}
    </div>
  )
}
