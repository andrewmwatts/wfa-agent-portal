import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import PolicyModal, { PolicyModalErrorBoundary, StatusBadge } from '../components/PolicyEditModal'
import BulkImportModal from '../components/BulkImportModal'
import ScopeDropdown from '../components/ScopeDropdown'
import FilterSheet, { SheetField, SHEET_INPUT } from '../components/ui/FilterSheet'
import MoreMenu from '../components/ui/MoreMenu'
import { getBaseshopIds } from '../../shared/agencyScope'
import { parseDateLocal, fmtDate, fmtDateShort, fmtCurrency as fmtAmt } from '../utils/format'
import { normalizeCarrier } from '../../shared/carriers'
import { ACTIVE_STATUSES, FINAL_STATUSES, statusWeight } from '../utils/status'
import { matchesPolicy } from '../utils/policySearch'

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

const SORT_OPTIONS = [
  ['submit_date', '↓ Submit Date'],
  ['issue_date',  '↓ Issue Date'],
  ['last_update', '↓ Last Update'],
  ['agent',       'Agent Name A–Z'],
  ['carrier',     'Carrier A–Z'],
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
  const [filtersOpen,     setFiltersOpen]     = useState(false) // phone Filters sheet

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
  const [sortBy, setSortBy] = useState('agent')

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

  // Includes split partners so an agent who only holds a secondary share on a
  // policy is still selectable — the table shows the primary in the Agent column,
  // but filtering has to reach both sides of a split.
  const agentOptions = useMemo(() => {
    const s = new Set(policies.map(p => p.agent).filter(Boolean))
    for (const p of policies) for (const sp of p.splits ?? []) if (sp.agent) s.add(sp.agent)
    return [...s].sort()
  }, [policies])

  // Every name credited on a policy, lowercased — primary plus any split partners.
  function creditedNames(p) {
    const names = [p.agent]
    for (const s of p.splits ?? []) names.push(s.agent)
    return names.filter(Boolean).map(n => n.toLowerCase())
  }


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

      // ── Agent dropdown (matches primary or split partner) ────────────────
      if (agentFilter !== 'all' && !creditedNames(p).includes(agentFilter)) return false

      // ── Not in Opt toggle ────────────────────────────────────────────────
      if (notInOptOnly && !p.not_in_opt) return false

      // ── Search (agent match also covers split partners) ──────────────────
      if (q && !matchesPolicy(p, q) && !creditedNames(p).some(n => n.includes(q))) return false

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

  // Phone "Filters (n)" badge — the controls that live inside the sheet.
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (carrierFilter !== 'all' ? 1 : 0) +
    (agentFilter !== 'all' ? 1 : 0) + (hasCustomDate ? 1 : 0)

  function clearAll() {
    setSearch(''); setStatusFilter('all'); setCarrierFilter('all')
    setAgentFilter('all'); setDateStart(''); setDateEnd(''); setNotInOptOnly(false)
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 space-y-4 animate-pulse">
        <div className="flex gap-2">{[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-white/10 rounded-full w-24" />)}</div>
        <div className="flex gap-3">{[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-gray-100 dark:bg-white/10 rounded-lg flex-1" />)}</div>
        <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-white/10 rounded-xl" />)}</div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </main>
  )

  if (error) return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <p className="text-sm text-accent/80">{error}</p>
      </div>
    </main>
  )

  const sortLabel = SORT_OPTIONS.find(([v]) => v === sortBy)?.[1] ?? 'Submit date'
  const pageStart = (page - 1) * PAGE_SIZE + 1
  const pageEnd   = Math.min(page * PAGE_SIZE, sorted.length)

  // Chips under the phone search row — one per active sheet filter.
  const activeChips = [
    statusFilter !== 'all' && {
      key: 'status',
      label: `Status: ${statusFilter ? statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1) : 'None'}`,
      clear: () => setStatusFilter('all'),
    },
    carrierFilter !== 'all' && { key: 'carrier', label: `Carrier: ${carrierFilter}`, clear: () => setCarrierFilter('all') },
    agentFilter !== 'all' && {
      key: 'agent',
      label: `Agent: ${agentOptions.find(a => a.toLowerCase() === agentFilter) ?? agentFilter}`,
      clear: () => setAgentFilter('all'),
    },
    hasCustomDate && {
      key: 'date',
      label: `${dateField === 'issue_date' ? 'Issued' : 'Submitted'}: ${dateStart ? fmtDateShort(dateStart) : '…'} – ${dateEnd ? fmtDateShort(dateEnd) : '…'}`,
      clear: () => { setDateStart(''); setDateEnd('') },
    },
  ].filter(Boolean)

  function resetSheetFilters() {
    setStatusFilter('all'); setCarrierFilter('all'); setAgentFilter('all')
    setDateStart(''); setDateEnd('')
  }

  const chipBase = 'shrink-0 text-sm md:text-xs font-semibold px-4 h-11 md:h-auto md:py-1.5 touch:md:min-h-[44px] inline-flex items-center rounded-full border transition-colors whitespace-nowrap'
  const chipOff  = 'bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-white/70 border-gray-200 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
  const ctlBase  = 'bg-gray-50 border border-gray-200 text-gray-900 dark:bg-white/5 dark:border-white/15 dark:text-white text-sm rounded-lg px-3 py-2 touch:min-h-[44px] focus:outline-none focus:border-accent/60 cursor-pointer'

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-5">
      <section className="md:bg-white md:dark:bg-primary/30 md:border md:border-gray-200 md:dark:border-white/10 md:rounded-2xl md:p-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 md:gap-3 mb-3 md:mb-5">
          <h3 className="flex-1 min-w-0 truncate text-[22px] font-bold text-gray-900 dark:text-white md:flex-none md:text-sm md:font-semibold md:uppercase md:tracking-widest md:text-gray-500 md:dark:text-white/50">Policies</h3>
          <div className="md:flex-1" />
          {isDirector && (
            <ScopeDropdown
              masterPersonnel={masterPersonnel}
              selfId={activeSubject?.sfg_id}
              value={selectedScope}
              onChange={handleScopeChange}
            />
          )}
          {/* Phone: icon-only search + overflow menu */}
          <button
            type="button"
            onClick={() => setQuickSearchOpen(true)}
            aria-label="Quick search"
            className="md:hidden w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/20 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </button>
          <MoreMenu
            className="md:hidden shrink-0"
            items={[
              { label: '↑ Import CSV', onClick: () => setShowBulkImport(true), hidden: !isSuperAdmin },
              { label: '+ Add Policy', onClick: () => setShowAddPolicy(true),   hidden: !isSuperAdmin },
            ]}
          />
          {/* Tablet / desktop: the original labelled buttons */}
          <button
            onClick={() => setQuickSearchOpen(true)}
            className="hidden md:flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-white/15 hover:border-gray-300 dark:hover:border-white/30 rounded-lg px-2.5 py-1 touch:min-h-[44px] touch:px-3.5 transition-colors"
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
                className="hidden md:block text-xs px-3 py-1.5 touch:min-h-[44px] rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 font-semibold hover:bg-gray-100 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                ↑ Import CSV
              </button>
              <button
                onClick={() => setShowAddPolicy(true)}
                className="hidden md:block text-xs px-3 py-1.5 touch:min-h-[44px] rounded-lg border border-accent text-gray-900 dark:text-white font-semibold hover:bg-accent/10 transition-colors whitespace-nowrap"
              >
                + Add Policy
              </button>
            </>
          )}
          <span className="hidden md:inline text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">{filtered.length.toLocaleString()} of {policies.length.toLocaleString()} records</span>
        </div>

        {/* ── Quick filters (scroll sideways on phones) ───────────────────── */}
        <div className="flex gap-2 mb-3 md:mb-5 overflow-x-auto md:overflow-visible md:flex-wrap -mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setQuickFilter(id)}
              aria-pressed={quickFilter === id}
              className={`${chipBase} ${quickFilter === id
                ? 'bg-accent/20 text-gray-900 dark:text-white border-accent'
                : chipOff}`}
            >
              {label}
            </button>
          ))}
          <div className="w-px bg-gray-200 dark:bg-white/15 self-stretch my-1.5 mx-0.5 shrink-0" />
          <button
            onClick={() => setNotInOptOnly(v => !v)}
            aria-pressed={notInOptOnly}
            className={`${chipBase} ${notInOptOnly
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/60'
              : chipOff}`}
          >
            Not in Opt
          </button>
        </div>

        {/* ── Phone: search + Filters button, active chips ────────────────── */}
        <div className="md:hidden">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400 dark:text-white/50 pointer-events-none"
                   fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="search"
                enterKeyHint="search"
                aria-label="Search policies"
                placeholder="Client, agent, policy no."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full h-12 bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/20 dark:text-white dark:placeholder:text-white/50 text-base rounded-xl pl-10 pr-3 focus:outline-none focus:border-accent"
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
              className="h-12 shrink-0 flex items-center gap-2 px-3.5 rounded-xl border border-gray-300 dark:border-white/30 text-gray-900 dark:text-white text-[15px] font-semibold hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-white dark:bg-white dark:text-primary text-xs font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {activeChips.length > 0 && (
            <div className="flex items-center gap-2 mt-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4">
              {activeChips.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  aria-label={`Remove filter ${c.label}`}
                  className="shrink-0 h-10 pl-3.5 pr-2.5 inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/15 text-[13px] font-medium text-gray-800 dark:text-white whitespace-nowrap"
                >
                  {c.label}
                  <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-white/15 flex items-center justify-center" aria-hidden="true">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={resetSheetFilters}
                className="shrink-0 h-10 px-2 text-[13px] font-semibold text-gray-700 dark:text-white/80 underline underline-offset-4"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* ── Tablet / desktop: inline filter controls ─────────────────────
            Below xl the Sort select drops to the date-range row (two rows
            instead of three on an iPad); at xl it sits with the other selects. */}
        <div className="hidden md:flex flex-wrap items-center gap-3 mb-5">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-white/30 pointer-events-none"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search client, agent, policy…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/15 dark:text-white dark:placeholder:text-white/40 text-sm rounded-lg pl-8 pr-3 py-2 touch:min-h-[44px] focus:outline-none focus:border-accent/60"
            />
          </div>

          {/* Status */}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Status"
            className={`${ctlBase} min-w-[140px]`}>
            <option value="all" style={optionStyle}>All Statuses</option>
            <option value="" style={optionStyle}>— None —</option>
            {statusOptions.map(s => (
              <option key={s} value={s} style={optionStyle}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          {/* Carrier (normalized) */}
          <select value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)} aria-label="Carrier"
            className={`${ctlBase} min-w-[150px]`}>
            <option value="all" style={optionStyle}>All Carriers</option>
            {carrierOptions.map(c => (
              <option key={c} value={c} style={optionStyle}>{c}</option>
            ))}
          </select>

          {/* Agent */}
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} aria-label="Agent"
            className={`${ctlBase} min-w-[140px]`}>
            <option value="all" style={optionStyle}>All Agents</option>
            {agentOptions.map(a => (
              <option key={a} value={a.toLowerCase()} style={optionStyle}>{a}</option>
            ))}
          </select>

          {/* Row break below xl; Sort + date range live on the second row */}
          <div className="basis-full h-0 xl:hidden" />

          {/* Order By */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Order by"
            className={`${ctlBase} min-w-[160px] order-3 ml-auto xl:order-none xl:ml-0`}>
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v} style={optionStyle}>{l}</option>)}
          </select>

          {/* Custom date range — on its own row at xl, inline on the second row below */}
          <div className="order-2 xl:order-none xl:basis-full flex flex-wrap items-center gap-3">
            {/* Field toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/15">
              {[['submit_date', 'Submit Date'], ['issue_date', 'Issue Date']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setDateField(val)}
                  className={`text-xs px-3 py-1.5 touch:min-h-[44px] transition-colors
                    ${dateField === val
                      ? 'bg-gray-100 dark:bg-white/15 text-gray-900 dark:text-white font-medium'
                      : 'bg-transparent text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'
                    }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <input
              type="date"
              aria-label="From date"
              value={dateStart}
              onChange={e => setDateStart(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/15 dark:text-white/80 text-xs rounded-lg px-3 py-1.5 touch:min-h-[44px] focus:outline-none focus:border-accent/60 dark:[color-scheme:dark]"
            />
            <span className="text-gray-500 dark:text-white/40 text-xs">to</span>
            <input
              type="date"
              aria-label="To date"
              value={dateEnd}
              onChange={e => setDateEnd(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/15 dark:text-white/80 text-xs rounded-lg px-3 py-1.5 touch:min-h-[44px] focus:outline-none focus:border-accent/60 dark:[color-scheme:dark]"
            />

            {/* Clear all filters */}
            {hasSecondaryFilter && (
              <button
                onClick={clearAll}
                className="text-xs text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-1.5 touch:min-h-[44px] rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* ── Summary: one strip on phones, three cards from md up ────────── */}
        <div className="md:hidden grid grid-cols-3 mb-1 bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl py-3 mt-3">
          {[
            ['Records',   filtered.length.toLocaleString()],
            ['Submitted', fmtAmt(totalSubm)],
            ['Issued',    fmtAmt(totalIss)],
          ].map(([label, value]) => (
            <div key={label} className="px-3 min-w-0 border-l border-gray-200 dark:border-white/10 first:border-l-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-white/60">{label}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums truncate">{value}</p>
            </div>
          ))}
        </div>
        <div className="hidden md:grid grid-cols-3 gap-3 mb-5">
          <StatChip label="Records"       value={filtered.length.toLocaleString()} />
          <StatChip label="Submitted APV" value={fmtAmt(totalSubm)} />
          <StatChip label="Issued APV"    value={fmtAmt(totalIss)} />
        </div>

        {/* ── Results ─────────────────────────────────────────────────────── */}
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-white/50 text-center py-10 md:py-8">No records match your filters.</p>
        ) : (
          <>
          {/* Phone list header: range + sort */}
          <div className="md:hidden flex items-center justify-between h-11 mt-1 text-[13px] text-gray-600 dark:text-white/70">
            <span className="tabular-nums">{pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {sorted.length.toLocaleString()}</span>
            <label className="relative inline-flex items-center gap-1 h-11 pl-2 text-gray-900 dark:text-white font-semibold">
              {sortLabel.replace(/^↓ /, '')}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              {/* Native picker lives invisibly on top, so iOS shows its own wheel */}
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                aria-label="Sort policies"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v} style={optionStyle}>{l}</option>)}
              </select>
            </label>
          </div>

          {/* Phone: cards */}
          <ul className="md:hidden space-y-2.5 mb-4">
            {paginated.map(p => (
              <li key={p.id ?? `${p.sfg_id}-${p.policy_no}-${p.applicant}`}>
                <button
                  type="button"
                  onClick={() => openFromTable(p)}
                  className="w-full text-left bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl px-4 pt-3 pb-3 active:bg-gray-50 dark:active:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-gray-900 dark:text-white truncate">{p.applicant || '—'}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-sm text-gray-600 dark:text-white/70 mt-0.5 truncate">
                    {normalizeCarrier(p.carrier) || '—'}{p.policy_type ? ` · ${p.policy_type}` : ''}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-1.5">
                    <span className="text-sm text-gray-800 dark:text-white/85 truncate min-w-0">
                      {p.agent || '—'}
                      {p.splits?.length > 0 && <SplitPill splits={p.splits} />}
                    </span>
                    <span className="text-base font-bold text-gray-900 dark:text-white tabular-nums shrink-0">{fmtAmt(p.issued_apv)}</span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-gray-500 dark:text-white/60">
                    Submitted {fmtDateShort(p.submit_date)}{p.issue_date ? ` · Issued ${fmtDateShort(p.issue_date)}` : ''}
                  </div>
                  {p.application_notes && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/10 text-[13px] text-gray-700 dark:text-white/75 truncate">
                      <span className="font-semibold text-gray-900 dark:text-white">Open req:</span> {p.application_notes}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Tablet: compact six-column table */}
          <div className="hidden md:block xl:hidden overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {[['Client', ''], ['Carrier', ''], ['Status', ''], ['APV', 'text-right'], ['Submitted', ''], ['Issued', '']].map(([h, extra]) => (
                    <th key={h} className={`text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 pb-2.5 pr-3 last:pr-0 whitespace-nowrap ${extra}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {paginated.map(p => (
                  <tr
                    key={p.id ?? `${p.sfg_id}-${p.policy_no}-${p.applicant}`}
                    onClick={() => openFromTable(p)}
                    onKeyDown={e => { if (e.key === 'Enter') openFromTable(p) }}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 focus:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-white/5 transition-colors"
                  >
                    <td className="py-2.5 pr-3 align-top max-w-[220px]">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.applicant || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-white/60 truncate">
                        {p.agent || '—'}
                        {p.splits?.length > 0 && <SplitPill splits={p.splits} />}
                      </div>
                      {p.application_notes && (
                        <div className="text-xs text-gray-700 dark:text-white/75 truncate"><span className="font-semibold">Open req:</span> {p.application_notes}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 align-top max-w-[170px]">
                      <div className="text-sm text-gray-800 dark:text-white/85 truncate">{normalizeCarrier(p.carrier) || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-white/60 truncate">{p.policy_type || '—'}</div>
                    </td>
                    <td className="py-2.5 pr-3 align-top"><StatusBadge status={p.status} /></td>
                    <td className="py-2.5 pr-3 align-top text-right text-sm font-semibold text-gray-900 dark:text-white tabular-nums whitespace-nowrap">{fmtAmt(p.issued_apv)}</td>
                    <td className="py-2.5 pr-3 align-top text-xs text-gray-600 dark:text-white/70 whitespace-nowrap">{fmtDateShort(p.submit_date)}</td>
                    <td className="py-2.5 align-top text-xs text-gray-600 dark:text-white/70 whitespace-nowrap">{fmtDateShort(p.issue_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Desktop: full table */}
          <div className="hidden xl:block overflow-x-auto -mx-1 mb-4">
            <table className="w-full text-sm min-w-[1060px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy', 'Status',
                    'APV', 'Submit Date', 'Issue Date', 'Last Update', 'Open Req'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
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
                    <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">
                      {p.agent || '—'}
                      {p.splits?.length > 0 && <SplitPill splits={p.splits} />}
                    </td>
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
              <span className="hidden md:inline text-xs text-gray-500 dark:text-white/50 tabular-nums">
                {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {sorted.length.toLocaleString()}
              </span>
              <div className="flex items-center gap-1 w-full md:w-auto justify-between md:justify-start">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-sm md:text-xs font-medium px-4 md:px-3 h-11 md:h-auto md:py-1.5 touch:md:min-h-[44px] rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <span className="text-sm md:text-xs text-gray-500 dark:text-white/50 px-2 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="text-sm md:text-xs font-medium px-4 md:px-3 h-11 md:h-auto md:py-1.5 touch:md:min-h-[44px] rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </section>

      {/* Phone filters sheet */}
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onReset={resetSheetFilters}
        applyLabel={`Show ${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'policy' : 'policies'}`}
      >
        <SheetField label="Status">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={SHEET_INPUT}>
            <option value="all" style={optionStyle}>All Statuses</option>
            <option value="" style={optionStyle}>— None —</option>
            {statusOptions.map(s => (
              <option key={s} value={s} style={optionStyle}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </SheetField>
        <SheetField label="Carrier">
          <select value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)} className={SHEET_INPUT}>
            <option value="all" style={optionStyle}>All Carriers</option>
            {carrierOptions.map(c => <option key={c} value={c} style={optionStyle}>{c}</option>)}
          </select>
        </SheetField>
        <SheetField label="Agent">
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className={SHEET_INPUT}>
            <option value="all" style={optionStyle}>All Agents</option>
            {agentOptions.map(a => <option key={a} value={a.toLowerCase()} style={optionStyle}>{a}</option>)}
          </select>
        </SheetField>
        <SheetField label="Sort by">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={SHEET_INPUT}>
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v} style={optionStyle}>{l}</option>)}
          </select>
        </SheetField>

        <div className="mb-2">
          <span className="block mb-1.5 text-[11.5px] font-semibold uppercase tracking-widest text-gray-500 dark:text-white/60">Date range</span>
          <div className="flex rounded-xl overflow-hidden border border-gray-300 dark:border-white/20 mb-3" role="group" aria-label="Date field">
            {[['submit_date', 'Submit date'], ['issue_date', 'Issue date']].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDateField(val)}
                aria-pressed={dateField === val}
                className={`flex-1 h-11 text-sm font-semibold transition-colors
                  ${dateField === val
                    ? 'bg-accent/20 text-gray-900 dark:text-white shadow-[inset_0_-3px_0_0_rgb(var(--color-accent))]'
                    : 'bg-transparent text-gray-600 dark:text-white/70'}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block mb-1 text-xs text-gray-500 dark:text-white/60">From</span>
              <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className={`${SHEET_INPUT} dark:[color-scheme:dark]`} />
            </label>
            <label className="block">
              <span className="block mb-1 text-xs text-gray-500 dark:text-white/60">To</span>
              <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className={`${SHEET_INPUT} dark:[color-scheme:dark]`} />
            </label>
          </div>
        </div>
      </FilterSheet>

      {/* Quick Search */}
      {quickSearchOpen && (
        <QuickSearchModal
          policies={policies}
          query={quickSearchQuery}
          onQueryChange={setQuickSearchQuery}
          onSelect={openFromSearch}
          onClose={() => { setQuickSearchOpen(false); setQuickSearchQuery('') }}
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
            allowSplit
            onSplitComplete={() => {
              closeDetail()
              if (activeSubject?.sfg_id) load(activeSubject.sfg_id)
            }}
          />
        </PolicyModalErrorBoundary>
      )}

      {/* Add Policy Modal */}
      {showAddPolicy && (
        <PolicyModal
          mode="create"
          personnel={personnel}
          existingCarriers={carrierOptions}
          existingPolicyTypes={policyTypeOptions}
          canWrite
          onClose={() => setShowAddPolicy(false)}
          onCreate={() => {
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

// ─── Split pill ────────────────────────────────────────────────────────────────

function SplitPill({ splits }) {
  return (
    <span
      title={splits.map(s => `${s.agent || s.sfg_id}: ${Math.round(s.credit_pct * 1000) / 10}%`).join(' · ')}
      className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold leading-none border border-accent/70 bg-accent/15 text-gray-800 dark:text-white align-middle"
    >
      Split
    </span>
  )
}

// ─── Stat Chip ─────────────────────────────────────────────────────────────────

function StatChip({ label, value }) {
  return (
    <div className="bg-gray-50 dark:bg-primary/60 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 mb-1">{label}</p>
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
    return policies.filter(p => matchesPolicy(p, q))
  }, [policies, query])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center sm:pt-[12vh] sm:px-4 bg-black/60 backdrop-blur-sm !mt-0"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary sm:border border-gray-200 dark:border-white/15 sm:rounded-2xl shadow-2xl w-full sm:max-w-xl overflow-hidden max-sm:h-dvh max-sm:flex max-sm:flex-col">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-200 dark:border-white/10">
          <svg className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by client name or policy number…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/40 text-sm max-sm:h-11 focus:outline-none"
          />
          {query && (
            <button onClick={() => onQueryChange('')} aria-label="Clear search" className="text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white transition-colors max-sm:w-11 max-sm:h-11 max-sm:-mr-2 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="sm:hidden h-11 px-1 text-sm font-semibold text-gray-800 dark:text-white">Cancel</button>
        </div>

        {/* Results */}
        <div className="sm:max-h-[52vh] max-sm:flex-1 max-sm:min-h-0 overflow-y-auto">
          {!query.trim() ? (
            <p className="text-sm text-gray-400 dark:text-white/25 text-center py-10">Start typing to search all policies</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-white/25 text-center py-10">No policies found for "{query}"</p>
          ) : (
            <ul>
              {results.map((p, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSelect(p)}
                    className="w-full text-left px-4 py-3 max-sm:min-h-[64px] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0 group"
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
                      {p.policy_no && (
                        <>
                          <span className="text-gray-300 dark:text-white/20 text-xs">·</span>
                          <span className="text-xs font-mono text-gray-400 dark:text-white/40">#{p.policy_no}</span>
                        </>
                      )}
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

