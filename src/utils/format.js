// Shared formatting utilities — single source of truth for date and currency
// display across the app. Designed so every existing call site keeps identical
// output by exposing the edge-case return value as an option.

// Parse a YYYY-MM-DD string as LOCAL midnight (avoids UTC-offset date shifting).
// Falls back to the native Date parser for other formats.
export function parseDateLocal(str) {
  if (!str) return null
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

// Normalize any date value to a YYYY-MM-DD string for <input type="date">.
// Returns '' for falsy input; returns the original string if unparseable.
export function toInputDate(str) {
  if (!str) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(str))) return String(str)
  const d = parseDateLocal(str)
  if (!d || isNaN(d)) return str
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

// Format a date as "Mon D, YYYY". `empty` controls the falsy/invalid return.
export function fmtDate(value, { empty = '—' } = {}) {
  if (!value) return empty
  const d = parseDateLocal(value)
  return (!d || isNaN(d))
    ? String(value)
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Format a timestamp as "Mon D, h:mm AM/PM".
export function fmtDateTime(value, { empty = '—' } = {}) {
  if (!value) return empty
  const d = new Date(value)
  return isNaN(d)
    ? empty
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Relative time: "just now", "5m ago", "3h ago", "2d ago".
export function fmtRelTime(value, { empty = '' } = {}) {
  if (!value) return empty
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Whole-dollar currency: "$1,234" / "-$50" / "$0".
// Accepts numbers or strings (strips $ and commas). `empty` controls the
// null/undefined/'' return value (use '' inside editable inputs).
export function fmtCurrency(value, { empty = '—' } = {}) {
  if (value === null || value === undefined || value === '') return empty
  const n = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[$,]/g, ''))
  if (isNaN(n)) return empty
  if (n === 0) return '$0'
  const abs = Math.round(Math.abs(n))
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US')
}
