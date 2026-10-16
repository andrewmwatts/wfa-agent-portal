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

// Compact date for phone cards / tablet tables: "Oct 3" for the current year,
// "Oct 3, 2025" for any other year (so old records are never ambiguous).
export function fmtDateShort(value, { empty = '—' } = {}) {
  if (!value) return empty
  const d = parseDateLocal(value)
  if (!d || isNaN(d)) return String(value)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
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

// ─── Phone numbers ─────────────────────────────────────────────────────────────
// Stored as ten bare digits ("6027746793"); shown as "602-774-6793".

// Ten bare digits for storage and tel:/sms: links. A leading US country code is dropped.
// Anything that is not a ten-digit number is returned with only its digits kept.
export function phoneDigits(value) {
  const d = String(value ?? '').replace(/\D/g, '')
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d
}

// Display form: ###-###-####. Values that are not ten digits are shown as they were entered.
export function fmtPhone(value, { empty = '' } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return empty
  const d = phoneDigits(value)
  if (d.length !== 10) return String(value)
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

// For a controlled <input>: hyphenates as the person types, so the field always reads ###-###-####.
export function fmtPhoneInput(value) {
  const d = phoneDigits(value).slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}
