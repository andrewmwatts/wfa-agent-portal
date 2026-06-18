import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import AddPolicyModal from '../components/AddPolicyModal'
import PolicyModal, { PolicyModalErrorBoundary, StatusBadge } from '../components/PolicyEditModal'
import BulkImportModal from '../components/BulkImportModal'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../utils/agencyScope'
import { parseDateLocal, fmtDate, fmtCurrency as fmtAmt } from '../utils/format'
import { normalizeCarrier } from '../../shared/carriers'
import { ACTIVE_STATUSES, FINAL_STATUSES, statusWeight } from '../utils/status'

function parseDate(str) {
  return parseDateLocal(str)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Compare two date strings; nulls sort to the end
function cmpDate(a, b, dir = 'desc') {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return dir === 'desc' ? db - da : da - db
}

// ─── Quick-filter definitions ──────────────────────────────────────────────────

const QUICK_FILTERS = [
  { id: 'this-month', label: 'This Month' },
  { id: 'last-month', label: 'Last Month' },
  { id: 'pending',    label: 'Show Pending' },
  { id: 'all-time',   label: 'All Time' },
  { id: 'all',        label: 'Show All' },
]

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PoliciesPage() {
  const { activeSubject, permissions } = useViewing()
  const { userProfile }                = useAuth()
  const { theme } = useTheme()
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [policies,   setPolicies]   = useState([])
  const [personnel,        setPersonnel]        = useState([])
  const [masterPersonnel,  setMasterPersonnel]  = useState([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState(null)
  const [selectedScope,    setSelectedScope]    = useState('master')
  const [showAddPolicy,   setShowAddPolicy]   = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)

  const isSuperAdmin = userProfile?.role === 'super_admin'

  // Quick filter — default to This Month
  const [quickFilter,   setQuickFilter]   = useState('this-month')
  const [notInOptOnly,  setNotInOptOnly]  = useState(false)

  // Dropdown / search filters
  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [agentFilter,   setAgentFilter]   = useState('all')

  // Custom date range
  const [dateField, setDateField] = useState('submit_date') // 'submit_date' | 'issue_date'
  const [dateStart, setDateStart] = useState('')
  const [dateEnd,   setDateEnd]   = useState('')

  // Sort
  const [sortBy, setSortBy] = useState('submit_date')

  // Pagination
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)

  // Detail modal
  const [selected, setSelected]           = useState(null)
  const [selectedSource, setSelectedSource] = useState(null) // 'table' | 'search'

  // Quick search
  const [quickSearchOpen,  setQuickSearchOpen]  = useState(false)
  const [quickSearchQuery, setQuickSearchQuery] = useState('')

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  function openFromTable(policy) {
    setSelected(policy)
    setSelectedSource('table')
  }

  function openFromSearch(policy) {
    setQuickSearchOpen(false)
    setSelected(policy)
    setSelectedSource('search')
  }

  function closeDetail() {
    const src = selectedSource
    setSelected(null)
    setSelectedSource(null)
    if (src === 'search') setQuickSearchOpen(true)
  }

  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    setError(null)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      // Single request returns both personnel + policies — one cold start, one round-trip
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master&include=policies`)
      if (!res.ok) throw new Error('Failed to load data')
      const { personnel: masterPersonnel, policies } = await res.json()

      setMasterPersonnel(masterPersonnel)
      setPersonnel(masterPersonnel)
      setSelectedScope('master')
      setPolicies(policies ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Called when user changes the scope dropdown — filters client-side, no re-fetch
  async function handleScopeChange(scope) {
    if (!activeSubject?.sfg_id) return
    setSelectedScope(scope)
    setLoading(true)
    setError(null)
    try {
      const scoped = scope === 'master'
        ? masterPersonnel
        : masterPersonnel.filter(p => getBaseshopIds(scope, masterPersonnel).has(p.sfg_id.toLowerCase()))
      setPersonnel(scoped)
      await loadPolicies(scoped)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPolicies(personnel) {
    const sfgIds = personnel.map(p => p.sfg_id)
    if (!sfgIds.length) { setPolicies([]); return }
    const res = await fetch(`/api/policies?sfg_ids=${sfgIds.join(',')}`)
    if (!res.ok) throw new Error('Failed to load policies')
    const { policies: data } = await res.json()
    setPolicies(data ?? [])
  }

  // Reload used after adding/importing policies — full refresh of the master set
  function load(sfgId) {
    return initLoad(sfgId)
  }

  // ── Date boundaries (stable per render) ───────────────────────────────────
  const { monthStart, monthEnd, lmStart, lmEnd } = useMemo(() => {
    const now = new Date()
    const mS  = new Date(now.getFullYear(), now.getMonth(), 1)
    const mE  = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const lS  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return { monthStart: mS, monthEnd: mE, lmStart: lS, lmEnd: mS }
  }, [])

  // ── Unique option lists (carrier uses normalized names) ────────────────────
  const statusOptions = useMemo(() => {
    // Deduplicate by lowercase key so "pending" and "Pending" don't both appear
    const keys = new Set(policies.map(p => p.status?.trim().toLowerCase()).filter(Boolean))
    return [...keys].sort((a, b) => statusWeight(a) - statusWeight(b))
  }, [policies])

  const carrierOptions = useMemo(() => {
    const s = new Set(policies.map(p => normalizeCarrier(p.carrier)).filter(Boolean))
    return [...s].sort()
  }, [policies])

  const policyTypeOptions = useMemo(() => {
    const s = new Set(policies.map(p => p.policy_type).filter(Boolean))
    return [...s].sort()
  }, [policies])

  const agentOptions = useMemo(() => {
    const s = new Set(policies.map(p => p.agent).filter(Boolean))
    return [...s].sort()
  }, [policies])


  // ── Combined filter logic ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const customStart = dateStart ? new Date(dateStart) : null
    const customEnd   = dateEnd   ? new Date(dateEnd + 'T23:59:59') : null

    return policies.filter(p => {
      const s       = p.status?.trim().toLowerCase() ?? ''
      const isActive = ACTIVE_STATUSES.has(s)
      const isFinal  = FINAL_STATUSES.has(s)

      // ── Quick filter (date + status preset) ─────────────────────────────
      if (quickFilter === 'pending') {
        if (!isActive) return false

      } else if (quickFilter === 'this-month') {
        if (isActive) {
          // always include active items
        } else if (isFinal) {
          const lu = parseDate(p.last_update)
          if (!lu || lu < monthStart || lu >= monthEnd) return false
        } else {
          return false
        }

      } else if (quickFilter === 'last-month') {
        if (!isFinal) return false
        const lu = parseDate(p.last_update)
        if (!lu || lu < lmStart || lu >= lmEnd) return false

      } else if (quickFilter === 'all-time') {
        if (!isActive && !isFinal) return false
        // no date restriction on finalized items
      }
      // quickFilter === 'all': no restriction

      // ── Status dropdown ──────────────────────────────────────────────────
      if (statusFilter !== 'all' && s !== statusFilter) return false

      // ── Carrier dropdown (normalized) ────────────────────────────────────
      if (carrierFilter !== 'all' && normalizeCarrier(p.carrier) !== carrierFilter) return false

      // ── Agent dropdown ───────────────────────────────────────────────────
      if (agentFilter !== 'all' && p.agent?.toLowerCase() !== agentFilter) return false

      // ── Not in Opt toggle ────────────────────────────────────────────────
      if (notInOptOnly && !p.not_in_opt) return false

      // ── Search ───────────────────────────────────────────────────────────
      if (q && !p.applicant?.toLowerCase().includes(q) && !p.agent?.toLowerCase().includes(q) && !p.policy_no?.toLowerCase().includes(q)) return false

      // ── Custom date range ────────────────────────────────────────────────
      if (customStart || customEnd) {
        const d = parseDate(p[dateField])
        if (!d) return false
        if (customStart && d < customStart) return false
        if (customEnd   && d > customEnd)   return false
      }

      return true
    })
  }, [policies, quickFilter, notInOptOnly, search, statusFilter, carrierFilter, agentFilter,
      dateField, dateStart, dateEnd, monthStart, monthEnd, lmStart, lmEnd])

  // ── Sorted rows ───────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const cmp = (a, b) => {
      switch (sortBy) {
        case 'agent':       return (a.agent ?? '').localeCompare(b.agent ?? '')
        case 'issue_date':  return cmpDate(a.issue_date,  b.issue_date,  'desc')
        case 'last_update': return cmpDate(a.last_update, b.last_update, 'desc')
        case 'carrier':     return (normalizeCarrier(a.carrier) ?? '').localeCompare(normalizeCarrier(b.carrier) ?? '')
        case 'submit_date':
        default:            return cmpDate(a.submit_date, b.submit_date, 'desc')
      }
    }
    return [...filtered].sort(cmp)
  }, [filtered, sortBy])

  // Reset to page 1 whenever filter/sort results change
  useEffect(() => { setPage(1) }, [filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Summary stats — always mirror exactly what is currently displayed ──────
  const totalSubm = filtered.reduce((s, p) => s + (Number(p.subm_apv)  || 0), 0)
  const totalIss  = filtered.reduce((s, p) =>
    p.status?.toLowerCase() === 'issued' ? s + (Number(p.issued_apv) || 0) : s, 0)

  const hasCustomDate      = dateStart || dateEnd
  const hasSecondaryFilter = search || statusFilter !== 'all' || carrierFilter !== 'all' || agentFilter !== 'all' || hasCustomDate || notInOptOnly

  function clearAll() {
    setSearch(''); setStatusFilter('all'); setCarrierFilter('all')
    setAgentFilter('all'); setDateStart(''); setDateEnd(''); setNotInOptOnly(false)
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 space-y-4 animate-pulse">
        <div className="flex gap-2">{[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-white/10 rounded-full w-24" />)}</div>
        <div className="flex gap-3">{[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-gray-100 dark:bg-white/10 rounded-lg flex-1" />)}</div>
        <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/10 rounded-xl" />)}</div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </main>
  )

  if (error) return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <p className="text-sm text-accent/80">{error}</p>
      </div>
    </main>
  )

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">
      <section className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">Policies</h3>
          <div className="flex items-center gap-3">
            {isDirector && (
              <ScopeDropdown
                masterPersonnel={masterPersonnel}
                selfId={activeSubject?.sfg_id}
                value={selectedScope}
                onChange={handleScopeChange}
              />
            )}
            <button
              onClick={() => setQuickSearchOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-white/15 hover:border-gray-300 dark:hover:border-white/30 rounded-lg px-2.5 py-1 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              Quick Search
            </button>
            {isSuperAdmin && (
              <>
                <button
                  onClick={() => setShowBulkImport(true)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 font-semibold hover:bg-gray-100 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  ↑ Import CSV
                </button>
                <button
                  onClick={() => setShowAddPolicy(true)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10 transition-colors whitespace-nowrap"
                >
                  + Add Policy
                </button>
              </>
            )}
            <span className="text-xs text-gray-400 dark:text-white/30">{filtered.length.toLocaleString()} of {policies.length.toLocaleString()} records</span>
          </div>
        </div>

        {/* ── Quick filters ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-5">
          {QUICK_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setQuickFilter(id)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors whitespace-nowrap
                ${quickFilter === id
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50 border-gray-200 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              {label}
            </button>
          ))}
          <div className="w-px bg-gray-200 dark:bg-white/10 self-stretch mx-1" />
          <button
            onClick={() => setNotInOptOnly(v => !v)}
            className={`text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors whitespace-nowrap
              ${notInOptOnly
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-400/40'
                : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50 border-gray-200 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
              }`}
          >
            Not in Opt
          </button>
        </div>

        {/* ── Secondary filters ───────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-white/30 pointer-events-none"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search client, agent, or policy no…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 dark:bg-white/5 dark:border-white/15 dark:text-white dark:placeholder:text-white/25 text-sm rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-accent/60"
            />
          </div>

          {/* Status */}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-900 dark:bg-white/5 dark:border-white/15 dark:text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 cursor-pointer min-w-[140px]">
            <option value="all" style={optionStyle}>All Statuses</option>
            {statusOptions.map(s => (
              <option key={s} value={s} style={optionStyle}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          {/* Carrier (normalized) */}
          <select value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-900 dark:bg-white/5 dark:border-white/15 dark:text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 cursor-pointer min-w-[150px]">
            <option value="all" style={optionStyle}>All Carriers</option>
            {carrierOptions.map(c => (
              <option key={c} value={c} style={optionStyle}>{c}</option>
            ))}
          </select>

          {/* Agent */}
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-900 dark:bg-white/5 dark:border-white/15 dark:text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 cursor-pointer min-w-[140px]">
            <option value="all" style={optionStyle}>All Agents</option>
            {agentOptions.map(a => (
              <option key={a} value={a.toLowerCase()} style={optionStyle}>{a}</option>
            ))}
          </select>

          {/* Order By */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-900 dark:bg-white/5 dark:border-white/15 dark:text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 cursor-pointer min-w-[160px]">
            <option value="submit_date"  style={optionStyle}>↓ Submit Date</option>
            <option value="issue_date"   style={optionStyle}>↓ Issue Date</option>
            <option value="last_update"  style={optionStyle}>↓ Last Update</option>
            <option value="agent"        style={optionStyle}>Agent Name A–Z</option>
            <option value="carrier"      style={optionStyle}>Carrier A–Z</option>
          </select>
        </div>

        {/* ── Custom date range ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* Field toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/15">
            {[['submit_date', 'Submit Date'], ['issue_date', 'Issue Date']].map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setDateField(val)}
                className={`text-xs px-3 py-1.5 transition-colors
                  ${dateField === val
                    ? 'bg-gray-100 dark:bg-white/15 text-gray-900 dark:text-white font-medium'
                    : 'bg-transparent text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/70'
                  }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={dateStart}
            onChange={e => setDateStart(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/15 dark:text-white/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 dark:[color-scheme:dark]"
          />
          <span className="text-gray-400 dark:text-white/30 text-xs">to</span>
          <input
            type="date"
            value={dateEnd}
            onChange={e => setDateEnd(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/15 dark:text-white/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent/60 dark:[color-scheme:dark]"
          />

          {/* Clear all filters */}
          {hasSecondaryFilter && (
            <button
              onClick={clearAll}
              className="text-xs text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 whitespace-nowrap ml-1"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ── Summary stat chips ───────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatChip label="Records"       value={filtered.length.toLocaleString()} />
          <StatChip label="Submitted APV" value={fmtAmt(totalSubm)} />
          <StatChip label="Issued APV"    value={fmtAmt(totalIss)} />
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40 text-center py-8">No records match your filters.</p>
        ) : (
          <>
          <div className="overflow-x-auto -mx-1 mb-4">
            <table className="w-full text-sm min-w-[1060px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy', 'Status',
                    'APV', 'Submit Date', 'Issue Date', 'Last Update', 'Open Req'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {paginated.map((p, i) => (
                  <tr
                    key={i}
                    onClick={() => openFromTable(p)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
                  >
                    <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">{p.agent || '—'}</td>
                    <td className="py-2.5 pr-4 text-gray-700 dark:text-white/80 text-xs">
                      <span className="group-hover:text-accent transition-colors">{p.applicant || '—'}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{normalizeCarrier(p.carrier) || '—'}</td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-white/60 text-xs max-w-[140px] truncate">{p.policy_type || '—'}</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={p.status} /></td>
                    <td className="py-2.5 pr-4 text-gray-600 dark:text-white/60 text-xs tabular-nums whitespace-nowrap">{fmtAmt(p.issued_apv)}</td>
                    <td className="py-2.5 pr-4 text-gray-500 dark:text-white/50 text-xs whitespace-nowrap">{fmtDate(p.submit_date)}</td>
                    <td className="py-2.5 pr-4 text-gray-500 dark:text-white/50 text-xs whitespace-nowrap">{fmtDate(p.issue_date)}</td>
                    <td className="py-2.5 pr-4 text-gray-400 dark:text-white/40 text-xs whitespace-nowrap">{fmtDate(p.last_update)}</td>
                    <td className="py-2.5 text-gray-500 dark:text-white/50 text-xs max-w-[200px] truncate">{p.application_notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination controls ───────────────────────────────────────── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-gray-400 dark:text-white/40 tabular-nums">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, sorted.length).toLocaleString()} of {sorted.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-400 dark:text-white/40 px-2 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </section>

      {/* Quick Search */}
      {quickSearchOpen && (
        <QuickSearchModal
          policies={policies}
          query={quickSearchQuery}
          onQueryChange={setQuickSearchQuery}
          onSelect={openFromSearch}
          onClose={() => setQuickSearchOpen(false)}
          optionStyle={optionStyle}
        />
      )}

      {/* Detail Modal */}
      {selected && (
        <PolicyModalErrorBoundary onClose={closeDetail}>
          <PolicyModal
            policy={selected}
            personnel={personnel}
            onClose={closeDetail}
            onBack={selectedSource === 'search' ? closeDetail : null}
            canWrite={permissions?.appsAndPolicies?.write ?? false}
            onUpdate={updated => {
              setSelected(updated)
              setPolicies(prev => prev.map(p => p.id === updated.id ? updated : p))
            }}
            onDelete={id => setPolicies(prev => prev.filter(p => p.id !== id))}
            agentPhone={personnel.find(pers => pers.sfg_id === selected.sfg_id)?.phone}
            viewerSfgId={activeSubject?.sfg_id}
          />
        </PolicyModalErrorBoundary>
      )}

      {/* Add Policy Modal */}
      {showAddPolicy && (
        <AddPolicyModal
          personnel={personnel}
          existingCarriers={carrierOptions}
          existingPolicyTypes={policyTypeOptions}
          onClose={() => setShowAddPolicy(false)}
          onPolicyAdded={() => {
            setShowAddPolicy(false)
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id)
          }}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <BulkImportModal
          personnel={masterPersonnel}
          existingPolicies={policies}
          onClose={() => {
            setShowBulkImport(false)
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id)
          }}
        />
      )}
    </main>
  )
}

// ─── Stat Chip ─────────────────────────────────────────────────────────────────

function StatChip({ label, value }) {
  return (
    <div className="bg-gray-50 dark:bg-primary/60 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
    </div>
  )
}

// ─── Quick Search Modal ────────────────────────────────────────────────────────

function QuickSearchModal({ policies, query, onQueryChange, onSelect, onClose, optionStyle }) {
  const inputRef = useRef(null)

  // Auto-focus input on open
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return policies.filter(p => p.applicant?.toLowerCase().includes(q))
  }, [policies, query])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-white/10">
          <svg className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by client name…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/25 text-sm focus:outline-none"
          />
          {query && (
            <button onClick={() => onQueryChange('')} className="text-gray-400 dark:text-white/30 hover:text-gray-900 dark:hover:text-white transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[52vh] overflow-y-auto">
          {!query.trim() ? (
            <p className="text-sm text-gray-400 dark:text-white/25 text-center py-10">Start typing to search all policies</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-white/25 text-center py-10">No clients found for "{query}"</p>
          ) : (
            <ul>
              {results.map((p, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSelect(p)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0 group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-accent transition-colors truncate">
                        {p.applicant}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400 dark:text-white/40">{p.agent || '—'}</span>
                      <span className="text-gray-300 dark:text-white/20 text-xs">·</span>
                      <span className="text-xs text-gray-400 dark:text-white/40">{normalizeCarrier(p.carrier) || '—'}</span>
                      {p.submit_date && (
                        <>
                          <span className="text-gray-300 dark:text-white/20 text-xs">·</span>
                          <span className="text-xs text-gray-400 dark:text-white/30">Submitted {fmtDate(p.submit_date)}</span>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-200 dark:border-white/10 flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-white/25">{results.length} result{results.length !== 1 ? 's' : ''}</span>
            <span className="text-xs text-gray-400 dark:text-white/25">Esc to close</span>
          </div>
        )}
      </div>
    </div>
  )
}

