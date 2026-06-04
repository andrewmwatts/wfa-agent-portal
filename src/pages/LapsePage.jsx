import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../utils/agencyScope'

const CARRIER_ALIASES = {
  'american amicable group': 'American Amicable',
  'occidental':              'American Amicable',
  'lga':                     'Banner',
  'corebridge':              'American General',
  'transamerica group':      'TransAmerica',
  'foresters dfl':           'Foresters',
}

function normalizeCarrier(raw) {
  if (!raw) return raw
  return CARRIER_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}

function daysToLapse(conservationDate) {
  if (!conservationDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const lapse = new Date(conservationDate)
  lapse.setHours(0, 0, 0, 0)
  return Math.round((lapse - today) / (1000 * 60 * 60 * 24))
}

function getUrgency(days) {
  if (days === null) return 'none'
  if (days < 0)    return 'overdue'
  if (days <= 7)   return 'critical'
  if (days <= 30)  return 'warning'
  return 'normal'
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmt(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  if (isNaN(n)) return v || '—'
  if (n === 0) return '$0'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ─── Quick filter config ──────────────────────────────────────────────────────

const QUICK_FILTERS = [
  { id: 'pending', label: 'Pending' },
  { id: 'all',     label: 'All' },
]

const SORT_OPTIONS = [
  { id: 'lapse-date', label: 'Lapse Date' },
  { id: 'agent',      label: 'Agent Name A–Z' },
  { id: 'carrier',    label: 'Carrier A–Z' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LapsePage() {
  const { activeSubject, permissions } = useViewing()
  const { theme } = useTheme()

  const [policies,    setPolicies]        = useState([])
  const [allPolicies, setAllPolicies]     = useState([])
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [masterPersonnel, setMasterPersonnel] = useState([])
  const [loading, setLoading]             = useState(false)
  const [selectedScope, setSelectedScope] = useState('master')
  const [quickFilter, setQuickFilter]     = useState('pending')
  const [search, setSearch]               = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [carrierFilter, setCarrierFilter] = useState('')
  const [agentFilter, setAgentFilter]     = useState('')
  const [sortBy, setSortBy]               = useState('lapse-date')
  const [selected, setSelected]           = useState(null)
  const [selectedSource, setSelectedSource] = useState('table')
  const [quickSearchOpen, setQuickSearchOpen]   = useState(false)
  const [quickSearchQuery, setQuickSearchQuery] = useState('')

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master&include=policies`)
      if (!res.ok) return
      const { personnel: masterPersonnel, policies: rows } = await res.json()

      setMasterPersonnel(masterPersonnel)
      setSelectedScope('master')

      const normalized = (rows ?? []).map(p => ({ ...p, carrier: normalizeCarrier(p.carrier) }))
      setAllPolicies(normalized)
      setPolicies(normalized.filter(p => p.conservation_status?.trim()))
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function handleScopeChange(scope) {
    setSelectedScope(scope)
    setLoading(true)
    try {
      const scoped = scope === 'master'
        ? masterPersonnel
        : masterPersonnel.filter(p => getBaseshopIds(scope, masterPersonnel).has(p.sfg_id.toLowerCase()))
      await loadPolicies(scoped)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function loadPolicies(personnel) {
    const sfgIds = personnel.map(p => p.sfg_id)
    if (!sfgIds.length) { setPolicies([]); return }

    const polRes = await fetch(`/api/policies?sfg_ids=${sfgIds.join(',')}`)
    if (!polRes.ok) return
    const { policies: rows } = await polRes.json()

    // Normalize carriers; keep all for quick search, filter to conservation records for the table
    const normalized = (rows ?? []).map(p => ({ ...p, carrier: normalizeCarrier(p.carrier) }))
    setAllPolicies(normalized)
    setPolicies(normalized.filter(p => p.conservation_status?.trim()))
  }

  // ── Derived filter options ────────────────────────────────────────────────────
  const statuses = useMemo(() => [...new Set(policies.map(p => p.conservation_status).filter(Boolean))].sort(), [policies])
  const carriers = useMemo(() => [...new Set(policies.map(p => p.carrier).filter(Boolean))].sort(), [policies])
  const agents   = useMemo(() => [...new Set(policies.map(p => p.agent).filter(Boolean))].sort(), [policies])

  // ── Filter ────────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return policies.filter(p => {
      const days = daysToLapse(p.conservation_date)

      // "Pending" = conservation_status is Lapse Pending or First Premium Not Paid
      if (quickFilter === 'pending') {
        const cs = (p.conservation_status || '').toLowerCase()
        if (cs !== 'lapse pending' && cs !== 'first premium not paid') return false
      }

      if (statusFilter  && p.conservation_status !== statusFilter)  return false
      if (carrierFilter && p.carrier !== carrierFilter)              return false
      if (agentFilter   && p.agent   !== agentFilter)               return false
      if (search && !p.applicant?.toLowerCase().includes(search.toLowerCase())) return false

      return true
    })
  }, [policies, quickFilter, statusFilter, carrierFilter, agentFilter, search])

  // ── Sort ──────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...filtered]
    const cmpDays = (a, b) => {
      const da = daysToLapse(a.conservation_date)
      const db = daysToLapse(b.conservation_date)
      if (da === null && db === null) return 0
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    }
    switch (sortBy) {
      case 'lapse-date': arr.sort(cmpDays); break
      case 'agent':      arr.sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? '')); break
      case 'carrier':    arr.sort((a, b) => (a.carrier ?? '').localeCompare(b.carrier ?? '')); break
    }
    return arr
  }, [filtered, sortBy])

  // ── Quick search ──────────────────────────────────────────────────────────────
  const quickSearchResults = useMemo(() => {
    if (!quickSearchQuery.trim()) return []
    const q = quickSearchQuery.toLowerCase()
    return allPolicies.filter(p => p.applicant?.toLowerCase().includes(q)).slice(0, 20)
  }, [allPolicies, quickSearchQuery])

  function openFromTable(policy)  { setSelected(policy); setSelectedSource('table') }
  function openFromSearch(policy) { setSelected(policy); setSelectedSource('search') }
  function closeDetail() {
    setSelected(null)
    if (selectedSource === 'search') setQuickSearchOpen(true)
  }

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view lapse data.</p>
    </div>
  )

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">

      {/* ── Header row ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Lapse / Pending Lapse</h1>
          {isDirector && (
            <ScopeDropdown
              masterPersonnel={masterPersonnel}
              selfId={activeSubject?.sfg_id}
              value={selectedScope}
              onChange={handleScopeChange}
            />
          )}
        </div>
        <button
          onClick={() => { setQuickSearchOpen(true); setQuickSearchQuery('') }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/>
          </svg>
          Quick Search
        </button>
      </div>

      {/* ── Quick filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {QUICK_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setQuickFilter(f.id)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              quickFilter === f.id
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Filter / sort row ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
        >
          <option value="" style={optionStyle}>All Statuses</option>
          {statuses.map(s => <option key={s} value={s} style={optionStyle}>{s}</option>)}
        </select>

        <select
          value={carrierFilter}
          onChange={e => setCarrierFilter(e.target.value)}
          className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
        >
          <option value="" style={optionStyle}>All Carriers</option>
          {carriers.map(c => <option key={c} value={c} style={optionStyle}>{c}</option>)}
        </select>

        <select
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
        >
          <option value="" style={optionStyle}>All Agents</option>
          {agents.map(a => <option key={a} value={a} style={optionStyle}>{a}</option>)}
        </select>

        <input
          type="text"
          placeholder="Search client…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-white/30 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/60 w-44"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-white/40 whitespace-nowrap">Order by</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
          >
            {SORT_OPTIONS.map(o => <option key={o.id} value={o.id} style={optionStyle}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-11 bg-gray-100 dark:bg-white/10 rounded-xl" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 dark:text-white/30 text-sm">No lapse records match your filters.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'Issued APV', 'Expected Lapse Date', 'Days'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-4 py-3 first:pl-5 last:pr-5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => {
                  const days = daysToLapse(p.conservation_date)
                  const urg  = getUrgency(days)
                  const rowBg = {
                    overdue:  'bg-red-500/10',
                    critical: 'bg-red-500/5',
                    warning:  'bg-amber-500/5',
                    normal:   '',
                    none:     '',
                  }[urg]
                  return (
                    <tr
                      key={i}
                      onClick={() => openFromTable(p)}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${rowBg}`}
                    >
                      <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs">{p.agent}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs">{p.applicant}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{p.carrier}</td>
                      <td className="px-4 py-3"><ConsBadge status={p.conservation_status} urg={urg} /></td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.conservation_date)}</td>
                      <td className="px-4 py-3 pr-5"><DaysBadge days={days} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Detail modal ─────────────────────────────────────────────────────── */}
      {selected && (
        <LapseModal
          policy={selected}
          onClose={closeDetail}
          onBack={selectedSource === 'search' ? () => { setSelected(null); setQuickSearchOpen(true) } : null}
          canWrite={permissions?.appsAndPolicies?.write ?? false}
          onUpdate={updated => {
            setSelected(updated)
            setAllPolicies(prev => prev.map(p => p.id === updated.id ? updated : p))
            if (updated.conservation_status?.trim()) {
              // Add to table list if newly given a conservation status, otherwise update in place
              setPolicies(prev =>
                prev.some(p => p.id === updated.id)
                  ? prev.map(p => p.id === updated.id ? updated : p)
                  : [...prev, updated]
              )
            } else {
              // Conservation status removed — drop from table
              setPolicies(prev => prev.filter(p => p.id !== updated.id))
            }
          }}
        />
      )}

      {/* ── Quick search modal ───────────────────────────────────────────────── */}
      {quickSearchOpen && !selected && (
        <QuickSearchModal
          query={quickSearchQuery}
          setQuery={setQuickSearchQuery}
          results={quickSearchResults}
          onSelect={openFromSearch}
          onClose={() => { setQuickSearchOpen(false); setQuickSearchQuery('') }}
        />
      )}

    </main>
  )
}

// ─── Shared badge components ──────────────────────────────────────────────────


function ConsBadge({ status, urg }) {
  if (!status) return <span className="text-gray-300 dark:text-white/20 text-xs">—</span>
  const cls = (urg === 'overdue' || urg === 'critical')
    ? 'bg-red-500/15 text-red-500 dark:text-red-300'
    : urg === 'warning'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
    : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/60'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${cls}`}>{status}</span>
}

function DaysBadge({ days }) {
  if (days === null) return <span className="text-gray-300 dark:text-white/30 text-xs">—</span>
  const cls = days < 0
    ? 'text-red-500 dark:text-red-300 font-bold'
    : days <= 7  ? 'text-red-500 dark:text-red-300 font-semibold'
    : days <= 30 ? 'text-amber-600 dark:text-amber-300'
    : 'text-gray-500 dark:text-white/60'
  return <span className={`text-xs tabular-nums ${cls}`}>{days}</span>
}

// ─── Quick Search Modal ───────────────────────────────────────────────────────

function QuickSearchModal({ query, setQuery, results, onSelect, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 dark:border-white/10">
          <input
            autoFocus
            type="text"
            placeholder="Search by client name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && query.trim() && (
            <p className="text-gray-400 dark:text-white/30 text-sm text-center py-8">No results</p>
          )}
          {results.map((p, i) => {
            const days = daysToLapse(p.conservation_date)
            const urg  = getUrgency(days)
            return (
              <button
                key={i}
                onClick={() => { onClose(); onSelect(p) }}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{p.applicant}</span>
                  <ConsBadge status={p.conservation_status} urg={urg} />
                </div>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
                  {p.agent} · {p.carrier} · {fmtDate(p.conservation_date)}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Lapse edit helpers ───────────────────────────────────────────────────────

function toInputDate(str) {
  if (!str) return ''
  // ISO date (YYYY-MM-DD) — use directly to avoid UTC→local shift
  const iso = String(str).match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const d = new Date(str)
  if (isNaN(d)) return str
  return d.toISOString().slice(0, 10)
}

const LAPSE_INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

const LAPSE_COL_MAP = {
  carrier:             'carrier',
  policy_type:         'policy_name',
  policy_no:           'policy_number',
  issue_date:          'issue_date',
  issued_apv:          'issued_apv',
  face_amt:            'face_amount',
  conservation_status: 'conservation_status',
  conservation_date:   'conservation_date',
  cb_month:            'snapshot_chargeback_month',
  cb_apv:              'snapshot_chargeback_apv',
  policy_notes:        'policy_notes',
  last_update:         'last_update',
}

function LapseEditField({ label, value, onChange, type = 'text', span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={LAPSE_INPUT_CLS}
      />
    </div>
  )
}

// ─── Lapse Detail Modal ───────────────────────────────────────────────────────

function LapseModal({ policy: p, onClose, onBack, canWrite, onUpdate }) {
  const [editing,   setEditing]   = useState(false)
  const [draft,     setDraft]     = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [removing,  setRemoving]  = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function startEdit() {
    setDraft({ ...p })
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  function setField(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function handleRemoveConservation() {
    setRemoving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id,
          updates: { conservation_status: '', conservation_date: '' },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Remove failed')
      }
      const updated = { ...p, conservation_status: '', conservation_date: '' }
      onUpdate?.(updated)
      onClose()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setRemoving(false)
    }
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const updates = {}
      for (const [key, col] of Object.entries(LAPSE_COL_MAP)) {
        updates[col] = String(draft[key] ?? '')
      }
      // Boolean fields handled separately
      updates.chargeback_exempt = !!draft.chargeback_exempt
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, updates }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      onUpdate?.(draft)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const display = editing ? draft : p

  const days = daysToLapse(display.conservation_date)
  const urg  = getUrgency(days)

  const daysLabel = days === null      ? null
    : days < 0    ? `${Math.abs(days)}d overdue`
    : days === 0  ? 'Due today'
    : `${days}d remaining`

  const daysCls = (urg === 'overdue' || urg === 'critical')
    ? 'bg-red-500/15 text-red-500 dark:text-red-300'
    : urg === 'warning'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" />
      <div
        className="relative bg-white dark:bg-secondary border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">

          {/* Back / close / edit */}
          <div className="flex items-center justify-between mb-4">
            <div>
              {onBack && (
                <button onClick={onBack} className="text-xs text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70 transition-colors">← Back to search</button>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {canWrite && !editing && (
                <>
                  <button
                    onClick={handleRemoveConservation}
                    disabled={removing}
                    className="text-xs font-medium text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {removing ? 'Removing…' : 'Remove Conservation'}
                  </button>
                  <button
                    onClick={startEdit}
                    className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10"
                  >
                    Edit
                  </button>
                </>
              )}
              {editing && (
                <>
                  <button
                    onClick={cancelEdit}
                    className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {saving && (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    )}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
              <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {saveError && (
            <div className="mb-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300">
              {saveError}
            </div>
          )}

          {/* Client + days pill */}
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{display.applicant}</h2>
              <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">{display.agent}</p>
            </div>
            {daysLabel && (
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 ${daysCls}`}>
                {daysLabel}
              </span>
            )}
          </div>

          {/* Policy details */}
          <ModalSection title="Policy">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <LapseEditField label="Carrier"     value={draft.carrier}     onChange={v => setField('carrier', v)} />
                <LapseEditField label="Policy Type" value={draft.policy_type} onChange={v => setField('policy_type', v)} />
                <LapseEditField label="Policy #"    value={draft.policy_no}   onChange={v => setField('policy_no', v)} />
                <LapseEditField label="Issue Date"  value={toInputDate(draft.issue_date)}  onChange={v => setField('issue_date', v)}  type="date" />
                <LapseEditField label="Issued APV"  value={draft.issued_apv ?? ''} onChange={v => setField('issued_apv', v)} />
                <LapseEditField label="Face Amount" value={draft.face_amt ?? ''}   onChange={v => setField('face_amt', v)} />
              </div>
            ) : (
              <ModalGrid>
                <ModalField label="Carrier"      value={display.carrier} />
                <ModalField label="Policy Type"  value={display.policy_type} />
                <ModalField label="Policy #"     value={display.policy_no} mono />
                <ModalField label="Issue Date"   value={fmtDate(display.issue_date)} />
                <ModalField label="Issued APV"   value={fmtAmt(display.issued_apv)} />
                <ModalField label="Face Amount"  value={fmtAmt(display.face_amt)} />
              </ModalGrid>
            )}
          </ModalSection>

          {/* Conservation */}
          <ModalSection title="Conservation">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <LapseEditField label="Status"              value={draft.conservation_status}  onChange={v => setField('conservation_status', v)} />
                <LapseEditField label="Expected Lapse Date" value={toInputDate(draft.conservation_date)} onChange={v => setField('conservation_date', v)} type="date" />
                <LapseEditField label="Chargeback Month"    value={draft.cb_month ?? ''}  onChange={v => setField('cb_month', v)} />
                <LapseEditField label="Chargeback APV"      value={draft.cb_apv ?? ''}    onChange={v => setField('cb_apv', v)} />
                <div className="col-span-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!draft.chargeback_exempt}
                      onChange={e => setField('chargeback_exempt', e.target.checked)}
                      className="w-4 h-4 rounded accent-accent cursor-pointer"
                    />
                    <span className="text-sm text-gray-700 dark:text-white/70">Not reported</span>
                  </label>
                </div>
              </div>
            ) : (
              <ModalGrid>
                <ModalField label="Status"              value={display.conservation_status} />
                <ModalField label="Expected Lapse Date" value={fmtDate(display.conservation_date)} />
                <ModalField label="Chargeback Month"    value={display.cb_month} />
                <ModalField label="Chargeback APV"      value={fmtAmt(display.cb_apv)} />
                {display.chargeback_exempt && (
                  <div className="col-span-2">
                    <span className="text-xs font-medium bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 px-2 py-0.5 rounded">Not reported</span>
                  </div>
                )}
              </ModalGrid>
            )}
          </ModalSection>

          {/* Flags */}
          {(display.not_in_opt || display.split_reset) && (
            <ModalSection title="Flags">
              <div className="flex flex-wrap gap-4">
                <CheckItem label="Not in Opt"  value={display.not_in_opt} />
                <CheckItem label="Split/Reset" value={display.split_reset} />
              </div>
            </ModalSection>
          )}

          {/* Notes */}
          <ModalSection title="Notes">
            {editing ? (
              <textarea
                value={draft.policy_notes ?? ''}
                onChange={e => setField('policy_notes', e.target.value)}
                rows={3}
                className={`${LAPSE_INPUT_CLS} resize-none`}
                placeholder="Policy notes…"
              />
            ) : (
              display.policy_notes?.trim()
                ? <p className="text-sm text-gray-700 dark:text-white/80 whitespace-pre-wrap">{display.policy_notes}</p>
                : <p className="text-sm text-gray-400 dark:text-white/30">—</p>
            )}
          </ModalSection>

          {editing ? (
            <div className="mt-2">
              <LapseEditField label="Last Update" value={toInputDate(draft.last_update)} onChange={v => setField('last_update', v)} type="date" />
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-white/30 mt-4 text-right">
              Last updated: {fmtDate(display.last_update)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function ModalSection({ title, children }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3 pb-1.5 border-b border-gray-100 dark:border-white/10">
        {title}
      </h3>
      {children}
    </div>
  )
}

function ModalGrid({ children }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
}

function ModalField({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`text-sm text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  )
}

function CheckItem({ label, value }) {
  const checked = !!value && !['false', '0', 'no', 'n', ''].includes(String(value).trim().toLowerCase())
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
        checked ? 'bg-accent/20 border-accent/50' : 'bg-gray-100 border-gray-300 dark:bg-white/5 dark:border-white/20'
      }`}>
        {checked && (
          <svg className="w-2.5 h-2.5 text-accent" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
          </svg>
        )}
      </div>
      <span className={`text-sm ${checked ? 'text-gray-900 dark:text-white/80' : 'text-gray-400 dark:text-white/35'}`}>{label}</span>
    </div>
  )
}
