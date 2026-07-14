import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { useAuth }    from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { useTheme }   from '../context/ThemeContext'
import { fmtDate, parseDateLocal } from '../utils/format'

// ─── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_PRESETS = [
  { key: 'month',   label: 'Month'     },
  { key: 'quarter', label: 'Quarter'   },
  { key: 'ytd',     label: 'YTD'       },
  { key: 'year',    label: 'Last Year' },
  { key: 'all',     label: 'All Time'  },
]

const DONUT_COLORS = [
  '#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#ef4444','#ec4899','#84cc16','#f97316','#6366f1',
]

const SUBMITTED_COLOR = '#3b82f6'
const ISSUED_COLOR    = '#22c55e'
const LINE_COLORS     = ['#3b82f6', '#10b981', '#f59e0b']

const CONTRACT_LEVELS   = [85, 90, 95, 100, 105, 110, 115, 120, 125, 130]
const LEADERSHIP_ORDER  = ['TL', 'KL', 'AO']
const TITLE_LABELS      = { TL: 'Team Leader', KL: 'Key Leader', AO: 'Agency Owner' }

// ─── Date / period helpers ─────────────────────────────────────────────────────

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function computePeriod(preset) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (preset === 'month')   return { preset, start: toYMD(new Date(y, m, 1)),                 end: toYMD(now) }
  if (preset === 'quarter') return { preset, start: toYMD(new Date(y, Math.floor(m/3)*3, 1)), end: toYMD(now) }
  if (preset === 'ytd')     return { preset, start: toYMD(new Date(y, 0, 1)),                  end: toYMD(now) }
  if (preset === 'year')    { const s = new Date(now); s.setFullYear(s.getFullYear() - 1); return { preset, start: toYMD(s), end: toYMD(now) } }
  return { preset: 'all', start: null, end: null }
}

function inPeriod(dateStr, period) {
  if (!dateStr) return false
  if (period.preset === 'all') return true
  return dateStr >= period.start && dateStr <= period.end
}

function weekRange() {
  const now = new Date()
  const sun = new Date(now); sun.setDate(now.getDate() - now.getDay())
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6)
  return { start: toYMD(sun), end: toYMD(sat) }
}

function monthRange() {
  const now = new Date()
  return { start: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), end: toYMD(now) }
}

function ytdRange() {
  const now = new Date()
  return { start: toYMD(new Date(now.getFullYear(), 0, 1)), end: toYMD(now) }
}

function oneYearAgo() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1); return toYMD(d)
}

function build12MonthBuckets() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const d   = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return {
      key:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      start: toYMD(d),
      end:   toYMD(end),
    }
  })
}

function build12WeekBuckets() {
  const now = new Date()
  const currentSun = new Date(now)
  currentSun.setDate(now.getDate() - now.getDay())
  return Array.from({ length: 12 }, (_, i) => {
    const sun = new Date(currentSun)
    sun.setDate(currentSun.getDate() - (11 - i) * 7)
    const sat = new Date(sun)
    sat.setDate(sun.getDate() + 6)
    return {
      key:   toYMD(sun),
      label: `${sun.getMonth()+1}/${sun.getDate()}`,
      start: toYMD(sun),
      end:   toYMD(sat),
    }
  })
}

function tenure(hireDateStr) {
  if (!hireDateStr) return null
  const hire = parseDateLocal(hireDateStr)
  if (!hire) return null
  const now   = new Date()
  let years   = now.getFullYear() - hire.getFullYear()
  let months  = now.getMonth() - hire.getMonth()
  if (months < 0) { years--; months += 12 }
  const parts = []
  if (years  > 0) parts.push(`${years} yr${years  !== 1 ? 's' : ''}`)
  if (months > 0) parts.push(`${months} mo`)
  return parts.length ? `${parts.join(' ')} in field` : 'Less than 1 month in field'
}

function pct(num, den) {
  if (!den) return null
  return Math.round((num / den) * 100)
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  return `${val}%`
}

function fmtAPV(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US')
}

function fmtAPVShort(n) {
  if (!n) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(abs/1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `$${(abs/1_000).toFixed(0)}K`
  return `$${Math.round(abs)}`
}

function fmtDays(n) {
  if (n === null || n === undefined) return '—'
  return `${Math.round(n)} day${Math.round(n) !== 1 ? 's' : ''}`
}

function groupWithOther(entries, total) {
  if (!total) return []
  const threshold = total * 0.05
  const main  = entries.filter(e => e.value >= threshold)
  const minor = entries.filter(e => e.value <  threshold)
  if (minor.length) main.push({ name: 'Other', value: minor.reduce((s, e) => s + e.value, 0) })
  return main
}

function commissionLevelFromMilestones(milestones) {
  let max = 0
  for (const [level, dates] of Object.entries(milestones ?? {})) {
    const lvl = parseInt(level)
    if (!isNaN(lvl) && Array.isArray(dates) && dates.every(d => d)) max = Math.max(max, lvl)
  }
  return max || null
}

// ─── Shared UI ─────────────────────────────────────────────────────────────────

function CardShell({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-secondary rounded-xl border border-gray-200 dark:border-white/10 ${className}`}>
      {children}
    </div>
  )
}

function SectionCard({ title, children, className = '' }) {
  return (
    <CardShell className={`overflow-hidden ${className}`}>
      {title && (
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-white/8">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 uppercase tracking-wider">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </CardShell>
  )
}

function MetricCard({ label, primary, sub1, sub2, primaryClass = '' }) {
  return (
    <CardShell className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">{label}</p>
      <p className={`text-2xl font-bold text-gray-900 dark:text-white ${primaryClass}`}>{primary ?? '—'}</p>
      {sub1 && <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">{sub1}</p>}
      {sub2 && <p className="text-xs text-gray-400 dark:text-white/35 mt-0.5">{sub2}</p>}
    </CardShell>
  )
}

function EmptySection({ message, icon = true }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-400 dark:text-white/30">
      {icon && (
        <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )}
      <p className="text-sm text-center max-w-sm">{message}</p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )
}

function chartColors(isDark) {
  return {
    text: isDark ? 'rgba(255,255,255,0.4)' : '#9ca3af',
    grid: isDark ? 'rgba(255,255,255,0.08)' : '#e5e7eb',
  }
}

// ─── Period Selector ───────────────────────────────────────────────────────────

function PeriodSelector({ period, onChange }) {
  return (
    <div className="flex gap-1">
      {PERIOD_PRESETS.map(p => (
        <button
          key={p.key}
          onClick={() => onChange(computePeriod(p.key))}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            period.preset === p.key
              ? 'bg-accent text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ─── Agent Selector ────────────────────────────────────────────────────────────

function AgentSelector({ agents, selectedSfgId, onSelect }) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const ref = useRef(null)

  const selected = agents.find(a => a.sfg_id === selectedSfgId) ?? null

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return agents
    return agents.filter(a =>
      a.name?.toLowerCase().includes(q) ||
      a.sfg_id?.toLowerCase().includes(q)
    )
  }, [agents, query])

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function pick(a) { onSelect(a.sfg_id); setOpen(false); setQuery('') }

  return (
    <div ref={ref} className="relative w-full max-w-lg">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-secondary border border-gray-200 dark:border-white/10 rounded-xl text-left shadow-sm hover:border-accent/50 transition-colors"
      >
        {selected ? (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selected.name}</p>
            <p className="text-xs text-gray-400 dark:text-white/40">
              {selected.sfg_id}
              {selected.commission_level ? ` · Level ${selected.commission_level}` : ''}
              {selected.hire_date ? ` · Hired ${fmtDate(selected.hire_date)}` : ''}
            </p>
          </div>
        ) : (
          <span className="text-sm text-gray-400 dark:text-white/40">Select an agent…</span>
        )}
        <svg className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-white dark:bg-primary border border-gray-200 dark:border-white/15 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-white/8">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or SFG ID…"
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-accent/60"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-center text-gray-400 dark:text-white/30">No agents found</p>
            ) : filtered.map(a => (
              <button
                key={a.sfg_id}
                onClick={() => pick(a)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-50 dark:border-white/5 last:border-0 ${
                  a.sfg_id === selectedSfgId ? 'bg-accent/5 dark:bg-accent/10' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{a.name}</p>
                  {a.commission_level && (
                    <span className="flex-shrink-0 text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">
                      Lvl {a.commission_level}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
                  {a.sfg_id}
                  {a.hire_date    ? ` · Hired ${fmtDate(a.hire_date)}` : ''}
                  {a.upline_name ? ` · ↑ ${a.upline_name}` : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section 1: Agent Header (with inline promotion history) ──────────────────

function AgentHeader({ agent, promotions, nextCommTarget, nextLeadTarget }) {
  const ten   = tenure(agent.hire_date)
  const isAct = (agent.status ?? '').toLowerCase() !== 'inactive'

  // Commission promotions sorted ascending by qualified_date
  const commPromos = (promotions ?? [])
    .filter(p => p.promotion_type === 'commission' && p.qualified_date)
    .sort((a, b) => a.qualified_date.localeCompare(b.qualified_date))

  // Leadership title promotions sorted ascending by qualified_date
  const leadPromos = (promotions ?? [])
    .filter(p => p.promotion_type === 'leadership' && p.qualified_date)
    .sort((a, b) => a.qualified_date.localeCompare(b.qualified_date))

  const fmtAPV = v => v != null ? `$${Math.round(v).toLocaleString()}` : '—'

  return (
    <CardShell className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-3">
        {/* Left: identity */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{agent.name}</h1>
          <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">SFG ID: {agent.sfg_id}</p>
          {agent.hire_date && <p className="text-sm text-gray-500 dark:text-white/50">Hired: {fmtDate(agent.hire_date)}</p>}
          {ten && <p className="text-xs text-gray-400 dark:text-white/35 mt-1 italic">{ten}</p>}
        </div>

        {/* Right: level / upline / status */}
        <div className="sm:text-right">
          {agent.commission_level && (
            <p className="text-sm text-gray-700 dark:text-white/70 font-medium">
              Level: <span className="text-accent font-bold">{agent.commission_level}</span>
            </p>
          )}
          {agent.upline_name && (
            <p className="text-sm text-gray-500 dark:text-white/50">Upline: {agent.upline_name}</p>
          )}
          <span className={`inline-flex mt-2 items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            isAct
              ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
              : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isAct ? 'bg-green-500' : 'bg-gray-400'}`} />
            {isAct ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Next promotion targets — inline text, same weight as Level/Upline */}
      {(nextCommTarget || nextLeadTarget) && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/8 flex flex-wrap gap-x-5 gap-y-1">
            {nextCommTarget && (
              <p className="text-sm text-gray-500 dark:text-white/50">
                Next commission:
                <span className="font-medium text-gray-700 dark:text-white/70"> Lvl {nextCommTarget.level}</span>
                {nextCommTarget.regular != null && <span className="text-gray-400 dark:text-white/40"> · {fmtAPV(nextCommTarget.regular)} reg</span>}
                {nextCommTarget.slingshot != null && <span className="text-gray-400 dark:text-white/40"> · {fmtAPV(nextCommTarget.slingshot)} ⚡</span>}
                {nextCommTarget.writers != null && <span className="text-gray-400 dark:text-white/40"> · {nextCommTarget.writers} writers</span>}
              </p>
            )}
            {nextLeadTarget && (
              <p className="text-sm text-gray-500 dark:text-white/50">
                Next leadership:
                <span className="font-medium text-gray-700 dark:text-white/70"> {nextLeadTarget.level}</span>
                {nextLeadTarget.regular != null && <span className="text-gray-400 dark:text-white/40"> · {fmtAPV(nextLeadTarget.regular)} reg</span>}
                {nextLeadTarget.slingshot != null && <span className="text-gray-400 dark:text-white/40"> · {fmtAPV(nextLeadTarget.slingshot)} ⚡</span>}
                {nextLeadTarget.writers != null && <span className="text-gray-400 dark:text-white/40"> · {nextLeadTarget.writers} writers</span>}
              </p>
            )}
        </div>
      )}

      {/* Promotion + leadership timelines */}
      {(commPromos.length > 0 || leadPromos.length > 0) && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/8 space-y-3">
          {commPromos.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35 mb-2">
                Promotion History
              </p>
              <div className="flex flex-wrap gap-x-1 gap-y-1 items-center">
                {commPromos.map((p, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-300 dark:text-white/15 text-xs select-none">→</span>}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/8 dark:bg-accent/12 text-xs">
                      <span className="font-semibold text-accent">Lvl {p.level}</span>
                      <span className="text-gray-400 dark:text-white/35">{fmtDate(p.qualified_date)}</span>
                      {p.is_slingshot && <span className="text-yellow-500">⚡</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {leadPromos.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35 mb-2">
                Leadership Titles
              </p>
              <div className="flex flex-wrap gap-x-1 gap-y-1 items-center">
                {leadPromos.map((p, i) => (
                  <div key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-300 dark:text-white/15 text-xs select-none">→</span>}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/8 dark:bg-purple-500/12 text-xs">
                      <span className="font-semibold text-purple-600 dark:text-purple-400">
                        {TITLE_LABELS[String(p.level).toUpperCase()] ?? String(p.level).toUpperCase()}
                      </span>
                      <span className="text-gray-400 dark:text-white/35">{fmtDate(p.qualified_date)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

// ─── Section 2: Production Summary ────────────────────────────────────────────

function ProductionSummary({ policies, period, isDark }) {
  const cc          = chartColors(isDark)
  const periodLabel = PERIOD_PRESETS.find(p => p.key === period.preset)?.label ?? 'Period'

  // All stats driven by the period selector
  const periodPols  = policies.filter(p => inPeriod(p.submit_date, period))
  const submAPV     = periodPols.reduce((s, p) => s + (p.submitted_apv ?? 0), 0)
  const issdAPV     = periodPols.filter(p => p.status === 'Issued').reduce((s, p) => s + (p.issued_apv ?? 0), 0)
  const cntSubm     = periodPols.length
  const cntIssd     = periodPols.filter(p => p.status === 'Issued').length
  const avgAPV      = cntSubm > 0 ? Math.round(submAPV / cntSubm) : null

  // Carrier breakdown (issued APV by carrier, period-filtered)
  const carrierTotals = {}
  for (const p of periodPols.filter(p => p.status === 'Issued' && p.carrier)) {
    carrierTotals[p.carrier] = (carrierTotals[p.carrier] ?? 0) + (p.issued_apv ?? 0)
  }
  const carrierData = Object.entries(carrierTotals)
    .map(([carrier, apv]) => ({ carrier, apv }))
    .sort((a, b) => b.apv - a.apv)

  // Product mix donut (period-filtered, issued only, by subtype from crosswalk)
  const periodIssued  = periodPols.filter(p => p.status === 'Issued')
  const subtypeTotals = {}
  for (const p of periodIssued) {
    if (!p.subtype) continue
    subtypeTotals[p.subtype] = (subtypeTotals[p.subtype] ?? 0) + (p.issued_apv ?? 0)
  }
  const unclassified = periodIssued.filter(p => !p.subtype).length
  const donutTotal   = Object.values(subtypeTotals).reduce((s, v) => s + v, 0)
  const donutEntries = groupWithOther(
    Object.entries(subtypeTotals).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    donutTotal
  )

  return (
    <div className="space-y-5">
      {/* Period-driven metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard label="Submitted APV"      primary={fmtAPV(submAPV)} sub1={periodLabel} />
        <MetricCard label="Issued APV"         primary={fmtAPV(issdAPV)} sub1={periodLabel} />
        <MetricCard label="Apps Submitted"     primary={cntSubm}         sub1={periodLabel} />
        <MetricCard label="Policies Issued"    primary={cntIssd}         sub1={periodLabel} />
        <MetricCard label="Avg APV per Policy" primary={avgAPV != null ? fmtAPV(avgAPV) : '—'} sub1={periodLabel} />
      </div>

      {/* Carrier breakdown + product mix side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Carrier breakdown */}
        <SectionCard title={`Issued APV by Carrier — ${periodLabel}`}>
          {carrierData.length === 0 ? (
            <EmptySection message="No issued policies in the selected period" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, carrierData.length * 36)}>
              <BarChart data={carrierData} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={fmtAPVShort} tick={{ fontSize: 10, fill: cc.text }} />
                <YAxis type="category" dataKey="carrier" tick={{ fontSize: 11, fill: cc.text }} width={100} />
                <Tooltip formatter={v => fmtAPV(v)} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="apv" name="Issued APV" fill={ISSUED_COLOR} radius={[0, 3, 3, 0]} maxBarSize={18}
                  label={{ position: 'right', formatter: fmtAPVShort, fontSize: 10, fill: cc.text }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Product mix donut */}
        <SectionCard title={`Product Mix — ${periodLabel}`}>
          {donutEntries.length === 0 ? (
            <EmptySection message={`No issued policies with subtype data${unclassified ? ` (${unclassified} unclassified)` : ''}`} />
          ) : (
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <PieChart width={160} height={160}>
                  <Pie data={donutEntries} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={72}>
                    {donutEntries.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => fmtAPV(v)} contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </div>
              <div className="flex-1 space-y-1.5 py-1 min-w-0">
                {donutEntries.map((e, i) => (
                  <div key={e.name} className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-gray-600 dark:text-white/60 truncate">{e.name}</span>
                    </div>
                    <span className="text-gray-700 dark:text-white/70 font-medium flex-shrink-0">{fmtAPV(e.value)}</span>
                  </div>
                ))}
                {unclassified > 0 && (
                  <p className="text-xs text-gray-400 dark:text-white/30 pt-1">{unclassified} unclassified</p>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Section 3: Policy Metrics ─────────────────────────────────────────────────

function PolicyMetrics({ policies, period, isDark }) {
  const cc = chartColors(isDark)

  // Period-filtered for placement rate and avg issue time
  const periodPols = policies.filter(p => inPeriod(p.submit_date, period))

  const issued   = periodPols.filter(p => p.status === 'Issued').length
  const countable = periodPols.filter(p => !['Declined','Withdrawn','Not Taken'].includes(p.status)).length
  const placementRate = pct(issued, countable)

  // Avg issue time (submit → issue, same period)
  const issueTimes = periodPols
    .filter(p => p.issue_date && p.submit_date)
    .map(p => {
      const d = Math.round((new Date(p.issue_date) - new Date(p.submit_date)) / 86400000)
      return d >= 0 ? d : null
    })
    .filter(d => d !== null)
  const avgIssueTime = issueTimes.length
    ? Math.round(issueTimes.reduce((s, d) => s + d, 0) / issueTimes.length)
    : null

  // Persistency — always 12-month all-time window (ignores period selector)
  const yearAgo    = oneYearAgo()
  const totalIssued = policies.filter(p => p.status === 'Issued').length
  const lapsedIn1yr = policies.filter(p =>
    ['Lapsed','Cancelled'].includes(p.status) && p.issue_date && p.issue_date >= yearAgo
  ).length
  const persistency = totalIssued > 0 ? Math.round((1 - lapsedIn1yr / totalIssued) * 100) : null

  // Placement rate trend — 12 months rolling (fixed, not period-filtered)
  const monthBuckets = build12MonthBuckets()
  const trendData = monthBuckets.map(b => {
    const bucket    = policies.filter(p => p.submit_date >= b.start && p.submit_date <= b.end)
    const bIssued   = bucket.filter(p => p.status === 'Issued').length
    const bCounted  = bucket.filter(p => !['Declined','Withdrawn','Not Taken'].includes(p.status)).length
    return { month: b.label, 'Placement %': bCounted ? Math.round((bIssued / bCounted) * 100) : null }
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Placement Rate"
          primary={fmtPct(placementRate)}
          sub1={`${issued} issued / ${countable} submitted`}
          sub2="(selected period)"
        />
        <MetricCard
          label="Persistency Rate"
          primary={fmtPct(persistency)}
          sub1={`${lapsedIn1yr} lapsed within 12 mo of issue`}
          sub2="(always all-time 12-month)"
        />
        <MetricCard
          label="Avg Issue Time"
          primary={fmtDays(avgIssueTime)}
          sub1={issueTimes.length ? `from ${issueTimes.length} issued policies` : 'No issued policies'}
          sub2="(submit → issue)"
        />
      </div>

      <SectionCard title="Placement Rate Trend — 12 Months">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: cc.text }} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: cc.text }} width={36} />
            <Tooltip formatter={v => v != null ? `${v}%` : '—'} contentStyle={{ fontSize: 12 }} />
            <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '70% benchmark', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
            <Line type="monotone" dataKey="Placement %" stroke={SUBMITTED_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

// ─── Section 4: Lead & Conversion Metrics ──────────────────────────────────────

function LeadMetrics({ leads, policies, period, isDark }) {
  const cc = chartColors(isDark)

  const insuranceLeads = leads.filter(l => l.category !== 'recruiting')
  const periodLeads = insuranceLeads.filter(l => inPeriod(l.added, period))

  if (!periodLeads.length && !insuranceLeads.length) {
    return <EmptySection message="No lead data available for this agent." />
  }

  // Lead-to-app conversion proxy: policies submitted within 30 days of a lead received
  const ytd = ytdRange()
  const ytdLeads = insuranceLeads.filter(l => inPeriod(l.added, ytd))
  const ytdPolicies = policies.filter(p => inPeriod(p.submit_date, ytd))

  // Conversion rate for period: count policies submitted within 30 days of period leads
  let approxApps = 0
  for (const lead of periodLeads) {
    const leadDate = new Date(lead.added)
    const cutoff   = new Date(leadDate); cutoff.setDate(leadDate.getDate() + 30)
    const match    = ytdPolicies.some(p => {
      const sd = new Date(p.submit_date)
      return sd >= leadDate && sd <= cutoff
    })
    if (match) approxApps++
  }
  const convRate = pct(approxApps, periodLeads.length)

  // Lead volume by source (period)
  const sourceCounts = {}
  for (const l of periodLeads) {
    const s = l.source || 'Unknown'
    sourceCounts[s] = (sourceCounts[s] ?? 0) + 1
  }

  // Conversion rate per source
  const sourceConv = {}
  for (const l of insuranceLeads) {
    const s = l.source || 'Unknown'
    if (!sourceConv[s]) sourceConv[s] = { leads: 0, apps: 0 }
    sourceConv[s].leads++
    const leadDate = new Date(l.added)
    const cutoff   = new Date(leadDate); cutoff.setDate(leadDate.getDate() + 30)
    const hasApp   = policies.some(p => {
      const sd = new Date(p.submit_date)
      return sd >= leadDate && sd <= cutoff
    })
    if (hasApp) sourceConv[s].apps++
  }

  const hBarData = Object.entries(sourceConv)
    .map(([source, { leads, apps }]) => ({
      source,
      convPct: pct(apps, leads) ?? 0,
      leads,
    }))
    .sort((a, b) => b.convPct - a.convPct)

  const donutTotal   = Object.values(sourceCounts).reduce((s, v) => s + v, 0)
  const donutEntries = groupWithOther(
    Object.entries(sourceCounts).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value),
    donutTotal
  )

  function convColor(val) {
    if (val >= 20) return '#22c55e'
    if (val >= 10) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Leads Received"
          primary={periodLeads.length}
          sub1={`${ytdLeads.length} YTD`}
          sub2="(selected period)"
        />
        <MetricCard
          label="Lead-to-App Rate"
          primary={fmtPct(convRate)}
          sub1={`~${approxApps} apps from ${periodLeads.length} leads`}
          sub2="(30-day proxy)"
        />
        <MetricCard
          label="Lead Sources"
          primary={Object.keys(sourceCounts).length}
          sub1={`${Object.keys(sourceCounts).join(', ')}`}
          sub2="active sources"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Conversion by source */}
        <SectionCard title="Conversion Rate by Source">
          {hBarData.length === 0 ? <EmptySection message="No source data" /> : (
            <ResponsiveContainer width="100%" height={Math.max(160, hBarData.length * 36)}>
              <BarChart data={hBarData} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
                <XAxis type="number" domain={[0,100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: cc.text }} />
                <YAxis type="category" dataKey="source" tick={{ fontSize: 11, fill: cc.text }} width={80} />
                <Tooltip formatter={v => `${v}%`} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="convPct" name="Conv. Rate" radius={[0,3,3,0]} maxBarSize={18}>
                  {hBarData.map((e, i) => <Cell key={i} fill={convColor(e.convPct)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Volume by source donut */}
        <SectionCard title="Lead Volume by Source">
          {donutEntries.length === 0 ? <EmptySection message="No source data" /> : (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={donutEntries} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {donutEntries.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1 w-full">
                {donutEntries.map((e, i) => (
                  <div key={e.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-gray-600 dark:text-white/60">{e.name}</span>
                    </div>
                    <span className="text-gray-700 dark:text-white/70 font-medium">{e.value} leads</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

// ─── Section 5: Activity Metrics ──────────────────────────────────────────────

function ActivityMetrics({ activity, period, isDark }) {
  const cc = chartColors(isDark)

  if (!activity.length) {
    return (
      <EmptySection
        message="This agent is not currently tracking activity. Encourage them to log daily numbers in the Activity Tracker."
      />
    )
  }

  const periodLogs = activity.filter(l => inPeriod(l.log_date, period))

  if (!periodLogs.length) {
    return <EmptySection message="No activity logged in the selected period." />
  }

  const sum = (key) => periodLogs.reduce((s, l) => s + (l[key] ?? 0), 0)
  const days  = periodLogs.length
  const dials = sum('dials'), contacts = sum('contacts')
  const apptsSet = sum('appts_set'), apptsKept = sum('appts_kept')
  const appsWritten = sum('apps_written')

  const contactRate  = pct(contacts,    dials)
  const apptSetRate  = pct(apptsSet,    contacts)
  const apptRunRate  = pct(apptsKept,   apptsSet)
  const closeRate    = pct(appsWritten, apptsKept)

  const avg = (val) => days ? (val / days).toFixed(1) : '—'

  // 12-week trend
  const weekBuckets = build12WeekBuckets()
  const trendData = weekBuckets.map(b => {
    const bucket = activity.filter(l => l.log_date >= b.start && l.log_date <= b.end)
    return {
      week:      b.label,
      Dials:     bucket.reduce((s,l) => s + (l.dials      ?? 0), 0),
      Contacts:  bucket.reduce((s,l) => s + (l.contacts   ?? 0), 0),
      'Appts Set': bucket.reduce((s,l) => s + (l.appts_set ?? 0), 0),
    }
  })

  return (
    <div className="space-y-5">
      {/* Ratio cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Contact Rate"   primary={fmtPct(contactRate)}  sub1={`${contacts} contacts / ${dials} dials`}        />
        <MetricCard label="Appt Set Rate"  primary={fmtPct(apptSetRate)}  sub1={`${apptsSet} set / ${contacts} contacts`}       />
        <MetricCard label="Appt Run Rate"  primary={fmtPct(apptRunRate)}  sub1={`${apptsKept} run / ${apptsSet} set`}           />
        <MetricCard label="Close Rate"     primary={fmtPct(closeRate)}    sub1={`${appsWritten} apps / ${apptsKept} appts run`} />
      </div>

      {/* Daily avg cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Dials / Day"     primary={avg(dials)}     sub1={`${days} days logged`} />
        <MetricCard label="Contacts / Day"  primary={avg(contacts)}  />
        <MetricCard label="Appts Set / Day" primary={avg(apptsSet)}  />
        <MetricCard label="Appts Run / Day" primary={avg(apptsKept)} />
      </div>

      {/* 12-week trend chart */}
      <SectionCard title="Activity Trend — Last 12 Weeks">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: cc.text }} />
            <YAxis tick={{ fontSize: 10, fill: cc.text }} width={32} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Dials"       stroke={LINE_COLORS[0]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Contacts"    stroke={LINE_COLORS[1]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Appts Set"   stroke={LINE_COLORS[2]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

// ─── Section 6: Promotion History ─────────────────────────────────────────────

function PromotionHistory({ promotions }) {
  if (!promotions.length) {
    return <EmptySection message="No promotions recorded yet." />
  }

  const commission = promotions
    .filter(p => p.promotion_type === 'commission' && p.qualified_date)
    .sort((a, b) => a.qualified_date.localeCompare(b.qualified_date))

  const named = promotions.filter(p => p.promotion_type !== 'commission')

  // Avg time between promotions
  let avgGapMonths = null
  let trajectory = null
  if (commission.length >= 2) {
    const gaps = []
    for (let i = 1; i < commission.length; i++) {
      const prev = new Date(commission[i-1].qualified_date)
      const curr = new Date(commission[i].qualified_date)
      gaps.push((curr - prev) / (1000 * 60 * 60 * 24 * 30))
    }
    avgGapMonths = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)

    // Trajectory
    const last2 = gaps.slice(-2)
    if (last2.length >= 2) {
      const diff = last2[1] - last2[0]
      if (diff < -2) trajectory = 'Accelerating'
      else if (diff > 2) trajectory = 'Stalling'
      else trajectory = 'Steady'
    }
    // Override: if last promotion > 6 months ago and no partial work in progress
    if (commission.length > 0) {
      const lastPromoDate = new Date(commission[commission.length - 1].qualified_date)
      const monthsSince   = (Date.now() - lastPromoDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      const partialPromo  = promotions.find(p => p.promotion_type === 'commission' && p.month_1 && !p.month_2 && !p.qualified_date)
      if (monthsSince > 6 && !partialPromo) trajectory = 'Stalled'
    }
  }

  const lastPromo = commission[commission.length - 1]
  const monthsAgoLast = lastPromo?.qualified_date
    ? Math.round((Date.now() - new Date(lastPromo.qualified_date).getTime()) / (1000 * 60 * 60 * 24 * 30))
    : null

  const trajectoryStyle = {
    Accelerating: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10',
    Steady:       'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
    Stalling:     'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10',
    Stalled:      'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
  }

  return (
    <div className="space-y-5">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard
          label="Time Between Promotions"
          primary={avgGapMonths != null ? `Avg: ${avgGapMonths} months` : '—'}
          sub1={commission.length >= 2 ? `Based on ${commission.length - 1} promotion gap${commission.length > 2 ? 's' : ''}` : 'Need 2+ promotions'}
        />
        <MetricCard
          label="Last Promoted"
          primary={lastPromo ? `${monthsAgoLast} months ago` : '—'}
          sub1={lastPromo ? `Level ${lastPromo.level} on ${fmtDate(lastPromo.qualified_date)}` : ''}
        />
      </div>

      {/* Trajectory indicator */}
      {trajectory && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold ${trajectoryStyle[trajectory]}`}>
          <span className="text-lg">
            {trajectory === 'Accelerating' ? '↑' : trajectory === 'Stalled' ? '⚠' : trajectory === 'Stalling' ? '↓' : '→'}
          </span>
          <span>Trajectory: {trajectory}</span>
          {trajectory === 'Stalled' && (
            <span className="font-normal opacity-70">— no qualifying activity and last promotion was {monthsAgoLast}+ months ago</span>
          )}
        </div>
      )}

      {/* Commission promotion timeline */}
      {commission.length > 0 && (
        <div className="space-y-3">
          {commission.map((p, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-accent flex-shrink-0 mt-1" />
                {i < commission.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 dark:bg-white/10 mt-1" />}
              </div>
              <div className="pb-4 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {p.qualified_date ? fmtDate(p.qualified_date) : 'Pending'} — Level {p.level}
                  </p>
                  {p.is_slingshot && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 font-semibold">
                      SLINGSHOT ⚡
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
                  {[p.month_1 && `Month 1: ${fmtDate(p.month_1)}`, p.month_2 && `Month 2: ${fmtDate(p.month_2)}`, p.month_3 && `Month 3: ${fmtDate(p.month_3)}`].filter(Boolean).join(' · ') || 'No month data'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Named milestones */}
      {named.length > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-white/8">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2">Named Milestones</p>
          <div className="flex flex-wrap gap-2">
            {named.map((p, i) => (
              <div key={i} className="px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/5 text-sm">
                <span className="font-semibold text-gray-700 dark:text-white/80">{String(p.level).toUpperCase()}</span>
                {p.qualified_date && <span className="text-gray-400 dark:text-white/40 ml-1.5">· {fmtDate(p.qualified_date)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section 7: Contracting Status ────────────────────────────────────────────

function ContractingStatus({ agent, contracts, carriers }) {
  const [tableOpen, setTableOpen] = useState(false)

  const received   = carriers.filter(c => contracts[c.name]?.contract_number)
  const totalCount = carriers.length
  const today      = new Date()

  const contractReqDate = agent.contracting_to_producer
    ? fmtDate(agent.contracting_to_producer)
    : 'Not requested'

  // E&O indicator: no_eando=true means they have no E&O on file
  const hasEandO   = !agent.no_eando
  const eandoLabel = hasEandO ? 'E&O on File' : 'No E&O on File'
  const eandoStyle = hasEandO
    ? 'text-green-600 dark:text-green-400'
    : 'text-red-600 dark:text-red-400'
  const eandoBg    = hasEandO
    ? 'bg-green-50 dark:bg-green-500/10'
    : 'bg-red-50 dark:bg-red-500/10'

  function carrierStatus(carrier) {
    const cn = contracts[carrier.name]
    if (cn?.contract_number) return { label: 'Received ✓', color: 'text-green-600 dark:text-green-400' }
    const reqDate = agent.contracting_to_producer ? new Date(agent.contracting_to_producer) : null
    if (!reqDate) return { label: 'Not requested', color: 'text-gray-400 dark:text-white/30' }
    const daysElapsed = Math.floor((today - reqDate) / 86400000)
    const threshold   = carrier.alert_threshold_days ?? 30
    if (daysElapsed >= threshold) return { label: `Overdue ${daysElapsed}d`, color: 'text-red-600 dark:text-red-400' }
    return { label: `Pending ${daysElapsed}d`, color: 'text-yellow-600 dark:text-yellow-400' }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Contracting requested */}
        <MetricCard label="Contracting Requested" primary={contractReqDate} />

        {/* E&O indicator */}
        <CardShell className={`p-4 ${eandoBg}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">E&O Status</p>
          <p className={`text-lg font-bold ${eandoStyle}`}>{eandoLabel}</p>
        </CardShell>

        {/* Contract numbers — caret toggles the table */}
        <CardShell className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">Contract Numbers</p>
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {received.length} <span className="text-base font-normal text-gray-400 dark:text-white/40">of {totalCount}</span>
            </p>
            <button
              onClick={() => setTableOpen(o => !o)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400 dark:text-white/40"
              aria-label={tableOpen ? 'Collapse contract details' : 'Expand contract details'}
            >
              <svg className={`w-4 h-4 transition-transform ${tableOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all"
              style={{ width: totalCount ? `${(received.length / totalCount) * 100}%` : '0%' }} />
          </div>
        </CardShell>
      </div>

      {/* Collapsible carrier table */}
      {tableOpen && (
        <CardShell className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/8">
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Carrier</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Contract #</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {carriers.map(c => {
                const cn = contracts[c.name]
                const st = carrierStatus(c)
                return (
                  <tr key={c.name} className="hover:bg-gray-50 dark:hover:bg-white/3">
                    <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-white/80">{c.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-white/50 font-mono text-xs">{cn?.contract_number ?? '—'}</td>
                    <td className={`px-4 py-2.5 text-xs font-medium ${st.color}`}>{st.label}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardShell>
      )}
    </div>
  )
}

// ─── Section 8: Pending Policies ──────────────────────────────────────────────

function PendingPolicies({ policies }) {
  const pending = policies
    .filter(p => ['Pending','Incomplete'].includes(p.status) && p.submit_date)
    .map(p => ({
      ...p,
      daysPending: Math.floor((Date.now() - new Date(p.submit_date).getTime()) / 86400000),
    }))
    .sort((a, b) => b.daysPending - a.daysPending)

  const [tooltip, setTooltip] = useState(null)

  const mo    = monthRange()
  const subMo = policies.filter(p => p.submit_date >= mo.start && p.submit_date <= mo.end).length
  const issMo = policies.filter(p => p.status === 'Issued' && p.issue_date >= mo.start && p.issue_date <= mo.end).length

  if (!pending.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-green-600 dark:text-green-400">
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm font-medium">No pending applications — all clear</p>
        <p className="text-xs text-gray-400 dark:text-white/30">{subMo} submitted this month · {issMo} issued · 0 pending</p>
      </div>
    )
  }

  function dayColor(days) {
    if (days > 30) return 'text-red-600 dark:text-red-400 font-semibold'
    if (days >= 14) return 'text-yellow-600 dark:text-yellow-400 font-medium'
    return 'text-gray-500 dark:text-white/50'
  }

  return (
    <div className="space-y-4 relative">
      <CardShell className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-white/8">
              {['Applicant','Carrier','Submit Date','Last Updated','Days Pending'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-white/5">
            {pending.map(p => (
              <tr
                key={p.id}
                className="hover:bg-gray-50 dark:hover:bg-white/3 cursor-default"
                onMouseEnter={e => p.application_notes && setTooltip({ text: p.application_notes, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
              >
                <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-white/80">{p.applicant ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-600 dark:text-white/60">{p.carrier ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-white/50 whitespace-nowrap">{fmtDate(p.submit_date)}</td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-white/50 whitespace-nowrap">{fmtDate(p.last_update)}</td>
                <td className={`px-4 py-2.5 whitespace-nowrap ${dayColor(p.daysPending)}`}>{p.daysPending} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardShell>
      <p className="text-xs text-gray-400 dark:text-white/30 px-1">
        {subMo} submitted this month · {issMo} issued · {pending.length} pending
      </p>
      {tooltip && (
        <div
          className="fixed z-50 max-w-xs bg-gray-900 dark:bg-black/90 text-white text-xs px-3 py-2 rounded-lg shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

// ─── Section: Project 100 ─────────────────────────────────────────────────────

const P100_PIPELINE_KEYS = new Set(['contacted', 'appt_booked', 'presentation'])

function Project100Section({ entries }) {
  const total = entries.length
  const pct100 = Math.min(100, Math.round((total / 100) * 100))

  const cutoff14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  let inPipeline = 0, sold = 0, enrolled = 0, referralGiven = 0, needsTouch = 0
  for (const e of entries) {
    if (P100_PIPELINE_KEYS.has(e.status)) inPipeline++
    if (e.status === 'sold')     sold++
    if (e.status === 'enrolled') enrolled++
    if (e.referral_given)        referralGiven++
    const sinceCreated = new Date(e.created_at) < cutoff14
    const sinceTouched = new Date(e.status_updated_at || e.created_at) < cutoff14
    if ((e.status === 'new' && sinceCreated) || (P100_PIPELINE_KEYS.has(e.status) && sinceTouched)) needsTouch++
  }

  if (!total) {
    return <EmptySection message="No Project 100 entries yet for this agent." />
  }

  return (
    <div className="space-y-4">
      {/* X / 100 readout */}
      <div className="flex items-center gap-4">
        <div>
          <span className="text-3xl font-bold text-gray-900 dark:text-white">{total}</span>
          <span className="text-lg text-gray-400 dark:text-white/40 font-normal"> / 100</span>
        </div>
        <div className="flex-1 max-w-xs">
          <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct100}%` }} />
          </div>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-1">{pct100}% of goal</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'In Pipeline',    value: inPipeline,   color: 'text-violet-600 dark:text-violet-400' },
          { label: 'Sold',           value: sold,         color: 'text-green-600 dark:text-green-400' },
          { label: 'Enrolled',       value: enrolled,     color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Referral Given', value: referralGiven,color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Needs a Touch',  value: needsTouch,   color: needsTouch > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-white/30', urgent: needsTouch > 0 },
        ].map(s => (
          <CardShell key={s.label} className={`p-3 text-center ${s.urgent ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20' : ''}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </CardShell>
        ))}
      </div>
    </div>
  )
}

// ─── Section: 90-Day Plan ──────────────────────────────────────────────────────

const PLAN_SECTIONS = [
  { title: 'Vision', fields: [
    { key: 'vision_said_yes',            label: 'Why did you say yes?' },
    { key: 'vision_no_longer_settle',    label: 'What will you no longer settle for?' },
    { key: 'vision_90_days_different',   label: 'What is different in 90 days?' },
    { key: 'vision_doing_for_whom',      label: 'What are you doing and for whom?' },
    { key: 'vision_one_year_looks_like', label: 'What does one year look like?' },
  ]},
  { title: 'Professional Path', fields: [
    { key: 'path_milestone_90_days', label: '90-day milestone' },
    { key: 'path_org_one_year',      label: 'Org in one year' },
    { key: 'path_skill_change',      label: 'Skill to change' },
  ]},
  { title: 'Commitment', fields: [
    { key: 'commitment_non_negotiables', label: 'Non-negotiables' },
    { key: 'commitment_give_up',         label: 'What will you give up?' },
    { key: 'commitment_keep_going',      label: 'What keeps you going?' },
  ]},
  { title: 'Support & Accountability', fields: [
    { key: 'support_accountability_partner', label: 'Accountability partner' },
    { key: 'support_coaching_style',         label: 'Coaching style preference' },
  ]},
]

function planLabel(plan) {
  if (!plan?.start_date) return 'Plan'
  const fmt = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return plan.end_date ? `${fmt(plan.start_date)} – ${fmt(plan.end_date)}` : fmt(plan.start_date)
}

function NinetyDayPlanSection({ plans }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [modalOpen,   setModalOpen]   = useState(false)

  if (!plans.length) {
    return <EmptySection message="No 90-Day Plans on file for this agent." />
  }

  const plan = plans[selectedIdx] ?? plans[0]
  const dayOf = (() => {
    if (!plan?.start_date) return null
    const start = new Date(plan.start_date + 'T00:00:00')
    const today = new Date()
    const diff  = Math.floor((today - start) / 86400000) + 1
    return Math.max(1, Math.min(diff, 90))
  })()

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        {plans.length > 1 && (
          <select
            value={selectedIdx}
            onChange={e => setSelectedIdx(Number(e.target.value))}
            className="rounded-lg border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-sm text-gray-700 dark:text-white px-3 py-1.5 focus:outline-none"
          >
            {plans.map((p, i) => (
              <option key={p.id} value={i}>{planLabel(p)}</option>
            ))}
          </select>
        )}
        {plans.length === 1 && (
          <span className="text-sm text-gray-600 dark:text-white/60 font-medium">
            Started {planLabel(plan)}
          </span>
        )}
        {dayOf != null && (
          <span className="text-sm text-gray-400 dark:text-white/40">Day {dayOf} of 90</span>
        )}
        {plan.signed_at && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 font-semibold">Signed</span>
        )}
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          View Plan
        </button>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">90-Day Plan</h2>
                <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
                  {planLabel(plan)}{dayOf != null ? ` · Day ${dayOf} of 90` : ''}
                  {plan.signed_at ? ' · Signed' : ''}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-6">
              {PLAN_SECTIONS.map(section => (
                <div key={section.title}>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-accent mb-3">{section.title}</h3>
                  <div className="space-y-3">
                    {section.fields.map(f => {
                      const val = plan[f.key]
                      if (!val) return null
                      return (
                        <div key={f.key}>
                          <p className="text-[11px] font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wide mb-0.5">{f.label}</p>
                          <p className="text-sm text-gray-700 dark:text-white/80 whitespace-pre-wrap">{val}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {PLAN_SECTIONS.every(s => s.fields.every(f => !plan[f.key])) && (
                <p className="text-sm text-gray-400 dark:text-white/40 text-center py-4">No responses recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Section 9: Recruiting & Downline ─────────────────────────────────────────

function RecruitingDownline({ downline, downlinePolicies, agentPolicies = [], period }) {
  const periodLabel = PERIOD_PRESETS.find(p => p.key === period.preset)?.label ?? 'Period'

  if (!downline.length) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-white/30 bg-gray-50 dark:bg-white/3 rounded-xl border border-dashed border-gray-200 dark:border-white/10">
        This agent has not yet hired anyone.
      </div>
    )
  }

  const now90 = new Date(); now90.setDate(now90.getDate() - 90)
  const cutoff90 = toYMD(now90)

  // Per-agent rollups
  const agentProd = {}
  for (const pol of downlinePolicies) {
    if (!agentProd[pol.sfg_id]) agentProd[pol.sfg_id] = { submAPV: 0, issdAPV: 0, cntSubm: 0, cntIssd: 0, active: false }
    if (inPeriod(pol.submit_date, period)) {
      agentProd[pol.sfg_id].submAPV  += pol.submitted_apv ?? 0
      agentProd[pol.sfg_id].cntSubm  += 1
      if (pol.status === 'Issued') {
        agentProd[pol.sfg_id].issdAPV += pol.issued_apv ?? 0
        agentProd[pol.sfg_id].cntIssd += 1
      }
    }
    if (pol.status === 'Issued' && pol.issue_date >= cutoff90) agentProd[pol.sfg_id].active = true
  }

  // Agent's own production in period (included in team totals)
  const selfProd = { submAPV: 0, issdAPV: 0, cntSubm: 0, cntIssd: 0 }
  for (const pol of agentPolicies) {
    if (inPeriod(pol.submit_date, period)) {
      selfProd.submAPV += pol.submitted_apv ?? 0
      selfProd.cntSubm += 1
      if (pol.status === 'Issued') {
        selfProd.issdAPV += pol.issued_apv ?? 0
        selfProd.cntIssd += 1
      }
    }
  }

  // Period-filtered roster stats
  const hiredInPeriod    = downline.filter(a => inPeriod(a.hire_date, period))
  const writersInPeriod  = downline.filter(a => (agentProd[a.sfg_id]?.cntSubm ?? 0) > 0)
  // "New writer" = wrote in period but had no prior production before the period start
  const agentsWithPrior  = new Set(
    period.preset === 'all' ? [] :
    downlinePolicies.filter(p => p.submit_date < period.start).map(p => p.sfg_id)
  )
  const newWriters       = writersInPeriod.filter(a => !agentsWithPrior.has(a.sfg_id))
  const returningWriters = writersInPeriod.filter(a =>  agentsWithPrior.has(a.sfg_id))

  // Team totals (downline + agent themselves)
  const totalHired    = downline.length
  const last90Count   = downline.filter(a => a.hire_date >= cutoff90).length
  const activeWriters = downline.filter(a => agentProd[a.sfg_id]?.active).length
  const teamSubmAPV   = Object.values(agentProd).reduce((s, v) => s + v.submAPV, 0) + selfProd.submAPV
  const teamIssdAPV   = Object.values(agentProd).reduce((s, v) => s + v.issdAPV, 0) + selfProd.issdAPV
  const teamCntSubm   = Object.values(agentProd).reduce((s, v) => s + v.cntSubm, 0) + selfProd.cntSubm
  const teamCntIssd   = Object.values(agentProd).reduce((s, v) => s + v.cntIssd, 0) + selfProd.cntIssd
  const teamAvgAPV    = teamCntSubm > 0 ? Math.round(teamSubmAPV / teamCntSubm) : null

  return (
    <div className="space-y-5">
      {/* Roster overview — all time */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35 mb-3">
          All Time
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard label="Agents Hired"     primary={totalHired}                sub1="all time" />
          <MetricCard label="Active Writers"   primary={activeWriters}             sub1="issued policy in last 90 days" />
          <MetricCard label="Inactive Writers" primary={totalHired - activeWriters} sub1="no recent production" />
        </div>
      </div>

      {/* Roster overview — selected period */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35 mb-3">
          {periodLabel}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard label="Hired"              primary={hiredInPeriod.length}    sub1={periodLabel} />
          <MetricCard label="New Writers"        primary={newWriters.length}       sub1="first production ever" />
          <MetricCard label="Returning Writers"  primary={returningWriters.length} sub1="prior production on record" />
        </div>
      </div>

      {/* Team production — mirrors the agent production cards */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/35 mb-3">
          Team Production — {periodLabel}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard label="Submitted APV"      primary={fmtAPV(teamSubmAPV)}                            sub1={periodLabel} />
          <MetricCard label="Issued APV"         primary={fmtAPV(teamIssdAPV)}                            sub1={periodLabel} />
          <MetricCard label="Apps Submitted"     primary={teamCntSubm}                                    sub1={periodLabel} />
          <MetricCard label="Policies Issued"    primary={teamCntIssd}                                    sub1={periodLabel} />
          <MetricCard label="Avg APV per Policy" primary={teamAvgAPV != null ? fmtAPV(teamAvgAPV) : '—'} sub1={periodLabel} />
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const LEADER_ROLES = new Set(['leader', 'owner', 'director', 'super_admin'])

export default function CoachingPage() {
  const { userProfile, session } = useAuth()
  const { activeSubject, isSelf } = useViewing()
  const { theme }                = useTheme()
  const isDark                   = theme === 'dark'
  const token                    = session?.access_token

  const [agents,        setAgents]        = useState([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [selectedSfgId, setSelectedSfgId] = useState(() => sessionStorage.getItem('coaching-agent') ?? '')
  const [period,        setPeriod]        = useState(() => computePeriod('month'))
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [qualMap,       setQualMap]       = useState({})

  // Role guard
  if (userProfile && !LEADER_ROLES.has(userProfile.role)) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-400 dark:text-white/40">
          Access restricted to leaders and above.
        </p>
      </main>
    )
  }

  // ── Load downline for agent selector ──────────────────────────────────────
  // When viewing as another user, load their downline instead of ours
  const rootSfgId = (!isSelf && activeSubject?.sfg_id) ? activeSubject.sfg_id : userProfile?.sfg_id

  useEffect(() => {
    if (!rootSfgId || !token) return
    setAgentsLoading(true)
    fetch(`/api/personnel?root=${encodeURIComponent(rootSfgId)}&mode=master`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(rows => {
        const rootUpper = rootSfgId.toUpperCase()
        const list = (Array.isArray(rows) ? rows : [])
          .filter(a => a.sfg_id.toUpperCase() !== rootUpper)
          .map(a => ({
            sfg_id:           a.sfg_id,
            name:             a.name || a.preferred_name || '',
            hire_date:        a.hire_date || '',
            status:           a.status   || 'Active',
            upline_name:      a.upline_name || '',
            commission_level: commissionLevelFromMilestones(a.milestones),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        setAgents(list)
      })
      .catch(err => console.error('[coaching/agents]', err))
      .finally(() => setAgentsLoading(false))
  }, [rootSfgId, token])

  // ── Load coaching data when agent selected ────────────────────────────────
  useEffect(() => {
    if (!selectedSfgId || !token) { setData(null); return }
    setLoading(true)
    setError(null)
    fetch(`/api/coaching?sfg_id=${encodeURIComponent(selectedSfgId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => { if (!r.ok) { const t = await r.text(); throw new Error(t || r.status) } return r.json() })
      .then(d => setData(d))
      .catch(err => setError(err.message ?? 'Failed to load agent data'))
      .finally(() => setLoading(false))
  }, [selectedSfgId, token])

  // ── Load qualifications (cached on server; fetch once) ───────────────────
  useEffect(() => {
    if (!token) return
    fetch('/api/activity?type=qualifications', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.qualifications) setQualMap(d.qualifications) })
      .catch(() => {})
  }, [token])

  function handleSelect(sfgId) {
    sessionStorage.setItem('coaching-agent', sfgId)
    setSelectedSfgId(sfgId)
  }

  const SECTIONS = [
    { id: 'header',      label: 'Agent Overview',            show: true                   },
    { id: 'production',  label: 'Production Summary',        show: true                   },
    { id: 'policy',      label: 'Policy Metrics',            show: true                   },
    { id: 'leads',       label: 'Lead & Conversion Metrics', show: true                   },
    { id: 'activity',    label: 'Activity Metrics',          show: true                   },
    { id: 'promotions',  label: 'Promotion History',         show: true                   },
    { id: 'contracting', label: 'Contracting Status',        show: true                   },
    { id: 'pending',     label: 'Pending Policies',          show: true                   },
    { id: 'downline',    label: 'Recruiting & Downline',     show: true                   },
  ]

  return (
    <>
    {/* ── Sticky period bar (fixed below app header, desktop accounts for sidebar) */}
    {selectedSfgId && data && (
      <div className="fixed top-14 left-0 lg:left-56 right-0 z-20
                      bg-white/90 dark:bg-primary/90 backdrop-blur-sm
                      border-b border-gray-200 dark:border-white/10
                      px-4 sm:px-6 py-2 flex items-center gap-3">
        <span className="text-xs text-gray-400 dark:text-white/40 truncate hidden sm:block max-w-[160px]">
          {data.agent.name}
        </span>
        <span className="text-gray-200 dark:text-white/10 hidden sm:block select-none">|</span>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>
    )}

    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5"
          style={{ paddingTop: selectedSfgId && data ? '3.5rem' : undefined }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Coaching</h1>
          {agentsLoading ? (
            <div className="w-full max-w-lg h-[52px] bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />
          ) : (
            <AgentSelector
              agents={agents}
              selectedSfgId={selectedSfgId}
              onSelect={handleSelect}
            />
          )}
        </div>
      </div>

      {/* ── No agent selected ───────────────────────────────────────────────── */}
      {!selectedSfgId && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-400 dark:text-white/30">
          <svg className="w-14 h-14 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-base font-medium">Select an agent to begin</p>
          <p className="text-sm text-center max-w-xs">
            {agents.length > 0
              ? `${agents.length} agent${agents.length !== 1 ? 's' : ''} in your downline`
              : 'No agents found in your downline'}
          </p>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {selectedSfgId && loading && <Spinner />}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {selectedSfgId && !loading && error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-600 dark:text-red-400">
          Failed to load agent data: {error}
        </div>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────────── */}
      {selectedSfgId && !loading && data && (() => {
        // ── Compute next commission target ──────────────────────────────────
        const currCommLevel = data.agent.commission_level  // e.g. 100 (number or null)
        const nextCommLevel = CONTRACT_LEVELS.find(l => currCommLevel == null ? true : l > currCommLevel) ?? null
        const nextCommTarget = nextCommLevel != null && qualMap[String(nextCommLevel)]
          ? { level: nextCommLevel, ...qualMap[String(nextCommLevel)] }
          : null

        // ── Compute next leadership target ─────────────────────────────────
        const leaderPromos = (data.promotions ?? [])
          .filter(p => p.promotion_type === 'leadership' && p.qualified_date)
        const highestLeadLevel = LEADERSHIP_ORDER.reduce((found, lv) => {
          return leaderPromos.some(p => String(p.level).toUpperCase() === lv) ? lv : found
        }, null)
        const nextLeadLevel = highestLeadLevel == null
          ? LEADERSHIP_ORDER[0]
          : LEADERSHIP_ORDER[LEADERSHIP_ORDER.indexOf(highestLeadLevel) + 1] ?? null
        const nextLeadTarget = nextLeadLevel != null && qualMap[nextLeadLevel]
          ? { level: nextLeadLevel, ...qualMap[nextLeadLevel] }
          : null

        return (
        <div className="space-y-6">

          {/* 1. Agent Header (includes promotion history) */}
          <AgentHeader
            agent={data.agent}
            promotions={data.promotions}
            nextCommTarget={nextCommTarget}
            nextLeadTarget={nextLeadTarget}
          />

          {/* 2. 90-Day Plan */}
          <SectionCard title="90-Day Plan">
            <NinetyDayPlanSection plans={data.ninetyDays ?? []} />
          </SectionCard>

          {/* 3. Production Summary */}
          <SectionCard title="Production Summary">
            <ProductionSummary policies={data.policies} period={period} isDark={isDark} />
          </SectionCard>

          {/* 3. Policy Metrics */}
          <SectionCard title="Policy Metrics">
            <PolicyMetrics policies={data.policies} period={period} isDark={isDark} />
          </SectionCard>

          {/* 4. Lead & Conversion Metrics */}
          <SectionCard title="Lead & Conversion Metrics">
            <LeadMetrics leads={data.leads} policies={data.policies} period={period} isDark={isDark} />
          </SectionCard>

          {/* 5. Activity Metrics */}
          <SectionCard title="Activity Metrics">
            <ActivityMetrics activity={data.activity} period={period} isDark={isDark} />
          </SectionCard>

          {/* 6. Project 100 */}
          <SectionCard title="Project 100">
            <Project100Section entries={data.project100 ?? []} />
          </SectionCard>

          {/* 8. Contracting Status */}
          <SectionCard title="Contracting Status">
            <ContractingStatus agent={data.agent} contracts={data.contracts} carriers={data.carriers} />
          </SectionCard>

          {/* 9. Pending Policies */}
          <SectionCard title="Pending Policies">
            <PendingPolicies policies={data.policies} />
          </SectionCard>

          {/* 10. Recruiting & Downline */}
          <SectionCard title="Recruiting & Downline">
            <RecruitingDownline
              downline={data.downline}
              downlinePolicies={data.downlinePolicies}
              agentPolicies={data.policies}
              period={period}
            />
          </SectionCard>

        </div>
        )
      })()}
    </main>
    </>
  )
}
