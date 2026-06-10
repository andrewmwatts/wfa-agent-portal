import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../utils/agencyScope'
import { fmtDate, fmtCurrency as fmtAmt } from '../utils/format'
import { normalizeCarrier } from '../../shared/carriers'
import { getPolicyStatusClass } from '../utils/status'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysToLapse(date) {
  if (!date) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const lapse = new Date(date); lapse.setHours(0, 0, 0, 0)
  return Math.round((lapse - today) / (1000 * 60 * 60 * 24))
}

function getUrgency(days) {
  if (days === null) return 'none'
  if (days < 0)    return 'overdue'
  if (days <= 7)   return 'critical'
  if (days <= 30)  return 'warning'
  return 'normal'
}

// Self scope: subject's own sfg_id + recursively lapsed/terminated downlines
function getSelfSfgIds(subjectSfgId, masterPersonnel) {
  const byId = {}, childrenOf = {}
  for (const p of masterPersonnel) {
    const id = p.sfg_id.toLowerCase()
    byId[id] = p
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (up) (childrenOf[up] ??= []).push(id)
  }
  const result = new Set([subjectSfgId.toLowerCase()])
  function traverse(id) {
    for (const childId of (childrenOf[id] ?? [])) {
      const s = byId[childId]?.status?.toLowerCase()
      if (s === 'lapsed' || s === 'terminated') {
        result.add(childId)
        traverse(childId)
      }
    }
  }
  traverse(subjectSfgId.toLowerCase())
  return result
}

// Returns a Date n months ago, at midnight local time
function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function parseIssueDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d) ? null : d
}

// ─── Badge components ─────────────────────────────────────────────────────────

function ConsBadge({ status, urg = 'none' }) {
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

function StatusBadge({ status }) {
  if (!status) return <span className="text-gray-400 dark:text-white/30 text-xs">—</span>
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${getPolicyStatusClass(status)}`}>{status}</span>
}

// ─── Shared filter primitives ─────────────────────────────────────────────────

function SelectFilter({ value, onChange, options, allLabel, optionStyle }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
    >
      <option value="" style={optionStyle}>{allLabel}</option>
      {options.map(o => <option key={o} value={o} style={optionStyle}>{o}</option>)}
    </select>
  )
}

function SearchInput({ value, onChange }) {
  return (
    <input
      type="text"
      placeholder="Search client…"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-white/30 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/60 w-44"
    />
  )
}

function SortSelect({ value, onChange, options, optionStyle }) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="text-xs text-gray-400 dark:text-white/40 whitespace-nowrap">Order by</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
      >
        {options.map(o => <option key={o.id} value={o.id} style={optionStyle}>{o.label}</option>)}
      </select>
    </div>
  )
}

function SelfTeamToggle({ value, onChange }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/15">
      {[['self', 'Self'], ['team', 'Team']].map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`text-xs px-3 py-1.5 transition-colors ${
            value === id
              ? 'bg-accent/20 text-accent font-semibold'
              : 'text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ message = 'No records match your filters.' }) {
  return (
    <div className="text-center py-16">
      <p className="text-gray-400 dark:text-white/30 text-sm">{message}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 bg-gray-100 dark:bg-white/10 rounded-xl" />
      ))}
    </div>
  )
}

const TH_CLS = 'text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-4 py-3 first:pl-5 last:pr-5 whitespace-nowrap'
const TABLE_WRAP = 'bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden'

const LAPSE_SORT = [
  { id: 'lapse-date', label: 'Lapse Date' },
  { id: 'agent',      label: 'Agent Name A–Z' },
  { id: 'carrier',    label: 'Carrier A–Z' },
]

// ─── Tab 1: Pending Lapse ─────────────────────────────────────────────────────

const PENDING_STATUSES = new Set(['lapse pending', 'first premium not paid'])

function PendingLapseTab({ policies, onSelect, optionStyle }) {
  const [carrierFilter, setCarrierFilter] = useState('')
  const [agentFilter,   setAgentFilter]   = useState('')
  const [search,        setSearch]        = useState('')
  const [sortBy,        setSortBy]        = useState('lapse-date')

  const base = useMemo(() =>
    policies.filter(p => PENDING_STATUSES.has((p.conservation_status || '').trim().toLowerCase()))
  , [policies])

  const carriers = useMemo(() => [...new Set(base.map(p => p.carrier).filter(Boolean))].sort(), [base])
  const agents   = useMemo(() => [...new Set(base.map(p => p.agent).filter(Boolean))].sort(), [base])

  const filtered = useMemo(() => base.filter(p => {
    if (carrierFilter && p.carrier !== carrierFilter) return false
    if (agentFilter   && p.agent   !== agentFilter)   return false
    if (search && !p.applicant?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [base, carrierFilter, agentFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortBy === 'lapse-date') {
      arr.sort((a, b) => {
        const da = daysToLapse(a.conservation_date)
        const db = daysToLapse(b.conservation_date)
        if (da === null && db === null) return 0
        if (da === null) return 1
        if (db === null) return -1
        return da - db
      })
    } else if (sortBy === 'agent') {
      arr.sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? ''))
    } else if (sortBy === 'carrier') {
      arr.sort((a, b) => (a.carrier ?? '').localeCompare(b.carrier ?? ''))
    }
    return arr
  }, [filtered, sortBy])

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={LAPSE_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'Issued APV', 'Issue Date', 'Expected Lapse Date', 'Days'].map(h => (
                    <th key={h} className={TH_CLS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => {
                  const days = daysToLapse(p.conservation_date)
                  const urg  = getUrgency(days)
                  const rowBg = { overdue: 'bg-red-500/10', critical: 'bg-red-500/5', warning: 'bg-amber-500/5', normal: '', none: '' }[urg]
                  return (
                    <tr key={i} onClick={() => onSelect(p)} className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${rowBg}`}>
                      <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs">{p.agent}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs">{p.applicant}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{p.carrier}</td>
                      <td className="px-4 py-3"><ConsBadge status={p.conservation_status} urg={urg} /></td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.issue_date)}</td>
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
    </>
  )
}

// ─── Tab 2: Lapsed ────────────────────────────────────────────────────────────

const LAPSED_STATUSES = new Set(['lapsed', 'cancelled'])

function LapsedTab({ policies, masterPersonnel, subjectSfgId, onSelect, optionStyle }) {
  const [scope,         setScope]         = useState('team')
  const [carrierFilter, setCarrierFilter] = useState('')
  const [agentFilter,   setAgentFilter]   = useState('')
  const [search,        setSearch]        = useState('')
  const [sortBy,        setSortBy]        = useState('lapse-date')

  const selfIds = useMemo(() => getSelfSfgIds(subjectSfgId, masterPersonnel), [subjectSfgId, masterPersonnel])

  const base = useMemo(() => policies.filter(p => {
    if (!LAPSED_STATUSES.has((p.conservation_status || '').trim().toLowerCase())) return false
    if (scope === 'self' && !selfIds.has(p.sfg_id?.toLowerCase())) return false
    return true
  }), [policies, scope, selfIds])

  const carriers = useMemo(() => [...new Set(base.map(p => p.carrier).filter(Boolean))].sort(), [base])
  const agents   = useMemo(() => [...new Set(base.map(p => p.agent).filter(Boolean))].sort(), [base])

  const filtered = useMemo(() => base.filter(p => {
    if (carrierFilter && p.carrier !== carrierFilter) return false
    if (agentFilter   && p.agent   !== agentFilter)   return false
    if (search && !p.applicant?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [base, carrierFilter, agentFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortBy === 'lapse-date') {
      arr.sort((a, b) => {
        const da = a.conservation_date ? new Date(a.conservation_date) : null
        const db = b.conservation_date ? new Date(b.conservation_date) : null
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return db - da
      })
    } else if (sortBy === 'agent') {
      arr.sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? ''))
    } else if (sortBy === 'carrier') {
      arr.sort((a, b) => (a.carrier ?? '').localeCompare(b.carrier ?? ''))
    }
    return arr
  }, [filtered, sortBy])

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SelfTeamToggle value={scope} onChange={setScope} />
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={LAPSE_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy Type', 'Status', 'Issued APV', 'Lapse Date'].map(h => (
                    <th key={h} className={TH_CLS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => (
                  <tr key={i} onClick={() => onSelect(p)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs">{p.agent}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs">{p.applicant}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{p.carrier}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs max-w-[140px] truncate">{p.policy_type || '—'}</td>
                    <td className="px-4 py-3"><ConsBadge status={p.conservation_status} /></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                    <td className="px-4 py-3 pr-5 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.conservation_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Tab 3: Policy Reviews ────────────────────────────────────────────────────

const REVIEW_QUICK_FILTERS = [
  { id: 'one-month',     label: 'One Month'  },
  { id: 'six-month',     label: 'Six Month'  },
  { id: 'one-year',      label: 'One Year'   },
  { id: 'one-year-plus', label: 'One Year+'  },
]

const REVIEW_SORT = [
  { id: 'issue-date', label: 'Issue Date'    },
  { id: 'agent',      label: 'Agent Name A–Z' },
  { id: 'carrier',    label: 'Carrier A–Z'   },
]

function PolicyReviewsTab({ policies, masterPersonnel, subjectSfgId, onSelect, optionStyle }) {
  const [scope,         setScope]         = useState('team')
  const [quickFilter,   setQuickFilter]   = useState('one-month')
  const [carrierFilter, setCarrierFilter] = useState('')
  const [agentFilter,   setAgentFilter]   = useState('')
  const [search,        setSearch]        = useState('')
  const [sortBy,        setSortBy]        = useState('issue-date')

  const selfIds = useMemo(() => getSelfSfgIds(subjectSfgId, masterPersonnel), [subjectSfgId, masterPersonnel])

  // Base: Issued + no conservation_status
  const base = useMemo(() => policies.filter(p => {
    if ((p.status || '').trim().toLowerCase() !== 'issued') return false
    if (p.conservation_status?.trim()) return false
    if (scope === 'self' && !selfIds.has(p.sfg_id?.toLowerCase())) return false
    return true
  }), [policies, scope, selfIds])

  const carriers = useMemo(() => [...new Set(base.map(p => p.carrier).filter(Boolean))].sort(), [base])
  const agents   = useMemo(() => [...new Set(base.map(p => p.agent).filter(Boolean))].sort(), [base])

  const filtered = useMemo(() => {
    return base.filter(p => {
      const d = parseIssueDate(p.issue_date)

      if (quickFilter === 'one-month') {
        if (!d || d >= monthsAgo(1) || d < monthsAgo(2)) return false
      } else if (quickFilter === 'six-month') {
        if (!d || d >= monthsAgo(6) || d < monthsAgo(8)) return false
      } else if (quickFilter === 'one-year') {
        if (!d || d >= monthsAgo(12) || d < monthsAgo(15)) return false
      } else if (quickFilter === 'one-year-plus') {
        if (!d || d >= monthsAgo(12)) return false
      }

      if (carrierFilter && p.carrier !== carrierFilter) return false
      if (agentFilter   && p.agent   !== agentFilter)   return false
      if (search && !p.applicant?.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [base, quickFilter, carrierFilter, agentFilter, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortBy === 'issue-date') {
      arr.sort((a, b) => {
        const da = parseIssueDate(a.issue_date)
        const db = parseIssueDate(b.issue_date)
        if (!da && !db) return 0
        if (!da) return 1
        if (!db) return -1
        return db - da
      })
    } else if (sortBy === 'agent') {
      arr.sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? ''))
    } else if (sortBy === 'carrier') {
      arr.sort((a, b) => (a.carrier ?? '').localeCompare(b.carrier ?? ''))
    }
    return arr
  }, [filtered, sortBy])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {REVIEW_QUICK_FILTERS.map(f => (
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

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SelfTeamToggle value={scope} onChange={setScope} />
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={REVIEW_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[940px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy Type', 'Status', 'APV', 'Issue Date', 'Face Value'].map(h => (
                    <th key={h} className={TH_CLS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => (
                  <tr key={i} onClick={() => onSelect(p)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                    <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs">{p.agent || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs group-hover:text-accent transition-colors">{p.applicant || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{p.carrier || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs max-w-[140px] truncate">{p.policy_type || '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.issue_date)}</td>
                    <td className="px-4 py-3 pr-5 text-gray-500 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.face_amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'pending-lapse',  label: 'Pending Lapse'   },
  { id: 'lapsed',         label: 'Lapsed'           },
  { id: 'policy-reviews', label: 'Policy Reviews'   },
]

export default function EngagementPage() {
  const { activeSubject, permissions } = useViewing()
  const { theme } = useTheme()

  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [masterPersonnel, setMasterPersonnel] = useState([])
  const [allPolicies,     setAllPolicies]     = useState([])
  const [loading,         setLoading]         = useState(false)
  const [selectedScope,   setSelectedScope]   = useState('master')
  const [activeTab,       setActiveTab]       = useState('pending-lapse')
  const [selected,        setSelected]        = useState(null)
  const [quickSearchOpen,  setQuickSearchOpen]  = useState(false)
  const [quickSearchQuery, setQuickSearchQuery] = useState('')

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master&include=policies`)
      if (!res.ok) return
      const { personnel, policies: rows } = await res.json()
      setMasterPersonnel(personnel)
      setSelectedScope('master')
      setAllPolicies((rows ?? []).map(p => ({ ...p, carrier: normalizeCarrier(p.carrier) })))
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
      const sfgIds = scoped.map(p => p.sfg_id)
      if (!sfgIds.length) { setAllPolicies([]); return }
      const res = await fetch(`/api/policies?sfg_ids=${sfgIds.join(',')}`)
      if (!res.ok) return
      const { policies: rows } = await res.json()
      setAllPolicies((rows ?? []).map(p => ({ ...p, carrier: normalizeCarrier(p.carrier) })))
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const quickSearchResults = useMemo(() => {
    if (!quickSearchQuery.trim()) return []
    const q = quickSearchQuery.toLowerCase()
    return allPolicies.filter(p => p.applicant?.toLowerCase().includes(q)).slice(0, 20)
  }, [allPolicies, quickSearchQuery])

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view engagement data.</p>
    </div>
  )

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Client Engagement</h1>
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-white/10 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading ? <LoadingSkeleton /> : (
        <>
          {activeTab === 'pending-lapse' && (
            <PendingLapseTab
              policies={allPolicies}
              onSelect={setSelected}
              optionStyle={optionStyle}
            />
          )}
          {activeTab === 'lapsed' && (
            <LapsedTab
              policies={allPolicies}
              masterPersonnel={masterPersonnel}
              subjectSfgId={activeSubject.sfg_id}
              onSelect={setSelected}
              optionStyle={optionStyle}
            />
          )}
          {activeTab === 'policy-reviews' && (
            <PolicyReviewsTab
              policies={allPolicies}
              masterPersonnel={masterPersonnel}
              subjectSfgId={activeSubject.sfg_id}
              onSelect={setSelected}
              optionStyle={optionStyle}
            />
          )}
        </>
      )}

      {/* Detail modal */}
      {selected && (
        <LapseModal
          policy={selected}
          onClose={() => setSelected(null)}
          canWrite={permissions?.appsAndPolicies?.write ?? false}
          onUpdate={updated => {
            setSelected(updated)
            setAllPolicies(prev => prev.map(p => p.id === updated.id ? updated : p))
          }}
        />
      )}

      {/* Quick search */}
      {quickSearchOpen && !selected && (
        <QuickSearchModal
          query={quickSearchQuery}
          setQuery={setQuickSearchQuery}
          results={quickSearchResults}
          onSelect={p => { setSelected(p); setQuickSearchOpen(false) }}
          onClose={() => { setQuickSearchOpen(false); setQuickSearchQuery('') }}
        />
      )}

    </main>
  )
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
                onClick={() => onSelect(p)}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{p.applicant}</span>
                  {p.conservation_status
                    ? <ConsBadge status={p.conservation_status} urg={urg} />
                    : <StatusBadge status={p.status} />
                  }
                </div>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
                  {p.agent} · {p.carrier} · {fmtDate(p.issue_date)}
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

function LapseModal({ policy: p, onClose, canWrite, onUpdate }) {
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

  function startEdit() { setDraft({ ...p }); setEditing(true); setSaveError(null) }
  function cancelEdit() { setEditing(false); setDraft(null); setSaveError(null) }
  function setField(key, value) { setDraft(d => ({ ...d, [key]: value })) }

  async function handleRemoveConservation() {
    setRemoving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, updates: { conservation_status: '', conservation_date: '' } }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Remove failed') }
      onUpdate?.({ ...p, conservation_status: '', conservation_date: '' })
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
      updates.chargeback_exempt = !!draft.chargeback_exempt
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, updates }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Save failed') }
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
  const days     = daysToLapse(display.conservation_date)
  const urg      = getUrgency(days)

  const daysLabel = days === null ? null
    : days < 0   ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'Due today'
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

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {canWrite && !editing && display.conservation_status && (
                <button
                  onClick={handleRemoveConservation}
                  disabled={removing}
                  className="text-xs font-medium text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {removing ? 'Removing…' : 'Remove Conservation'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {canWrite && !editing && (
                <button onClick={startEdit} className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10">
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button onClick={cancelEdit} className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10">
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {saving && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
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
            <div className="mb-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300">{saveError}</div>
          )}

          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{display.applicant}</h2>
              <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">{display.agent}</p>
            </div>
            {daysLabel && (
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 ${daysCls}`}>{daysLabel}</span>
            )}
          </div>

          <ModalSection title="Policy">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <LapseEditField label="Carrier"     value={draft.carrier}     onChange={v => setField('carrier', v)} />
                <LapseEditField label="Policy Type" value={draft.policy_type} onChange={v => setField('policy_type', v)} />
                <LapseEditField label="Policy #"    value={draft.policy_no}   onChange={v => setField('policy_no', v)} />
                <LapseEditField label="Issue Date"  value={toInputDate(draft.issue_date)}  onChange={v => setField('issue_date', v)}  type="date" />
                <LapseEditField label="Issued APV"  value={draft.issued_apv ?? ''}  onChange={v => setField('issued_apv', v)} />
                <LapseEditField label="Face Amount" value={draft.face_amt ?? ''}    onChange={v => setField('face_amt', v)} />
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

          {(display.not_in_opt || display.split_reset) && (
            <ModalSection title="Flags">
              <div className="flex flex-wrap gap-4">
                <CheckItem label="Not in Opt"  value={display.not_in_opt} />
                <CheckItem label="Split/Reset" value={display.split_reset} />
              </div>
            </ModalSection>
          )}

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
            <p className="text-xs text-gray-400 dark:text-white/30 mt-4 text-right">Last updated: {fmtDate(display.last_update)}</p>
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
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3 pb-1.5 border-b border-gray-100 dark:border-white/10">{title}</h3>
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
