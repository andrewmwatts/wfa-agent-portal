import { useEffect, useRef, useState } from 'react'

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#7A9499', flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

export default function SearchBar({ value, onChange }) {
  const [local, setLocal] = useState(value)
  const timer = useRef(null)

  // Sync if parent clears the value (e.g. chip click)
  useEffect(() => { setLocal(value) }, [value])

  function handleChange(e) {
    const v = e.target.value
    setLocal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(v), 200)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: '#F4F7F8', border: '0.5px solid #C8D6D8',
      borderRadius: 8, padding: '8px 14px', maxWidth: 480,
    }}>
      <SearchIcon />
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder="Search by title, speaker, or topic…"
        style={{
          border: 'none', background: 'transparent', outline: 'none',
          fontSize: 13, color: '#1A2B2E', width: '100%',
          fontFamily: 'Inter, sans-serif',
        }}
      />
    </div>
  )
}
