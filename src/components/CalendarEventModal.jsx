import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

// ── Timezone map (state → IANA) ────────────────────────────────────────────────

const STATE_IANA = {
  AL:'America/Chicago',  AK:'America/Anchorage', AZ:'America/Phoenix',
  AR:'America/Chicago',  CA:'America/Los_Angeles',CO:'America/Denver',
  CT:'America/New_York', DE:'America/New_York',  FL:'America/New_York',
  GA:'America/New_York', HI:'Pacific/Honolulu',  ID:'America/Denver',
  IL:'America/Chicago',  IN:'America/New_York',  IA:'America/Chicago',
  KS:'America/Chicago',  KY:'America/New_York',  LA:'America/Chicago',
  ME:'America/New_York', MD:'America/New_York',  MA:'America/New_York',
  MI:'America/New_York', MN:'America/Chicago',   MS:'America/Chicago',
  MO:'America/Chicago',  MT:'America/Denver',    NE:'America/Chicago',
  NV:'America/Los_Angeles',NH:'America/New_York',NJ:'America/New_York',
  NM:'America/Denver',   NY:'America/New_York',  NC:'America/New_York',
  ND:'America/Chicago',  OH:'America/New_York',  OK:'America/Chicago',
  OR:'America/Los_Angeles',PA:'America/New_York',RI:'America/New_York',
  SC:'America/New_York', SD:'America/Chicago',   TN:'America/Chicago',
  TX:'America/Chicago',  UT:'America/Denver',    VT:'America/New_York',
  VA:'America/New_York', WA:'America/Los_Angeles',WV:'America/New_York',
  WI:'America/Chicago',  WY:'America/Denver',    DC:'America/New_York',
}

const TZ_OPTIONS = [
  { value: 'America/New_York',    label: 'Eastern (ET)'   },
  { value: 'America/Chicago',     label: 'Central (CT)'   },
  { value: 'America/Denver',      label: 'Mountain (MT)'  },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)'   },
  { value: 'America/Anchorage',   label: 'Alaska (AKT)'   },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HT)'    },
]

function toDateTimeLocal(date) {
  // Returns "YYYY-MM-DDTHH:MM" in local time
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function addHours(dtLocalStr, hours) {
  if (!dtLocalStr) return ''
  const d = new Date(dtLocalStr)
  d.setHours(d.getHours() + hours)
  return toDateTimeLocal(d)
}

// ── CalendarEventModal ─────────────────────────────────────────────────────────

export default function CalendarEventModal({ lead, onClose }) {
  const { session } = useAuth()

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' }
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
    return h
  }

  // Default start: next upcoming hour, rounded up
  const defaultStart = () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    now.setHours(now.getHours() + 1)
    return toDateTimeLocal(now)
  }

  const startDefault = defaultStart()
  const tzDefault    = STATE_IANA[lead?.state?.toUpperCase()] || 'America/New_York'

  const [title,      setTitle]      = useState(`Appt with ${lead?.name || ''}`)
  const [startDt,    setStartDt]    = useState(startDefault)
  const [endDt,      setEndDt]      = useState(addHours(startDefault, 1))
  const [guestEmail, setGuestEmail] = useState(lead?.email || '')
  const [timeZone,   setTimeZone]   = useState(tzDefault)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState(null) // { htmlLink }

  // Keep end time 1 hour after start when start changes
  function handleStartChange(val) {
    setStartDt(val)
    setEndDt(addHours(val, 1))
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCreate() {
    if (!title.trim())  { setError('Title is required'); return }
    if (!startDt)       { setError('Start time is required'); return }
    if (!endDt)         { setError('End time is required'); return }
    if (endDt <= startDt) { setError('End time must be after start time'); return }

    setSaving(true)
    setError('')

    try {
      // Convert the datetime-local string + timezone to ISO 8601 with offset
      // We send the local datetime string and the IANA timezone; the API passes
      // them to Google as-is (Google Calendar accepts IANA tz + local dateTime).
      const res = await fetch('/api/google-calendar', {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify({
          title:         title.trim(),
          startDateTime: startDt + ':00',   // append seconds
          endDateTime:   endDt   + ':00',
          guestEmail:    guestEmail.trim() || null,
          timeZone,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Failed to create event')
        return
      }

      setSuccess({ htmlLink: data.htmlLink })
    } catch (err) {
      setError(err.message || 'Unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = [
    'w-full text-sm rounded-lg px-3 py-2 border bg-white dark:bg-white/5 text-gray-900 dark:text-white',
    'border-gray-200 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors',
  ].join(' ')

  const labelCls = 'block text-xs text-gray-500 dark:text-white/50 mb-1'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <span>📅</span> Add to Google Calendar
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none">✕</button>
        </div>

        {success ? (
          /* ── Success state ── */
          <div className="px-5 py-8 text-center space-y-4">
            <p className="text-4xl">✅</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Event created!</p>
            {success.htmlLink && (
              <a
                href={success.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-accent hover:underline"
              >
                View in Google Calendar →
              </a>
            )}
            <div className="pt-2">
              <button
                onClick={onClose}
                className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-4">

              {/* Title */}
              <div>
                <label className={labelCls}>Event Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Appointment title"
                  className={inputCls}
                  autoFocus
                />
              </div>

              {/* Timezone */}
              <div>
                <label className={labelCls}>
                  Timezone
                  {lead?.state && (
                    <span className="ml-1 text-gray-400 dark:text-white/30">(auto-detected from lead's state)</span>
                  )}
                </label>
                <select
                  value={timeZone}
                  onChange={e => setTimeZone(e.target.value)}
                  className={inputCls + ' cursor-pointer'}
                >
                  {TZ_OPTIONS.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>

              {/* Date / time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Start</label>
                  <input
                    type="datetime-local"
                    value={startDt}
                    onChange={e => handleStartChange(e.target.value)}
                    className={inputCls + ' dark:[color-scheme:dark]'}
                  />
                </div>
                <div>
                  <label className={labelCls}>End</label>
                  <input
                    type="datetime-local"
                    value={endDt}
                    onChange={e => setEndDt(e.target.value)}
                    min={startDt}
                    className={inputCls + ' dark:[color-scheme:dark]'}
                  />
                </div>
              </div>

              {/* Guest email */}
              <div>
                <label className={labelCls}>Guest Email <span className="font-normal">(optional — sends invite)</span></label>
                <input
                  type="email"
                  value={guestEmail}
                  onChange={e => setGuestEmail(e.target.value)}
                  placeholder="lead@example.com"
                  className={inputCls}
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
              )}

            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-2 shrink-0">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Creating…' : 'Create Event'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
