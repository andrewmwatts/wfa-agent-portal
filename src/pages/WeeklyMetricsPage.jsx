import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../../shared/agencyScope'
import { teamCreditedAmount } from '../../shared/policySplit'

function isTruthy(val) {
  if (!val) return false
  const v = val.trim().toLowerCase()
  return v !== '' && v !== 'false' && v !== '0' && v !== 'no' && v !== 'n'
}

function parseAmt(v) {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

function parseWeekDate(str) {
  if (!str) return null
  // Parse YYYY-MM-DD as local midnight to avoid UTC→local day shift
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

// Most-recent Sunday at midnight
function currentWeekStart() {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtApv(n) {
  if (!n && n !== 0) return '$0'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtWeekDate(str) {
  if (!str) return '—'
  const d = parseWeekDate(str)
  if (!d) return str
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
}

// ─── Weekly aggregation ───────────────────────────────────────────────────────

function buildWeekly(policies, scopeIds) {
  if (!policies.length) return []

  // Compute each agent's earliest-ever in-OPT submit_week (= the week they first wrote)
  const earliestWeek = {}
  for (const p of policies) {
    if (!p.sfg_id || !p.submit_week || p.not_in_opt) continue
    const id = p.sfg_id.toLowerCase()
    if (!earliestWeek[id] || p.submit_week < earliestWeek[id]) earliestWeek[id] = p.submit_week
  }

  const byWeek = {}  // submit_week string → bucket

  for (const p of policies) {
    const wk = p.submit_week
    if (!wk) continue
    const d = parseWeekDate(wk)
    if (!d) continue

    if (!byWeek[wk]) byWeek[wk] = { date: d, apv: 0, agents: new Set(), newAgents: new Set() }
    const b = byWeek[wk]
    // Only the in-scope agents' shares of a split sale; writers is the primary.
    b.apv += teamCreditedAmount(p, scopeIds, 'subm_apv')
    if (p.sfg_id) {
      const id = p.sfg_id.toLowerCase()
      // An agent whose every submission this week is flagged "not in Opt"
      // doesn't count toward Total Writers or New Writers; one in-Opt app is enough.
      if (!p.not_in_opt) {
        b.agents.add(id)
        if (earliestWeek[id] === wk) b.newAgents.add(id)
      }
    }
  }

  return Object.entries(byWeek)
    .map(([wk, b]) => ({
      submit_week:   wk,
      date:          b.date,
      apv:           Math.round(b.apv * 100) / 100,
      total_writers: b.agents.size,
      new_writers:   b.newAgents.size,
    }))
    .sort((a, b) => b.date - a.date)   // newest first
}

const TOP_N = 20
const PHONE_WEEKS = 26

const SORT_OPTIONS = [
  { id: 'apv',           label: 'APV' },
  { id: 'total_writers', label: 'Total Writers' },
  { id: 'new_writers',   label: 'New Writers' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyMetricsPage() {
  const { activeSubject, permissions } = useViewing()
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [policies, setPolicies]     = useState([])
  // Agents in the selected scope — split shares held outside it don't count here
  const [scopeIds, setScopeIds]     = useState([])
  const [metrics, setMetrics]               = useState(null)
  const [masterPersonnel, setMasterPersonnel] = useState([])
  const [loading, setLoading]               = useState(false)
  const [selectedScope, setSelectedScope]   = useState('master')
  const [topSort, setTopSort]       = useState('apv')
  const [showAllWeeks, setShowAllWeeks] = useState(false)



  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    const enc = encodeURIComponent(sfgId)
    try {
      // personnel+policies and apps all fire in parallel — apps resolves its own
      // team tree internally via root= so it doesn't wait for personnel to finish.
      const [teamRes, appsRes] = await Promise.all([
        fetch(`/api/personnel?root=${enc}&mode=master&include=policies`),
        fetch(`/api/policies?type=apps&root=${enc}&mode=master`),
      ])
      if (!teamRes.ok) return
      const { personnel: masterPersonnel, policies: rows } = await teamRes.json()
      const { metrics: m } = appsRes.ok ? await appsRes.json() : {}

      setMasterPersonnel(masterPersonnel)
      setSelectedScope('master')
      setPolicies(rows ?? [])
      setScopeIds((masterPersonnel ?? []).map(p => p.sfg_id))
      setMetrics(m ?? null)
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
      await loadData(scoped)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function loadData(personnel) {
    const sfgIds = personnel.map(p => p.sfg_id)
    if (!sfgIds.length) { setPolicies([]); setScopeIds([]); setMetrics(null); return }

    // Fetch policies and metrics in parallel
    const [polRes, appsRes] = await Promise.all([
      fetch(`/api/policies?sfg_ids=${sfgIds.join(',')}`),
      fetch(`/api/policies?type=apps&sfg_ids=${sfgIds.join(',')}`),
    ])

    const { policies: rows } = polRes.ok ? await polRes.json() : {}
    const { metrics: m }     = appsRes.ok ? await appsRes.json() : {}
    setPolicies(rows ?? [])
    setScopeIds(sfgIds)
    setMetrics(m ?? null)
  }

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const weeks = useMemo(() => buildWeekly(policies, scopeIds), [policies, scopeIds])

  // Week-boundary helpers
  const ws  = useMemo(() => currentWeekStart(), [])
  const lws = useMemo(() => { const d = new Date(ws); d.setDate(d.getDate() - 7); return d }, [ws])
  const wEnd = useMemo(() => { const d = new Date(ws); d.setDate(d.getDate() + 7); return d }, [ws])

  function weekTag(row) {
    const d = row.date
    if (d >= ws && d < wEnd) return 'current'
    if (d >= lws && d < ws)  return 'last'
    return null
  }

  // Top 20 sorted by selected field
  const top20 = useMemo(() => {
    return [...weeks]
      .sort((a, b) => b[topSort] - a[topSort])
      .slice(0, TOP_N)
  }, [weeks, topSort])

  if (!permissions.metrics.read) return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <p className="text-sm text-red-600 dark:text-red-400">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-500 dark:text-white/50 text-sm">Please sign in to view metrics.</p>
    </div>
  )

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-5 sm:space-y-8">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 sm:gap-4">
        <h1 className="text-[22px] sm:text-xl font-bold text-gray-900 dark:text-white min-w-0 truncate">Weekly Metrics</h1>
        {isDirector && (
          <ScopeDropdown
            masterPersonnel={masterPersonnel}
            selfId={activeSubject?.sfg_id}
            value={selectedScope}
            onChange={handleScopeChange}
          />
        )}
      </div>

      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-36 bg-gray-100 dark:bg-white/10 rounded-2xl" />
            <div className="h-36 bg-gray-100 dark:bg-white/10 rounded-2xl" />
          </div>
          <div className="h-80 bg-gray-100 dark:bg-white/10 rounded-2xl" />
          <div className="h-96 bg-gray-100 dark:bg-white/10 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* ── This Week / Last Week cards ────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <WeekCard
              label="This Week"
              apv={metrics?.submWeek}
              newWriters={metrics?.newWritersWeek}
              totalWriters={metrics?.totalWritersWeek}
            />
            <WeekCard
              label="Last Week"
              apv={metrics?.submLW}
              newWriters={metrics?.newWritersLW}
              totalWriters={metrics?.totalWritersLW}
            />
          </div>

          {/* ── Top 20 ─────────────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70">
                Top {TOP_N} Weeks
              </h2>
              <div className="flex items-center gap-2 max-sm:w-full">
                <span className="text-xs text-gray-600 dark:text-white/50 whitespace-nowrap">Sort by</span>
                <div className="flex rounded-lg max-sm:rounded-xl overflow-hidden border border-gray-200 dark:border-white/15 max-sm:flex-1">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setTopSort(opt.id)}
                      aria-pressed={topSort === opt.id}
                      className={`px-3 py-1 max-sm:px-1 max-sm:flex-1 max-sm:h-11 touch:sm:min-h-[44px] text-xs font-medium transition-colors ${
                        topSort === opt.id
                          ? 'bg-primary text-white dark:bg-white dark:text-primary'
                          : 'text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <WeekList rows={top20} tagFor={weekTag} ranked />

            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 pl-5 py-3 w-8">#</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">Submit Week</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">APV</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">Total Writers</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 pr-5 py-3">New Writers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {top20.map((r, i) => {
                  const tag = weekTag(r)
                  const rowCls = tag === 'current' ? 'bg-accent/5'
                    : tag === 'last' ? 'bg-gray-50 dark:bg-white/[0.03]'
                    : ''
                  return (
                    <tr key={r.submit_week} className={rowCls}>
                      <td className="px-5 pl-5 py-2.5 text-xs tabular-nums text-gray-500 dark:text-white/50">{i + 1}</td>
                      <td className="px-5 py-2.5">
                        <span className="text-sm text-gray-900 dark:text-white tabular-nums">{fmtWeekDate(r.submit_week)}</span>
                        {tag && (
                          <span className={`ml-2 text-xs font-medium ${tag === 'current' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/50'}`}>
                            {tag === 'current' ? 'this week' : 'last week'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-right text-sm tabular-nums text-gray-700 dark:text-white/80 font-medium">
                        {fmtApv(r.apv)}
                      </td>
                      <td className="px-5 py-2.5 text-right text-sm tabular-nums text-gray-700 dark:text-white/80">
                        {r.total_writers}
                      </td>
                      <td className="px-5 pr-5 py-2.5 text-right text-sm tabular-nums text-gray-700 dark:text-white/80">
                        {r.new_writers}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── All Weeks ──────────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70">All Weeks</h2>
            </div>
            <WeekList rows={showAllWeeks ? weeks : weeks.slice(0, PHONE_WEEKS)} tagFor={weekTag} />
            {weeks.length > PHONE_WEEKS && (
              <button
                onClick={() => setShowAllWeeks(v => !v)}
                className="md:hidden w-full h-12 border-t border-gray-100 dark:border-white/10 text-sm font-semibold text-gray-800 dark:text-white"
              >
                {showAllWeeks ? 'Show recent weeks only' : `Show all ${weeks.length} weeks`}
              </button>
            )}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10">
                    <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">Submit Week</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">APV</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 py-3">Total Writers</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-5 pr-5 py-3">New Writers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {weeks.map(r => {
                    const tag = weekTag(r)
                    const rowCls = tag === 'current' ? 'bg-accent/5'
                      : tag === 'last' ? 'bg-gray-50 dark:bg-white/[0.03]'
                      : ''
                    return (
                      <tr key={r.submit_week} className={rowCls}>
                        <td className="px-5 py-2 text-sm text-gray-900 dark:text-white tabular-nums">
                          {fmtWeekDate(r.submit_week)}
                          {tag && (
                            <span className={`ml-2 text-xs font-medium ${tag === 'current' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/50'}`}>
                              {tag === 'current' ? 'this week' : 'last week'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2 text-right text-sm tabular-nums text-gray-700 dark:text-white/80">
                          {fmtApv(r.apv)}
                        </td>
                        <td className="px-5 py-2 text-right text-sm tabular-nums text-gray-700 dark:text-white/80">
                          {r.total_writers}
                        </td>
                        <td className="px-5 pr-5 py-2 text-right text-sm tabular-nums text-gray-700 dark:text-white/80">
                          {r.new_writers}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  )
}

// ─── Phone list (the tables take over from md) ───────────────────────────────

function WeekList({ rows, tagFor, ranked = false }) {
  return (
    <ul className="md:hidden divide-y divide-gray-100 dark:divide-white/5">
      {rows.map((r, i) => {
        const tag = tagFor(r)
        const rowCls = tag === 'current' ? 'bg-accent/5' : tag === 'last' ? 'bg-gray-50 dark:bg-white/[0.03]' : ''
        return (
          <li key={r.submit_week} className={`flex items-center gap-3 px-4 py-3 ${rowCls}`}>
            {ranked && <span className="w-6 shrink-0 text-sm tabular-nums text-gray-500 dark:text-white/50">{i + 1}</span>}
            <div className="flex-1 min-w-0">
              <p className="text-base font-medium text-gray-900 dark:text-white tabular-nums">
                {fmtWeekDate(r.submit_week)}
                {tag && (
                  <span className={`ml-2 text-xs font-medium ${tag === 'current' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/50'}`}>
                    {tag === 'current' ? 'this week' : 'last week'}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-600 dark:text-white/55 mt-0.5">
                {r.total_writers} writer{r.total_writers === 1 ? '' : 's'} · {r.new_writers} new
              </p>
            </div>
            <span className="shrink-0 text-base font-semibold tabular-nums text-gray-900 dark:text-white">{fmtApv(r.apv)}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Week Card ────────────────────────────────────────────────────────────────

function WeekCard({ label, apv, newWriters, totalWriters }) {
  return (
    <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 mb-4">{label}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <WeekStat label="Submitted APV"  value={fmtApv(apv)} large />
        <WeekStat label="Total Writers"  value={totalWriters ?? '—'} />
        <WeekStat label="New Writers"    value={newWriters ?? '—'} />
      </div>
    </div>
  )
}

function WeekStat({ label, value, large }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-white/50 mb-0.5">{label}</p>
      <p className={`font-bold tabular-nums text-gray-900 dark:text-white ${large ? 'text-2xl' : 'text-xl'}`}>
        {value}
      </p>
    </div>
  )
}
