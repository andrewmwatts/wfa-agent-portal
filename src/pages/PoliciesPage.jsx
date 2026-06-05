import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import AddPolicyModal from '../components/AddPolicyModal'
import BulkImportModal from '../components/BulkImportModal'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../utils/agencyScope'

function isTruthy(val) {
  if (!val) return false
  return ['true', 'yes', 'y', 'x', '1'].includes(val.trim().toLowerCase())
}

// Parse a YYYY-MM-DD string as LOCAL midnight (avoids UTC-offset date shifting)
function parseDateLocal(str) {
  if (!str) return null
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function toInputDate(str) {
  if (!str) return ''
  // If already YYYY-MM-DD, return as-is — no parsing needed
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(str))) return String(str)
  const d = parseDateLocal(str)
  if (!d || isNaN(d)) return str
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}


// ─── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(['', 'pending', 'incomplete'])
const FINAL_STATUSES  = new Set(['issued', 'declined', 'not taken', 'withdrawn', 'cancelled', 'lapsed'])

// Carriers that share an identity — keyed by any variant, value = canonical display name
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

// ─── Chargeback-exempt auto-compute ──────────────────────────────────────────
// Carriers that have defined chargeback windows for Cancelled/Lapsed policies.
const CB_RULE_CARRIERS = new Set(['americo', 'banner', 'fidelity and guaranty', 'sbli'])

// "On Snapshot" conservation statuses → always not exempt (chargeback expected)
const CB_SNAPSHOT_STATUSES = new Set([
  'declined, on snapshot', 'not taken, on snapshot', 'withdrawn, on snapshot',
])

// Returns the difference in whole calendar months from fromIso to toIso (YYYY-MM-DD).
function monthsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const fm = String(fromIso).match(/^(\d{4})-(\d{2})/)
  const tm = String(toIso).match(/^(\d{4})-(\d{2})/)
  if (!fm || !tm) return null
  return (parseInt(tm[1]) - parseInt(fm[1])) * 12 + (parseInt(tm[2]) - parseInt(fm[2]))
}

// Returns true (exempt), false (not exempt), or null (cannot determine yet).
function computeChargebackExempt(conservation_status, conservation_date, issue_date, carrier) {
  if (!conservation_status?.trim()) return null
  const status  = conservation_status.trim().toLowerCase()
  const normCar = (normalizeCarrier(carrier ?? '') ?? '').toLowerCase()
  const inRuleSet = CB_RULE_CARRIERS.has(normCar)

  // On-Snapshot statuses → not exempt regardless of carrier
  if (CB_SNAPSHOT_STATUSES.has(status)) return false

  if (inRuleSet) {
    // Cancelled within 12 months of issue → not exempt (carrier charges back)
    if (status === 'cancelled') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo < 12) return false
    }
    // Lapsed (or Lapse Pending) more than 14 months after issue → not exempt (carrier charges back)
    if (status === 'lapsed' || status === 'lapse pending') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo > 14) return false
    }
  }

  return true  // all other cases → exempt
}

const STATUS_ORDER = ['incomplete', 'pending', 'issued', 'lapse pending',
                      'first premium not paid', 'declined', 'not taken',
                      'withdrawn', 'cancelled', 'lapsed']

function statusWeight(s) {
  const idx = STATUS_ORDER.indexOf(s?.toLowerCase())
  return idx === -1 ? 99 : idx
}

function parseDate(str) {
  return parseDateLocal(str)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—'
  const dt = parseDateLocal(d)
  return (!dt || isNaN(dt)) ? String(d) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmt(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  if (num === 0) return '$0'
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Compare two date strings; nulls sort to the end
function cmpDate(a, b, dir = 'desc') {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return dir === 'desc' ? db - da : da - db
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  if (!status) return <span className="text-gray-400 dark:text-white/30 text-xs">—</span>
  const s = status.toLowerCase()
  const cls =
    s === 'incomplete'             ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300' :
    s === 'issued'                 ? 'bg-green-500/20 text-green-600 dark:text-green-300' :
    s === 'lapse pending'          ? 'bg-red-500/20 text-red-500 dark:text-red-300' :
    s === 'first premium not paid' ? 'bg-red-500/20 text-red-500 dark:text-red-300' :
    s === 'declined'               ? 'bg-red-500/10 text-red-400 dark:text-red-400/80' :
    s === 'withdrawn'              ? 'bg-red-500/10 text-red-400 dark:text-red-400/80' :
    s === 'not taken'              ? 'bg-red-500/10 text-red-400 dark:text-red-400/80' :
    FINAL_STATUSES.has(s)         ? 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/30' :
                                    'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/60'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${cls}`}>{status}</span>
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

  // Reload used after adding/importing policies
  function load(sfgId, viewMode) {
    return handleModeChange(viewMode)
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
  }, [policies, quickFilter, search, statusFilter, carrierFilter, agentFilter,
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
  const hasSecondaryFilter = search || statusFilter !== 'all' || carrierFilter !== 'all' || agentFilter !== 'all' || hasCustomDate

  function clearAll() {
    setSearch(''); setStatusFilter('all'); setCarrierFilter('all')
    setAgentFilter('all'); setDateStart(''); setDateEnd('')
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
            onClose={closeDetail}
            onBack={selectedSource === 'search' ? closeDetail : null}
            canWrite={permissions?.appsAndPolicies?.write ?? false}
            onUpdate={updated => {
              setSelected(updated)
              setPolicies(prev => prev.map(p => p.id === updated.id ? updated : p))
            }}
            onDelete={id => setPolicies(prev => prev.filter(p => p.id !== id))}
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
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id, mode)
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
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id, mode)
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

// ─── Error boundary — prevents a bad policy record from crashing the page ─────

class PolicyModalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={this.props.onClose}>
          <div className="bg-gray-50 dark:bg-secondary border border-red-300 dark:border-red-700/50 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Could not display this policy</p>
            <p className="text-xs text-gray-500 dark:text-white/50">{String(this.state.error)}</p>
            <button onClick={this.props.onClose}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white/70 hover:bg-gray-300 dark:hover:bg-white/20 transition-colors">
              Close
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Policy Detail Modal ───────────────────────────────────────────────────────

const POLICY_COL_MAP = {
  applicant:           'applicant',
  carrier:             'carrier',
  policy_type:         'policy_name',
  policy_no:           'policy_number',
  status:              'status',
  subm_apv:            'submitted_apv',
  issued_apv:          'issued_apv',
  face_amt:            'face_amount',
  submit_date:         'submit_date',
  submit_week:         'submit_week',
  issue_date:          'issue_date',
  last_update:         'last_update',
  application_notes:   'application_notes',
  policy_notes:        'policy_notes',
  not_in_opt:          'not_in_opt',
  split_reset:         'split_reset',
  chargeback_exempt:   'chargeback_exempt',
  conservation_status: 'conservation_status',
  conservation_date:   'conservation_date',
  cb_month:            'snapshot_chargeback_month',
  cb_apv:              'snapshot_chargeback_apv',
}

// Fields that must be stored as numbers, not strings
const POLICY_NUMERIC_KEYS = new Set(['subm_apv', 'issued_apv', 'face_amt', 'cb_apv'])

const INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

const STATUS_OPTIONS = ['Pending', 'Incomplete', 'Issued', 'Declined', 'Withdrawn', 'Not taken']

const CONSERVATION_STATUS_OPTIONS = [
  'Cancelled',
  'Death',
  'Declined, On Snapshot',
  'First Premium Not Paid',
  'Lapse pending',
  'Lapsed',
  'Not Taken, On Snapshot',
  'Withdrawn, On Snapshot',
]

function PolicyModal({ policy: p, onClose, onBack, canWrite, onUpdate, onDelete }) {
  const [editing,         setEditing]         = useState(false)
  const [draft,           setDraft]           = useState(null)
  const [saving,          setSaving]          = useState(false)
  const [saveError,       setSaveError]       = useState(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [deleting,        setDeleting]        = useState(false)
  const [confirmNotInOpt, setConfirmNotInOpt] = useState(false)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
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

  // Like setField but also recomputes chargeback_exempt whenever conservation
  // status or date changes — result overwrites only if deterministic (non-null).
  function setConservationField(key, value) {
    setDraft(d => {
      const updated = { ...d, [key]: value }
      const exempt = computeChargebackExempt(
        updated.conservation_status,
        updated.conservation_date,
        updated.issue_date,
        updated.carrier,
      )
      if (exempt !== null) updated.chargeback_exempt = exempt
      return updated
    })
  }

  const NOT_IN_OPT_DELETE_STATUSES = ['declined', 'withdrawn', 'not taken']

  function handleSave() {
    if (!draft) return
    const s = draft.status?.toLowerCase()
    if (draft.not_in_opt && NOT_IN_OPT_DELETE_STATUSES.includes(s)) {
      setConfirmNotInOpt(true)
      return
    }
    doSave()
  }

  async function doSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      // When transitioning to Issued: clear open requirements and stamp issue date as last update
      const becomingIssued = draft.status?.toLowerCase() === 'issued' && p.status?.toLowerCase() !== 'issued'
      const effectiveDraft = becomingIssued
        ? { ...draft, application_notes: '', last_update: draft.issue_date || new Date().toISOString().slice(0, 10) }
        : draft

      // Coerce numeric fields so local state and the API payload both stay typed correctly
      const typedDraft = { ...effectiveDraft }
      for (const key of POLICY_NUMERIC_KEYS) {
        const v = typedDraft[key]
        typedDraft[key] = (v === '' || v === null || v === undefined) ? null : Number(v) || 0
      }

      const updates = {}
      for (const [key, col] of Object.entries(POLICY_COL_MAP)) {
        const v = typedDraft[key]
        updates[col] = POLICY_NUMERIC_KEYS.has(key) ? v : String(v ?? '')
      }
      // chargeback_exempt is nullable — omit it entirely if never computed
      // so we don't accidentally overwrite a null DB value with false
      if (typedDraft.chargeback_exempt === null || typedDraft.chargeback_exempt === undefined) {
        delete updates['chargeback_exempt']
      }
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, updates }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      onUpdate?.(typedDraft)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch('/api/policies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Delete failed')
      }
      onDelete?.(p.id)
      onClose()
    } catch (e) {
      setSaveError(e.message)
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const display = editing ? draft : p

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex-1 min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-xs text-gray-400 dark:text-white/40 hover:text-accent transition-colors mb-2"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to search
              </button>
            )}
            <h2 className="text-base font-bold text-gray-900 dark:text-white">{display.applicant || 'Unnamed Client'}</h2>
            <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">
              {display.policy_type || 'Policy'} · {normalizeCarrier(display.carrier) || '—'}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            {!editing && <StatusBadge status={display.status} />}
            {canWrite && !editing && (
              <button
                onClick={startEdit}
                className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
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
            <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300">
            {saveError}
          </div>
        )}

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-lg flex items-center justify-between gap-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Permanently delete this policy? This cannot be undone.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        {confirmNotInOpt && (
          <div className="mx-6 mt-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              This policy is not in Opt. Would you like to delete it?
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => { setConfirmNotInOpt(false); doSave() }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                No, keep it
              </button>
              <button
                onClick={() => { setConfirmNotInOpt(false); handleDelete() }}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="p-6 space-y-6">

          <ModalSection title="Application">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <EditField label="Agent" value={draft.agent} onChange={v => setField('agent', v)} />
                <EditField label="Client" value={draft.applicant} onChange={v => setField('applicant', v)} />
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Status</p>
                  <select
                    value={draft.status ?? ''}
                    onChange={e => setField('status', e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">— select —</option>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <EditField label="Submit Date" value={toInputDate(draft.submit_date)} onChange={v => setField('submit_date', v)} type="date" />
                <EditField label="Issue Date" value={toInputDate(draft.issue_date)} onChange={v => setField('issue_date', v)} type="date" />
                <EditField label="Last Update" value={toInputDate(draft.last_update)} onChange={v => setField('last_update', v)} type="date" />
              </div>
            ) : (
              <DetailGrid>
                <DetailItem label="Agent"       value={display.agent} />
                <DetailItem label="Client"      value={display.applicant} />
                <DetailItem label="Submit Date" value={fmtDate(display.submit_date)} />
                <DetailItem label="Issue Date"  value={fmtDate(display.issue_date)} />
                <DetailItem label="Last Update" value={fmtDate(display.last_update)} />
              </DetailGrid>
            )}
          </ModalSection>

          <ModalSection title="Policy Details">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <EditField label="Carrier" value={draft.carrier} onChange={v => setField('carrier', v)} />
                <EditField label="Policy Type" value={draft.policy_type} onChange={v => setField('policy_type', v)} />
                <EditField label="Policy No." value={draft.policy_no} onChange={v => setField('policy_no', v)} />
                <EditField label="Face Amount" value={draft.face_amt} onChange={v => setField('face_amt', v)} />
              </div>
            ) : (
              <DetailGrid>
                <DetailItem label="Carrier"     value={normalizeCarrier(display.carrier)} />
                <DetailItem label="Raw Carrier" value={normalizeCarrier(display.carrier) !== display.carrier ? display.carrier : null} />
                <DetailItem label="Policy Type" value={display.policy_type} />
                <DetailItem label="Policy No."  value={display.policy_no} />
                <DetailItem label="Face Amount" value={display.face_amt
                  ? '$' + Number(display.face_amt.toString().replace(/[$,]/g, '')).toLocaleString()
                  : '—'} />
              </DetailGrid>
            )}
          </ModalSection>

          <ModalSection title="Financials">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <EditField label="Submitted APV" value={draft.subm_apv ?? ''} onChange={v => setField('subm_apv', v)} type="number" />
                <EditField label="Issued APV" value={draft.issued_apv ?? ''} onChange={v => setField('issued_apv', v)} type="number" />
              </div>
            ) : (
              <DetailGrid>
                <DetailItem label="Submitted APV" value={fmtAmt(display.subm_apv)} accent />
                <DetailItem label="Issued APV"    value={fmtAmt(display.issued_apv)} accent />
              </DetailGrid>
            )}
          </ModalSection>

          <ModalSection title="Flags">
            {editing ? (
              <div className="flex gap-6">
                <CheckEditField label="Not in Opt"   checked={isTruthy(String(draft.not_in_opt ?? ''))} onChange={v => setField('not_in_opt', v ? 'TRUE' : '')} />
                <CheckEditField label="Split / Reset" checked={isTruthy(String(draft.split_reset ?? ''))} onChange={v => setField('split_reset', v ? 'TRUE' : '')} />
              </div>
            ) : (
              <div className="flex gap-6">
                <CheckItem label="Not in Opt"   value={display.not_in_opt} />
                <CheckItem label="Split / Reset" value={display.split_reset} />
              </div>
            )}
          </ModalSection>

          <ModalSection title="Open Requirements">
            {editing ? (
              <div>
                <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Application Notes</p>
                <textarea
                  value={draft.application_notes ?? ''}
                  onChange={e => setField('application_notes', e.target.value)}
                  rows={3}
                  className={INPUT_CLS + ' resize-y'}
                />
              </div>
            ) : display.application_notes ? (
              <p className="text-sm text-amber-300/90 leading-relaxed">{display.application_notes}</p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-white/30">—</p>
            )}
          </ModalSection>

          <ModalSection title="Policy Notes">
            {editing ? (
              <div>
                <textarea
                  value={draft.policy_notes ?? ''}
                  onChange={e => setField('policy_notes', e.target.value)}
                  rows={3}
                  className={INPUT_CLS + ' resize-y'}
                />
              </div>
            ) : display.policy_notes ? (
              <p className="text-sm text-gray-700 dark:text-white/80 leading-relaxed">{display.policy_notes}</p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-white/30">—</p>
            )}
          </ModalSection>

          <ModalSection title="Conservation">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Conservation Status</p>
                  <select
                    value={draft.conservation_status ?? ''}
                    onChange={e => setConservationField('conservation_status', e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">—</option>
                    {CONSERVATION_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <EditField label="Expected Date" value={toInputDate(draft.conservation_date)} onChange={v => setConservationField('conservation_date', v)} type="date" />
                <EditField label="Snapshot Chargeback Month" value={draft.cb_month ?? ''} onChange={v => setField('cb_month', v)} />
                <EditField label="Snapshot Chargeback APV" value={draft.cb_apv ?? ''} onChange={v => setField('cb_apv', v)} />
                <div className="col-span-2 pt-1">
                  <CheckEditField
                    label="Chargeback Exempt"
                    checked={draft.chargeback_exempt === true}
                    onChange={v => setField('chargeback_exempt', v)}
                  />
                </div>
              </div>
            ) : (display.conservation_status || display.conservation_date || display.cb_month || display.cb_apv || display.chargeback_exempt != null) ? (
              <DetailGrid>
                <DetailItem label="Status"        value={display.conservation_status} />
                <DetailItem label="Expected Date" value={fmtDate(display.conservation_date)} />
                <DetailItem label="Snapshot Chargeback Month" value={display.cb_month} />
                <DetailItem label="Snapshot Chargeback APV"   value={display.cb_apv} />
                {display.chargeback_exempt != null && (
                  <CheckItem label="Chargeback Exempt" value={String(display.chargeback_exempt)} />
                )}
              </DetailGrid>
            ) : (
              <p className="text-sm text-gray-400 dark:text-white/30">—</p>
            )}
          </ModalSection>

        </div>
      </div>
    </div>
  )
}

function EditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={INPUT_CLS + (type === 'date' ? ' dark:[color-scheme:dark]' : '')}
      />
    </div>
  )
}

function CheckEditField({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent rounded cursor-pointer"
      />
      <span className="text-sm text-gray-700 dark:text-white/80">{label}</span>
    </label>
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

// ─── Modal sub-components ──────────────────────────────────────────────────────

function ModalSection({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30 mb-3">{title}</p>
      {children}
    </div>
  )
}

function DetailGrid({ children }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-3">{children}</div>
}

function DetailItem({ label, value, accent }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${accent ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-white/80'}`}>{value}</p>
    </div>
  )
}

function CheckItem({ label, value }) {
  // Coerce to string first — DB may return boolean true/false instead of 'TRUE'/'FALSE'
  const str     = value == null ? '' : String(value)
  const checked = !!str && !['false', '0', 'no', 'n', ''].includes(str.trim().toLowerCase())
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
        ${checked ? 'bg-accent/20 border-accent/50' : 'bg-gray-50 dark:bg-white/5 border-gray-300 dark:border-white/20'}`}>
        {checked && (
          <svg className="w-2.5 h-2.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className={`text-sm ${checked ? 'text-gray-700 dark:text-white/80' : 'text-gray-400 dark:text-white/35'}`}>{label}</span>
    </div>
  )
}
