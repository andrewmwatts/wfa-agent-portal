import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../../shared/agencyScope'
import { fmtDate, fmtDateShort, fmtCurrency as fmtAmt } from '../utils/format'
import { normalizeCarrier } from '../../shared/carriers'
import { getPolicyStatusClass } from '../utils/status'
import PolicyModal, { PolicyModalErrorBoundary } from '../components/PolicyEditModal'
import { matchesPolicy } from '../utils/policySearch'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

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

const TONE = {
  overdue:  'bg-red-500/10 border-red-500/40',
  critical: 'bg-red-500/5 border-red-500/30',
  warning:  'bg-amber-500/5 border-amber-500/30',
}

function lapseText(days) {
  if (days === null) return '—'
  if (days < 0)  return `Overdue ${Math.abs(days)}d`
  if (days === 0) return 'Lapses today'
  return `Lapses in ${days}d`
}

// ─── Badge components ─────────────────────────────────────────────────────────

function ConsBadge({ status, urg = 'none' }) {
  if (!status) return <span className="text-gray-400 dark:text-white/40 text-xs">—</span>
  const cls = (urg === 'overdue' || urg === 'critical')
    ? 'bg-red-500/15 text-red-700 dark:text-red-300'
    : urg === 'warning'
    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${cls}`}>{status}</span>
}

function DaysBadge({ days }) {
  if (days === null) return <span className="text-gray-400 dark:text-white/40 text-xs">—</span>
  const cls = days < 0
    ? 'text-red-700 dark:text-red-300 font-bold'
    : days <= 7  ? 'text-red-700 dark:text-red-300 font-semibold'
    : days <= 30 ? 'text-amber-700 dark:text-amber-300'
    : 'text-gray-600 dark:text-white/60'
  return <span className={`text-xs tabular-nums ${cls}`}>{days}</span>
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-gray-400 dark:text-white/40 text-xs">—</span>
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${getPolicyStatusClass(status)}`}>{status}</span>
}

// ─── Shared filter primitives ─────────────────────────────────────────────────

function SelectFilter({ value, onChange, options, allLabel, optionStyle }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={allLabel}
      className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer min-w-0 max-sm:flex-1 max-sm:h-11 max-sm:rounded-xl max-sm:px-3 touch:sm:min-h-[44px]"
    >
      <option value="" style={optionStyle}>{allLabel}</option>
      {options.map(o => <option key={o} value={o} style={optionStyle}>{o}</option>)}
    </select>
  )
}

function SearchInput({ value, onChange }) {
  return (
    <input
      type="search"
      placeholder="Search client or policy #…"
      aria-label="Search client or policy number"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-white/40 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent/60 w-44 max-sm:w-full max-sm:basis-full max-sm:order-first max-sm:h-12 max-sm:rounded-xl max-sm:px-4 touch:sm:min-h-[44px]"
    />
  )
}

function SortSelect({ value, onChange, options, optionStyle }) {
  return (
    <div className="ml-auto max-sm:ml-0 max-sm:basis-full flex items-center gap-2">
      <span className="text-xs text-gray-600 dark:text-white/50 whitespace-nowrap">Order by</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Order by"
        className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent cursor-pointer min-w-0 max-sm:flex-1 max-sm:h-11 max-sm:rounded-xl max-sm:px-3 touch:sm:min-h-[44px]"
      >
        {options.map(o => <option key={o.id} value={o.id} style={optionStyle}>{o.label}</option>)}
      </select>
    </div>
  )
}

function SelfTeamToggle({ value, onChange }) {
  return (
    <div className="flex rounded-lg max-sm:rounded-xl overflow-hidden border border-gray-200 dark:border-white/15 max-sm:basis-full">
      {[['self', 'Self'], ['team', 'Team']].map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`text-xs px-3 py-1.5 max-sm:flex-1 max-sm:h-11 max-sm:text-sm touch:sm:min-h-[44px] transition-colors ${
            value === id
              ? 'bg-accent/20 text-gray-900 dark:text-white font-semibold'
              : 'text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'
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
      <p className="text-gray-500 dark:text-white/50 text-sm">{message}</p>
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

const TH_CLS = 'text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-4 py-3 first:pl-5 last:pr-5 whitespace-nowrap'
const TABLE_WRAP = 'hidden md:block bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden'
// Below xl (tablet) the lower-priority columns drop out so the table fits without side-scrolling.
const XL_ONLY = 'hidden xl:table-cell'

// Phone layout: one tappable card per policy. `tone` tints the card for urgent lapses.
function PolicyCards({ rows, onSelect, renderCard }) {
  return (
    <ul className="md:hidden space-y-2.5">
      {rows.map((p, i) => {
        const c = renderCard(p)
        return (
          <li key={p.id ?? i}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors active:bg-gray-50 dark:active:bg-white/10 ${c.tone ?? 'bg-white dark:bg-primary/30 border-gray-200 dark:border-white/10'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-base font-semibold text-gray-900 dark:text-white leading-snug min-w-0">{p.applicant || '—'}</span>
                <span className="shrink-0 pt-0.5">{c.badge}</span>
              </div>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-white/65">{c.sub}</p>
              <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="text-gray-700 dark:text-white/75">{c.left}</span>
                <span className="text-right">{c.right}</span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const dot = <span aria-hidden className="mx-1.5 text-gray-400 dark:text-white/30">·</span>

const LAPSE_SORT = [
  { id: 'lapse-date', label: 'Lapse Date' },
  { id: 'agent',      label: 'Agent Name A–Z' },
  { id: 'carrier',    label: 'Carrier A–Z' },
]

// ─── Tab 1: Pending Lapse ─────────────────────────────────────────────────────

const PENDING_STATUSES = new Set(['lapse pending', 'first premium not paid'])

function PendingLapseTab({ policies, onSelect, optionStyle }) {
  const [carrierFilter,  setCarrierFilter]  = useState('')
  const [agentFilter,    setAgentFilter]    = useState('')
  const [search,         setSearch]         = useState('')
  const [sortBy,         setSortBy]         = useState('lapse-date')
  const [filterNotExempt, setFilterNotExempt] = useState(false)

  const base = useMemo(() =>
    policies.filter(p => PENDING_STATUSES.has((p.conservation_status || '').trim().toLowerCase()))
  , [policies])

  const carriers = useMemo(() => [...new Set(base.map(p => p.carrier).filter(Boolean))].sort(), [base])
  const agents   = useMemo(() => [...new Set(base.map(p => p.agent).filter(Boolean))].sort(), [base])

  const filtered = useMemo(() => base.filter(p => {
    if (filterNotExempt && p.chargeback_exempt !== false) return false
    if (carrierFilter && p.carrier !== carrierFilter) return false
    if (agentFilter   && p.agent   !== agentFilter)   return false
    if (search && !matchesPolicy(p, search)) return false
    return true
  }), [base, filterNotExempt, carrierFilter, agentFilter, search])

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
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setFilterNotExempt(v => !v)}
          aria-pressed={filterNotExempt}
          className={`text-sm md:text-xs font-medium px-3 max-md:h-11 md:py-1.5 touch:md:min-h-[44px] rounded-xl md:rounded-lg border transition-colors ${
            filterNotExempt
              ? 'bg-orange-500/15 border-orange-400/50 text-gray-900 dark:text-white'
              : 'bg-gray-100 border-transparent text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15'
          }`}
        >
          Not Chargeback Exempt
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={LAPSE_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <>
        <PolicyCards
          rows={sorted}
          onSelect={onSelect}
          renderCard={p => {
            const days = daysToLapse(p.conservation_date)
            const urg  = getUrgency(days)
            const tone = TONE[urg] ? `${TONE[urg]}` : undefined
            return {
              tone,
              badge: <ConsBadge status={p.conservation_status} urg={urg} />,
              sub: <>{p.agent || '—'}{dot}{p.carrier || '—'}</>,
              left: <>{fmtAmt(p.issued_apv)} APV{p.issue_date ? <>{dot}Issued {fmtDateShort(p.issue_date)}</> : null}</>,
              right: <span className={`font-semibold tabular-nums ${urg === 'overdue' || urg === 'critical' ? 'text-red-700 dark:text-red-300' : urg === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-white/75'}`}>{lapseText(days)}</span>,
            }
          }}
        />
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm xl:min-w-[860px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'Issued APV', 'Issue Date', 'Expected Lapse Date', 'Days'].map(h => (
                    <th key={h} className={`${TH_CLS} ${h === 'Carrier' || h === 'Issue Date' ? XL_ONLY : ''}`}>
                      {h === 'Expected Lapse Date' ? <><span className="xl:hidden">Lapse Date</span><span className="hidden xl:inline">{h}</span></> : h}
                    </th>
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
                      <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">{p.agent}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs">
                        {p.applicant}
                        <span className="xl:hidden block text-gray-500 dark:text-white/50 mt-0.5">{p.carrier}</span>
                      </td>
                      <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap ${XL_ONLY}`}>{p.carrier}</td>
                      <td className="px-4 py-3"><ConsBadge status={p.conservation_status} urg={urg} /></td>
                      <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                      <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap ${XL_ONLY}`}>{fmtDate(p.issue_date)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.conservation_date)}</td>
                      <td className="px-4 py-3 pr-5"><DaysBadge days={days} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </>
  )
}

// ─── Tab 2: Lapsed ────────────────────────────────────────────────────────────

const LAPSED_STATUSES = new Set(['lapsed', 'cancelled'])

function LapsedTab({ policies, masterPersonnel, subjectSfgId, onSelect, optionStyle }) {
  const [scope,          setScope]          = useState('team')
  const [carrierFilter,  setCarrierFilter]  = useState('')
  const [agentFilter,    setAgentFilter]    = useState('')
  const [search,         setSearch]         = useState('')
  const [sortBy,         setSortBy]         = useState('lapse-date')
  const [filterNotExempt, setFilterNotExempt] = useState(false)

  const selfIds = useMemo(() => getSelfSfgIds(subjectSfgId, masterPersonnel), [subjectSfgId, masterPersonnel])

  const base = useMemo(() => policies.filter(p => {
    if (!LAPSED_STATUSES.has((p.conservation_status || '').trim().toLowerCase())) return false
    if (scope === 'self' && !selfIds.has(p.sfg_id?.toLowerCase())) return false
    return true
  }), [policies, scope, selfIds])

  const carriers = useMemo(() => [...new Set(base.map(p => p.carrier).filter(Boolean))].sort(), [base])
  const agents   = useMemo(() => [...new Set(base.map(p => p.agent).filter(Boolean))].sort(), [base])

  const filtered = useMemo(() => base.filter(p => {
    if (filterNotExempt && p.chargeback_exempt !== false) return false
    if (carrierFilter && p.carrier !== carrierFilter) return false
    if (agentFilter   && p.agent   !== agentFilter)   return false
    if (search && !matchesPolicy(p, search)) return false
    return true
  }), [base, filterNotExempt, carrierFilter, agentFilter, search])

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
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setFilterNotExempt(v => !v)}
          aria-pressed={filterNotExempt}
          className={`text-sm md:text-xs font-medium px-3 max-md:h-11 md:py-1.5 touch:md:min-h-[44px] rounded-xl md:rounded-lg border transition-colors ${
            filterNotExempt
              ? 'bg-orange-500/15 border-orange-400/50 text-gray-900 dark:text-white'
              : 'bg-gray-100 border-transparent text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15'
          }`}
        >
          Not Chargeback Exempt
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <SelfTeamToggle value={scope} onChange={setScope} />
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={LAPSE_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <>
        <PolicyCards
          rows={sorted}
          onSelect={onSelect}
          renderCard={p => ({
            badge: <ConsBadge status={p.conservation_status} />,
            sub: <>{p.agent || '—'}{dot}{p.carrier || '—'}{p.policy_type ? <>{dot}{p.policy_type}</> : null}</>,
            left: <>{fmtAmt(p.issued_apv)} APV</>,
            right: <span className="text-gray-700 dark:text-white/75">{p.conservation_date ? `Lapsed ${fmtDateShort(p.conservation_date)}` : '—'}</span>,
          })}
        />
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm xl:min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy Type', 'Status', 'Issued APV', 'Lapse Date'].map(h => (
                    <th key={h} className={`${TH_CLS} ${h === 'Carrier' || h === 'Policy Type' ? XL_ONLY : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => (
                  <tr key={i} onClick={() => onSelect(p)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">{p.agent}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs">
                      {p.applicant}
                      <span className="xl:hidden block text-gray-500 dark:text-white/50 mt-0.5">{p.carrier}{p.policy_type ? ` · ${p.policy_type}` : ''}</span>
                    </td>
                    <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap ${XL_ONLY}`}>{p.carrier}</td>
                    <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs max-w-[140px] truncate ${XL_ONLY}`}>{p.policy_type || '—'}</td>
                    <td className="px-4 py-3"><ConsBadge status={p.conservation_status} /></td>
                    <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                    <td className="px-4 py-3 pr-5 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.conservation_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
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
      if (search && !matchesPolicy(p, search)) return false
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
      <div className="grid grid-cols-4 gap-2 md:flex md:flex-wrap md:items-center mb-4">
        {REVIEW_QUICK_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setQuickFilter(f.id)}
            aria-pressed={quickFilter === f.id}
            className={`text-[13px] md:text-xs whitespace-nowrap font-medium px-1 md:px-3 max-md:h-11 md:py-1.5 touch:md:min-h-[44px] rounded-xl md:rounded-lg border transition-colors ${
              quickFilter === f.id
                ? 'border-accent bg-primary text-white dark:bg-white dark:text-primary'
                : 'border-transparent bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <SelfTeamToggle value={scope} onChange={setScope} />
        <SelectFilter value={carrierFilter} onChange={setCarrierFilter} options={carriers} allLabel="All Carriers" optionStyle={optionStyle} />
        <SelectFilter value={agentFilter}   onChange={setAgentFilter}   options={agents}   allLabel="All Agents"   optionStyle={optionStyle} />
        <SearchInput  value={search}        onChange={setSearch} />
        <SortSelect   value={sortBy}        onChange={setSortBy} options={REVIEW_SORT} optionStyle={optionStyle} />
      </div>

      {sorted.length === 0 ? <EmptyState /> : (
        <>
        <PolicyCards
          rows={sorted}
          onSelect={onSelect}
          renderCard={p => ({
            badge: <StatusBadge status={p.status} />,
            sub: <>{p.agent || '—'}{dot}{p.carrier || '—'}{p.policy_type ? <>{dot}{p.policy_type}</> : null}</>,
            left: <>{fmtAmt(p.issued_apv)} APV{p.face_amt ? <>{dot}{fmtAmt(p.face_amt)} face</> : null}</>,
            right: <span className="text-gray-700 dark:text-white/75">{p.issue_date ? `Issued ${fmtDateShort(p.issue_date)}` : '—'}</span>,
          })}
        />
        <div className={TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm xl:min-w-[940px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Policy Type', 'Status', 'APV', 'Issue Date', 'Face Value'].map(h => (
                    <th key={h} className={`${TH_CLS} ${h === 'Carrier' || h === 'Policy Type' || h === 'Face Value' ? XL_ONLY : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {sorted.map((p, i) => (
                  <tr key={i} onClick={() => onSelect(p)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                    <td className="px-4 py-3 first:pl-5 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">{p.agent || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-white/80 text-xs group-hover:text-accent transition-colors">
                      {p.applicant || '—'}
                      <span className="xl:hidden block text-gray-500 dark:text-white/50 mt-0.5">{p.carrier || '—'}{p.policy_type ? ` · ${p.policy_type}` : ''}</span>
                    </td>
                    <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap ${XL_ONLY}`}>{p.carrier || '—'}</td>
                    <td className={`px-4 py-3 text-gray-600 dark:text-white/60 text-xs max-w-[140px] truncate ${XL_ONLY}`}>{p.policy_type || '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs tabular-nums">{fmtAmt(p.issued_apv)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(p.issue_date)}</td>
                    <td className={`px-4 py-3 pr-5 text-gray-600 dark:text-white/60 text-xs tabular-nums ${XL_ONLY}`}>{fmtAmt(p.face_amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
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
    return allPolicies.filter(p => matchesPolicy(p, q)).slice(0, 20)
  }, [allPolicies, quickSearchQuery])

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-500 dark:text-white/50 text-sm">Please sign in to view engagement data.</p>
    </div>
  )

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4 sm:mb-6">
        <div className="flex items-center gap-4 max-sm:contents">
          <h1 className="text-[22px] sm:text-xl font-bold text-gray-900 dark:text-white max-sm:flex-1 max-sm:min-w-0 max-sm:truncate">Client Engagement</h1>
          {isDirector && (
            <div className="max-sm:order-3 max-sm:basis-full">
              <ScopeDropdown
                masterPersonnel={masterPersonnel}
                selfId={activeSubject?.sfg_id}
                value={selectedScope}
                onChange={handleScopeChange}
              />
            </div>
          )}
        </div>
        <button
          onClick={() => { setQuickSearchOpen(true); setQuickSearchQuery('') }}
          aria-label="Quick Search"
          className="flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-white/60 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 px-3 py-1.5 max-sm:w-11 max-sm:h-11 max-sm:p-0 max-sm:rounded-xl max-sm:order-2 touch:sm:min-h-[44px] rounded-lg transition-colors"
        >
          <svg className="w-4 h-4 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/>
          </svg>
          <span className="max-sm:hidden">Quick Search</span>
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex gap-1 border-b border-gray-200 dark:border-white/10 mb-4 sm:mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 max-sm:px-1 max-sm:flex-1 max-sm:h-11 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'border-accent text-gray-900 dark:text-white font-semibold'
                : 'border-transparent text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white'
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
        <PolicyModalErrorBoundary onClose={() => setSelected(null)}>
          <PolicyModal
            view="lapse"
            policy={selected}
            personnel={masterPersonnel}
            onClose={() => setSelected(null)}
            canWrite={permissions?.appsAndPolicies?.write ?? false}
            onUpdate={updated => {
              setSelected(updated)
              setAllPolicies(prev => prev.map(p => p.id === updated.id ? updated : p))
            }}
            agentPhone={masterPersonnel.find(pers => pers.sfg_id === selected.sfg_id)?.phone}
            viewerSfgId={activeSubject?.sfg_id}
          />
        </PolicyModalErrorBoundary>
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
  useBodyScrollLock(true)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center sm:pt-24 sm:px-4 bg-black/60 sm:bg-transparent !mt-0"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-secondary sm:border border-gray-200 dark:border-white/15 sm:rounded-2xl shadow-2xl w-full sm:max-w-lg overflow-hidden max-sm:h-dvh max-sm:flex max-sm:flex-col">
        <div className="flex items-center gap-2 px-4 py-3 max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-100 dark:border-white/10">
          <input
            autoFocus
            type="search"
            aria-label="Search by client name or policy number"
            placeholder="Search client or policy #…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/40 text-sm max-sm:h-11 focus:outline-none"
          />
          <button onClick={onClose} className="sm:hidden h-11 px-1 text-sm font-semibold text-gray-800 dark:text-white">Cancel</button>
        </div>
        <div className="sm:max-h-80 max-sm:flex-1 max-sm:min-h-0 overflow-y-auto overscroll-contain">
          {!query.trim() && (
            <p className="text-gray-500 dark:text-white/50 text-sm text-center py-10 sm:hidden">Start typing to search all policies</p>
          )}
          {results.length === 0 && query.trim() && (
            <p className="text-gray-500 dark:text-white/50 text-sm text-center py-8">No results</p>
          )}
          {results.map((p, i) => {
            const days = daysToLapse(p.conservation_date)
            const urg  = getUrgency(days)
            return (
              <button
                key={i}
                onClick={() => onSelect(p)}
                className="w-full text-left px-4 py-3 max-sm:min-h-[64px] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-100 dark:border-white/5 last:border-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{p.applicant}</span>
                  {p.conservation_status
                    ? <ConsBadge status={p.conservation_status} urg={urg} />
                    : <StatusBadge status={p.status} />
                  }
                </div>
                <p className="text-xs text-gray-600 dark:text-white/50 mt-0.5">
                  {p.agent} · {p.carrier} · {fmtDate(p.issue_date)}
                  {p.policy_no && <> · <span className="font-mono">#{p.policy_no}</span></>}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
