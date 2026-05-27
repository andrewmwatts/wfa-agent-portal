import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOwnerRecord(p) {
  const ao = p.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

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

function buildWeekly(policies) {
  if (!policies.length) return []

  // Compute each agent's earliest-ever submit_week (= the week they first wrote)
  const earliestWeek = {}
  for (const p of policies) {
    if (!p.sfg_id || !p.submit_week) continue
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
    b.apv += parseAmt(p.subm_apv)
    if (p.sfg_id) {
      const id = p.sfg_id.toLowerCase()
      b.agents.add(id)
      // New writer = this is the agent's first-ever submission week
      if (earliestWeek[id] === wk) b.newAgents.add(id)
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

const SORT_OPTIONS = [
  { id: 'apv',           label: 'APV' },
  { id: 'total_writers', label: 'Total Writers' },
  { id: 'new_writers',   label: 'New Writers' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeeklyMetricsPage() {
  const { activeSubject } = useViewing()
  const { theme } = useTheme()

  const [policies, setPolicies]     = useState([])
  const [metrics, setMetrics]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [mode, setMode]             = useState('baseshop')
  const [isDirector, setIsDirector] = useState(false)
  const [topSort, setTopSort]       = useState('apv')

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      const masterRes = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master`)
      const masterPersonnel = masterRes.ok ? await masterRes.json() : []

      const root  = sfgId.toLowerCase()
      const isDir = masterPersonnel.some(p => p.sfg_id?.toLowerCase() !== root && isOwnerRecord(p))
      setIsDirector(isDir)
      setMode(isDir ? 'master' : 'baseshop')

      await loadData(masterPersonnel)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function handleModeChange(newMode) {
    if (!activeSubject?.sfg_id) return
    setMode(newMode)
    setLoading(true)
    try {
      const modeParam = newMode === 'master' ? '&mode=master' : ''
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(activeSubject.sfg_id)}${modeParam}`)
      const personnel = res.ok ? await res.json() : []
      await loadData(personnel)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function loadData(personnel) {
    const sfgIds = personnel.map(p => p.sfg_id)
    if (!sfgIds.length) { setPolicies([]); setMetrics(null); return }

    // Fetch policies and metrics in parallel
    const [polRes, appsRes] = await Promise.all([
      fetch(`/api/policies?sfg_ids=${sfgIds.join(',')}`),
      fetch(`/api/policies?type=apps&sfg_ids=${sfgIds.join(',')}`),
    ])

    const { policies: rows } = polRes.ok ? await polRes.json() : {}
    const { metrics: m }     = appsRes.ok ? await appsRes.json() : {}
    setPolicies(rows ?? [])
    setMetrics(m ?? null)
  }

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const weeks = useMemo(() => buildWeekly(policies), [policies])

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

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view metrics.</p>
    </div>
  )

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Weekly Metrics</h1>
        {isDirector && (
          <select
            value={mode}
            onChange={e => handleModeChange(e.target.value)}
            className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="master"   style={optionStyle}>Master Agency</option>
            <option value="baseshop" style={optionStyle}>My Baseshop</option>
          </select>
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70">
                Top {TOP_N} Weeks
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-white/40">Sort by</span>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/15">
                  {SORT_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setTopSort(opt.id)}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        topSort === opt.id
                          ? 'bg-accent text-white'
                          : 'text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 pl-5 py-3 w-8">#</th>
                  <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">Submit Week</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">APV</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">Total Writers</th>
                  <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 pr-5 py-3">New Writers</th>
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
                      <td className="px-5 pl-5 py-2.5 text-xs tabular-nums text-gray-400 dark:text-white/30">{i + 1}</td>
                      <td className="px-5 py-2.5">
                        <span className="text-sm text-gray-900 dark:text-white tabular-nums">{fmtWeekDate(r.submit_week)}</span>
                        {tag && (
                          <span className={`ml-2 text-xs font-medium ${tag === 'current' ? 'text-accent' : 'text-gray-400 dark:text-white/40'}`}>
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
            <div className="px-5 py-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70">All Weeks</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10">
                    <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">Submit Week</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">APV</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3">Total Writers</th>
                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 pr-5 py-3">New Writers</th>
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
                            <span className={`ml-2 text-xs font-medium ${tag === 'current' ? 'text-accent' : 'text-gray-400 dark:text-white/40'}`}>
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

// ─── Week Card ────────────────────────────────────────────────────────────────

function WeekCard({ label, apv, newWriters, totalWriters }) {
  return (
    <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4">{label}</p>
      <div className="flex flex-wrap gap-6">
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
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`font-bold tabular-nums text-gray-900 dark:text-white ${large ? 'text-2xl' : 'text-xl'}`}>
        {value}
      </p>
    </div>
  )
}
