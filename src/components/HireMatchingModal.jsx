import { useEffect, useState, useCallback } from 'react'

// ── Fuzzy scoring ──────────────────────────────────────────────────────────────

function normPhone(v) { return (v ?? '').replace(/[^0-9]/g, '') }
function normEmail(v) { return (v ?? '').trim().toLowerCase() }

function scoreCandidate(hire, candidate) {
  const hireNameFull  = (hire.preferred_name ?? '').trim().toLowerCase()
  const hireTokens    = hireNameFull.split(/\s+/).filter(Boolean)
  const hireFirst     = hireTokens[0] ?? ''
  const hireLast      = hireTokens[hireTokens.length - 1] ?? ''

  const candNameFull  = (candidate.name ?? '').trim().toLowerCase()
  const candTokens    = candNameFull.split(/\s+/).filter(Boolean)
  const candFirst     = candTokens[0] ?? ''
  const candLast      = candTokens[candTokens.length - 1] ?? ''

  // ── Disqualifying signals ────────────────────────────────────────────────
  // Lead added more than 7 days after hire date
  if (hire.hire_date && candidate.added) {
    const hireMs  = new Date(hire.hire_date).getTime()
    const addedMs = new Date(candidate.added).getTime()
    const days    = (hireMs - addedMs) / 86400000
    if (days < -7) return null // disqualified
  }
  // Single-word lead name that doesn't match either hire name token
  if (candTokens.length === 1 && candFirst !== hireFirst && candFirst !== hireLast) {
    return null
  }

  // ── Name match (required) ────────────────────────────────────────────────
  let nameScore = 0
  const signals = []

  if (hireNameFull === candNameFull) {
    nameScore = 40
    signals.push('Name match')
  } else if (hireFirst && hireLast) {
    if (hireFirst === candFirst && (candLast.startsWith(hireLast) || candLast.includes(hireLast))) {
      nameScore = 30
      signals.push('Name match')
    } else if (hireLast === candLast && (candFirst.startsWith(hireFirst) || candFirst.includes(hireFirst))) {
      nameScore = 25
      signals.push('Name match')
    } else {
      const hireSet = new Set(hireTokens)
      const anyMatch = candTokens.some(t => hireSet.has(t)) ||
                       hireTokens.some(t => candNameFull.includes(t) && t.length > 2)
      if (anyMatch) {
        nameScore = 15
        signals.push('Name match')
      }
    }
  } else if (hireFirst && (candNameFull.includes(hireFirst) || hireFirst === candFirst)) {
    nameScore = 15
    signals.push('Name match')
  }

  if (nameScore === 0) return null // name is a required signal

  let score = nameScore

  // ── Confirming signals ────────────────────────────────────────────────────
  const hirePhone = normPhone(hire.phone)
  const candPhone = normPhone(candidate.phone)
  if (hirePhone && candPhone && hirePhone === candPhone) {
    score += 25; signals.push('Phone match')
  }

  const hireEmail = normEmail(hire.email)
  const candEmail = normEmail(candidate.email)
  if (hireEmail && candEmail && hireEmail === candEmail) {
    score += 20; signals.push('Email match')
  }

  if (hire.state && candidate.state &&
      hire.state.trim().toLowerCase() === candidate.state.trim().toLowerCase()) {
    score += 10; signals.push('State match')
  }

  if (hire.city && candidate.city &&
      hire.city.trim().toLowerCase() === candidate.city.trim().toLowerCase()) {
    score += 5; signals.push('City match')
  }

  if (hire.hire_date && candidate.added) {
    const days = (new Date(hire.hire_date) - new Date(candidate.added)) / 86400000
    if (days >= 0 && days <= 90)       { score += 10 }
    else if (days >= 0 && days <= 180) { score += 5  }
  }

  return { score, signals }
}

function confidenceLabel(score) {
  if (score >= 70) return { label: 'Strong match',   cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'  }
  if (score >= 50) return { label: 'Likely match',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'      }
  return                  { label: 'Possible match', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'   }
}

function fmtDate(d) {
  if (!d) return '—'
  const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!iso) return d
  return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function HireMatchingModal({ newHires, onClose, authHeaders }) {
  const [hireIdx,      setHireIdx]      = useState(0)
  const [candidates,   setCandidates]   = useState([])  // scored + sorted
  const [dismissed,    setDismissed]    = useState(new Set()) // candidate ids dismissed for this hire
  const [loading,      setCandLoading]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState(null)
  const [done,         setDone]         = useState([])  // { sfg_id, action, leadName }

  const hire = newHires[hireIdx]
  const total = newHires.length

  // ── Fetch + score candidates whenever hire changes ─────────────────────────
  const loadCandidates = useCallback(async () => {
    if (!hire?.upline_sfg_id) { setCandidates([]); return }
    setCandLoading(true)
    setSaveError(null)
    setDismissed(new Set())
    try {
      const res = await fetch(
        `/api/leads?action=hire_candidates&upline_sfg_id=${encodeURIComponent(hire.upline_sfg_id)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) { setCandidates([]); return }
      const { candidates: raw } = await res.json()

      // Score and filter
      const scored = (raw ?? [])
        .map(c => {
          const result = scoreCandidate(hire, c)
          return result ? { ...c, _score: result.score, _signals: result.signals } : null
        })
        .filter(Boolean)
        .filter(c => c._score >= 30)
        .sort((a, b) => b._score - a._score)
        .slice(0, 3)

      setCandidates(scored)
    } finally {
      setCandLoading(false)
    }
  }, [hire?.sfg_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCandidates() }, [loadCandidates])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function confirmMatch(candidate) {
    if (!hire) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/leads?id=${candidate.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          hired_sfg_id: hire.sfg_id,
          hire_date:    hire.hire_date || null,
          status:       'hired',
        }),
      })
      if (!res.ok) throw new Error('Failed to link lead')
      setDone(prev => [...prev, { sfg_id: hire.sfg_id, action: 'linked', leadName: candidate.name }])
      advanceHire()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function createStub() {
    if (!hire) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/leads?action=create_stub', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          upline_sfg_id: hire.upline_sfg_id,
          name:          hire.preferred_name,
          hire_date:     hire.hire_date || null,
          hired_sfg_id:  hire.sfg_id,
        }),
      })
      if (!res.ok) throw new Error('Failed to create stub')
      setDone(prev => [...prev, { sfg_id: hire.sfg_id, action: 'stub', leadName: hire.preferred_name }])
      advanceHire()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function skipHire() {
    setDone(prev => [...prev, { sfg_id: hire.sfg_id, action: 'skipped', leadName: hire.preferred_name }])
    advanceHire()
  }

  function dismissCandidate(id) {
    setDismissed(prev => new Set([...prev, id]))
  }

  function advanceHire() {
    if (hireIdx + 1 < total) {
      setHireIdx(i => i + 1)
    } else {
      setHireIdx(total) // triggers summary view
    }
  }

  // ── Visible candidates (minus dismissed) ──────────────────────────────────
  const visible = candidates.filter(c => !dismissed.has(c.id))

  // ── Summary phase ──────────────────────────────────────────────────────────
  if (hireIdx >= total) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Hire Matching Complete</h2>
          <div className="space-y-2">
            {done.map((d, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  d.action === 'linked' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' :
                  d.action === 'stub'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' :
                  'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-white/40'
                }`}>
                  {d.action === 'linked' ? 'Linked' : d.action === 'stub' ? 'Stub created' : 'Skipped'}
                </span>
                <span className="text-gray-700 dark:text-white/80">{d.leadName}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="w-full text-sm px-4 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Matching phase ─────────────────────────────────────────────────────────
  const noMoreCandidates = !loading && visible.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Link New Hire to Lead</h2>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
              {hireIdx + 1} of {total} — {total - hireIdx - 1} remaining
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New hire info */}
        <div className="px-5 py-3 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">New hire</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">{hire?.preferred_name || '—'}</p>
          <div className="flex gap-4 mt-0.5 flex-wrap">
            {hire?.hire_date && <span className="text-xs text-gray-500 dark:text-white/50">Hired {fmtDate(hire.hire_date)}</span>}
            {hire?.sfg_id    && <span className="text-xs font-mono text-gray-400 dark:text-white/30">{hire.sfg_id}</span>}
          </div>
        </div>

        {/* Candidates */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[0,1,2].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-white/5 rounded-xl" />)}
            </div>
          ) : noMoreCandidates ? (
            <div className="text-center py-8 text-gray-400 dark:text-white/30 space-y-1">
              <p className="text-2xl">🔍</p>
              <p className="text-sm">No matching leads found in {hire?.upline_sfg_id}'s pipeline</p>
            </div>
          ) : (
            visible.map(c => {
              const conf = confidenceLabel(c._score)
              return (
                <div key={c.id} className="border border-gray-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{c.name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        {c.source && <span className="text-xs text-gray-400 dark:text-white/40">{c.source}</span>}
                        {c.added  && <span className="text-xs text-gray-400 dark:text-white/40">Added {fmtDate(c.added)}</span>}
                        {c.state  && <span className="text-xs text-gray-400 dark:text-white/40">📍 {c.state}</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${conf.cls}`}>
                      {conf.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c._signals.map(sig => (
                      <span key={sig} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent dark:bg-accent/15">
                        {sig}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmMatch(c)}
                      disabled={saving}
                      className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      ✓ Confirm Match
                    </button>
                    <button
                      onClick={() => dismissCandidate(c.id)}
                      disabled={saving}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      Not a Match
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {saveError && (
          <div className="px-5 py-2 shrink-0">
            <p className="text-xs text-red-500 dark:text-red-400">{saveError}</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex gap-2 shrink-0">
          <button
            onClick={createStub}
            disabled={saving}
            className="flex-1 text-xs font-semibold px-3 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            Create Stub
          </button>
          <button
            onClick={skipHire}
            disabled={saving}
            className="flex-1 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
