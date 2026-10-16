import { useCallback, useEffect, useRef, useState } from 'react'

// Today's Quick Log counters (Dials, Contacts, Appts Set, Presentations, No Shows) — the same
// five incrementers as on Activity Tracking, writing to the same activity row for today.
// The endpoint rewrites the whole day's row, so every save sends the other columns back unchanged.
// Saves are serialized: while one is in flight further taps just mark the row dirty and the loop
// sends the latest values once it returns, so they can't land out of order.

export const QUICK_METRICS = [
  { key: 'dials',      label: 'Dials' },
  { key: 'contacts',   label: 'Contacts' },
  { key: 'appts_set',  label: 'Appts Set' },
  { key: 'appts_kept', label: 'Presentations' },
  { key: 'no_shows',   label: 'No Shows' },
]

const LOG_COLUMNS = [
  'dials', 'hours_dialed', 'reachouts', 'posts', 'contacts', 'appts_set', 'appts_kept',
  'no_shows', 'apps_written', 'resets', 'apv_submitted', 'apv_issued', 'notes',
]

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function useQuickLog(sfgId) {
  const [log,   setLog]   = useState(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const rowRef      = useRef(null)          // latest local row for today — what every save sends
  const dayRef      = useRef(localDay())
  const inFlight    = useRef(false)
  const dirty       = useRef(false)

  const load = useCallback(async () => {
    if (!sfgId) return
    setReady(false)
    dayRef.current = localDay()
    try {
      const res = await fetch(`/api/activity?sfg_id=${encodeURIComponent(sfgId)}&start=${dayRef.current}&end=${dayRef.current}`)
      if (!res.ok) { setError('Couldn’t load today’s log'); return }
      const { logs } = await res.json()
      rowRef.current = logs?.[0] ?? null
      setLog(rowRef.current)
      setError('')
      setReady(true)
    } catch { setError('Couldn’t load today’s log') }
  }, [sfgId])

  useEffect(() => { load() }, [load])

  async function pump() {
    if (inFlight.current) { dirty.current = true; return }
    inFlight.current = true
    try {
      do {
        dirty.current = false
        const row  = rowRef.current
        const body = { sfg_id: sfgId, log_date: dayRef.current }
        for (const col of LOG_COLUMNS) body[col] = row?.[col] ?? ''
        const res  = await fetch('/api/activity', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Save failed'); dirty.current = false; load(); return }
        if (!dirty.current) { rowRef.current = data.log; setLog(data.log) }
      } while (dirty.current)
    } catch (err) {
      setError(err.message)
      load()
    } finally {
      inFlight.current = false
    }
  }

  const adjust = useCallback((key, delta) => {
    if (!ready || !sfgId) return
    // A dial session can run past midnight: start the new day from its own row
    if (localDay() !== dayRef.current) { load(); return }
    const base    = rowRef.current ?? {}
    const current = Number(base[key]) || 0
    const next    = Math.max(0, current + delta)
    if (next === current) return
    rowRef.current = { ...base, [key]: next }
    setLog(rowRef.current)
    setError('')
    pump()
  }, [ready, sfgId, load]) // eslint-disable-line react-hooks/exhaustive-deps

  return { log, ready, error, adjust }
}
