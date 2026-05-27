import { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, BarChart, Bar, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOwnerRecord(p) {
  const ao = p.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

function parseAmt(v) {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

function toYearMonth(dateStr) {
  if (!dateStr) return null
  // Parse YYYY-MM-DD as local date to avoid UTC→local day shift
  const iso = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}`
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym) {
  const [y, m] = ym.split('-')
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[parseInt(m, 10) - 1]} ${y}`
}

// Count Fridays in a given YYYY-MM (matches the "Weeks" convention in the source data)
function weeksInMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  let count = 0
  const d = new Date(y, m - 1, 1)
  while (d.getMonth() === m - 1) {
    if (d.getDay() === 5) count++   // Friday = 5
    d.setDate(d.getDate() + 1)
  }
  return count
}

function fmtApv(n) {
  if (!n) return '$0'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtApvShort(n) {
  if (!n && n !== 0) return ''
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`
}

const FINAL_STATUSES = new Set(['issued','declined','not taken','withdrawn','cancelled','lapsed'])

// ─── Monthly aggregation ──────────────────────────────────────────────────────

function buildMonthly(policies) {
  if (!policies.length) return []

  const now      = new Date()
  const curYM    = toYearMonth(now.toISOString().slice(0, 10))

  // First submission month per agent (for New Writers) — keyed by submit_week only
  const agentFirst = {}
  for (const p of policies) {
    const ym = toYearMonth(p.submit_week)
    if (!ym || !p.sfg_id) continue
    const id = p.sfg_id.toLowerCase()
    if (!agentFirst[id] || ym < agentFirst[id]) agentFirst[id] = ym
  }

  // Per-month buckets
  const byMonth = {}
  const ensure  = ym => {
    if (!byMonth[ym]) byMonth[ym] = { subm: 0, iss: 0, pending: 0, agents: new Set() }
    return byMonth[ym]
  }

  for (const p of policies) {
    // Submitted APV and agent tracking keyed by submit_week month only
    const submYM = toYearMonth(p.submit_week)
    if (submYM) {
      const b = ensure(submYM)
      b.subm += parseAmt(p.subm_apv)
      if (p.sfg_id) b.agents.add(p.sfg_id.toLowerCase())
      if (submYM === curYM && !FINAL_STATUSES.has(p.status?.toLowerCase() ?? '')) {
        b.pending += parseAmt(p.subm_apv)
      }
    }

    if (p.status?.toLowerCase() === 'issued') {
      const issYM = toYearMonth(p.issue_date) ?? submYM
      if (issYM) ensure(issYM).iss += parseAmt(p.issued_apv)
    }
  }

  const allYMs = Object.keys(byMonth).sort()

  // Rolling 6-month close rate for projection
  const recent = allYMs.filter(ym => ym < curYM).slice(-6)
  const rSubm  = recent.reduce((s, ym) => s + byMonth[ym].subm, 0)
  const rIss   = recent.reduce((s, ym) => s + byMonth[ym].iss,  0)
  const rate   = rSubm > 0 ? rIss / rSubm : 0.75

  return allYMs.map(ym => {
    const b        = byMonth[ym]
    const submApv  = Math.round(b.subm)
    const issApv   = Math.round(b.iss)
    const isCur    = ym === curYM
    const projApv  = isCur ? Math.round(issApv + b.pending * rate) : issApv
    const newW     = Object.values(agentFirst).filter(f => f === ym).length
    const closeRate = submApv > 0 ? issApv / submApv : 0

    return {
      year_month:    ym,
      label:         monthLabel(ym),
      new_writers:   newW,
      total_writers: b.agents.size,
      subm_apv:      submApv,
      iss_apv:       issApv,
      proj_iss_apv:  projApv,
      close_rate:    closeRate,
      weeks:         weeksInMonth(ym),
      is_current:    isCur,
    }
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MonthlyMetricsPage() {
  const { activeSubject } = useViewing()
  const { theme } = useTheme()

  const [policies, setPolicies]       = useState([])
  const [loading, setLoading]         = useState(false)
  const [mode, setMode]               = useState('baseshop')
  const [isDirector, setIsDirector]   = useState(false)

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      const masterRes = await fetch(`/api/personnel-data?root=${encodeURIComponent(sfgId)}&mode=master`)
      const masterPersonnel = masterRes.ok ? await masterRes.json() : []

      const root  = sfgId.toLowerCase()
      const isDir = masterPersonnel.some(p => p.sfg_id?.toLowerCase() !== root && isOwnerRecord(p))
      setIsDirector(isDir)
      setMode(isDir ? 'master' : 'baseshop')

      await loadPolicies(masterPersonnel)
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
      const res = await fetch(`/api/personnel-data?root=${encodeURIComponent(activeSubject.sfg_id)}${modeParam}`)
      const personnel = res.ok ? await res.json() : []
      await loadPolicies(personnel)
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
    setPolicies(rows ?? [])
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const monthly = useMemo(() => buildMonthly(policies), [policies])

  // Table: newest first
  const tableRows  = useMemo(() => [...monthly].reverse(), [monthly])
  // Charts: oldest first (chronological)
  const chartData  = monthly

  // Max values for green highlight (exclude current month from max so projections don't skew)
  const completedRows  = tableRows.filter(r => !r.is_current)
  const maxNewWriters  = Math.max(0, ...completedRows.map(r => r.new_writers))
  const maxTotalWriters = Math.max(0, ...completedRows.map(r => r.total_writers))
  const maxSubmApv     = Math.max(0, ...completedRows.map(r => r.subm_apv))
  const maxIssApv      = Math.max(0, ...completedRows.map(r => r.iss_apv))

  // X-axis interval: show every Nth label to avoid crowding
  const xInterval  = chartData.length > 36 ? 5
    : chartData.length > 18 ? 2
    : 1

  // ── Chart theme tokens ────────────────────────────────────────────────────
  const textColor    = theme === 'dark' ? 'rgba(255,255,255,0.4)' : '#9ca3af'
  const gridColor    = theme === 'dark' ? 'rgba(255,255,255,0.08)' : '#e5e7eb'
  const cardBg       = theme === 'dark' ? '#002e33' : '#ffffff'   // fill to hide area below issued line
  const tooltipStyle = {
    backgroundColor: theme === 'dark' ? '#003539' : '#ffffff',
    border:          theme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e5e7eb',
    borderRadius:    '8px',
    color:           theme === 'dark' ? 'white' : '#111827',
    fontSize:        '12px',
  }
  const legendStyle = { fontSize: '12px', color: theme === 'dark' ? 'rgba(255,255,255,0.6)' : '#374151' }

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view metrics.</p>
    </div>
  )

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Monthly Metrics</h1>
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
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-72 bg-gray-100 dark:bg-white/10 rounded-2xl" />
            <div className="h-72 bg-gray-100 dark:bg-white/10 rounded-2xl" />
          </div>
          <div className="h-96 bg-gray-100 dark:bg-white/10 rounded-2xl" />
        </div>
      ) : monthly.length === 0 ? (
        <p className="text-gray-400 dark:text-white/30 text-sm">No policy data found.</p>
      ) : (
        <>
          {/* ── Charts ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* APV by Month */}
            <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-4">APV by Month</h2>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={xInterval}
                  />
                  <YAxis
                    tickFormatter={fmtApvShort}
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val, name) => [fmtApv(val), name]}
                  />
                  <Legend wrapperStyle={legendStyle} iconType="line" />

                  {/* Gap shading: light orange fill under submitted, card-color fill under issued */}
                  <Area type="monotone" dataKey="subm_apv" stroke="none" fill="#f97316" fillOpacity={0.12} legendType="none" name=" " />
                  <Area type="monotone" dataKey="iss_apv"  stroke="none" fill={cardBg}  fillOpacity={1}    legendType="none" name="  " />

                  {/* Lines */}
                  <Line type="monotone" dataKey="subm_apv"     stroke="#f97316" strokeWidth={2} dot={false} name="Submitted APV" />
                  <Line type="monotone" dataKey="iss_apv"      stroke="#3b82f6" strokeWidth={2} dot={false} name="Issued APV" />
                  <Line type="monotone" dataKey="proj_iss_apv" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Projected Issued APV" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Writers by Month */}
            <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-4">Writers by Month</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={xInterval}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: textColor, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={legendStyle} />
                  <Bar dataKey="total_writers" name="Total Writers" fill="#f97316" fillOpacity={0.85} radius={[2,2,0,0]} />
                  <Bar dataKey="new_writers"   name="New Writers"   fill="#3b82f6" fillOpacity={0.85} radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Table ──────────────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-white/10">
                    {[
                      { label: 'Month',          cls: 'w-28' },
                      { label: 'Submitted APV',  cls: 'text-right' },
                      { label: 'Issued APV',     cls: 'text-right' },
                      { label: 'Close Rate',     cls: 'text-right w-28' },
                      { label: 'Total Writers',  cls: 'text-right w-28' },
                      { label: 'New Writers',    cls: 'text-right w-28' },
                      { label: 'Weeks',          cls: 'text-right w-20' },
                    ].map(h => (
                      <th
                        key={h.label}
                        className={`text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3 first:pl-6 last:pr-6 whitespace-nowrap ${h.cls ?? ''}`}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {tableRows.map(r => {
                    const ratePct = r.close_rate * 100
                    const rateCls = ratePct >= 80
                      ? 'text-green-600 dark:text-green-400'
                      : ratePct >= 60
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-red-500 dark:text-red-400'
                    const rowCls = r.is_current ? 'bg-accent/5' : ''

                    // Green highlight helpers — only highlight completed months
                    const isMax = (val, max) => !r.is_current && max > 0 && val === max
                    const maxCls  = 'bg-green-500/10 text-green-700 dark:text-green-400 font-semibold'
                    const normCls = 'text-gray-700 dark:text-white/80'

                    return (
                      <tr key={r.year_month} className={rowCls}>
                        {/* Month */}
                        <td className="px-5 pl-6 py-2.5">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {r.label}
                          </span>
                          {r.is_current && (
                            <span className="ml-2 text-xs text-accent font-medium">current</span>
                          )}
                        </td>

                        {/* Submitted APV */}
                        <td className={`px-5 py-2.5 text-right text-sm tabular-nums ${isMax(r.subm_apv, maxSubmApv) ? maxCls : normCls}`}>
                          {fmtApv(r.subm_apv)}
                        </td>

                        {/* Issued APV */}
                        <td className={`px-5 py-2.5 text-right text-sm tabular-nums ${isMax(r.iss_apv, maxIssApv) ? maxCls : normCls}`}>
                          {fmtApv(r.iss_apv)}
                          {r.is_current && r.proj_iss_apv > r.iss_apv && (
                            <span className="block text-xs text-gray-400 dark:text-white/30">
                              proj. {fmtApv(r.proj_iss_apv)}
                            </span>
                          )}
                        </td>

                        {/* Close Rate */}
                        <td className={`px-5 py-2.5 text-right text-sm tabular-nums font-medium ${rateCls}`}>
                          {r.subm_apv > 0 ? fmtPct(r.close_rate) : '—'}
                        </td>

                        {/* Total Writers */}
                        <td className={`px-5 py-2.5 text-right text-sm tabular-nums ${isMax(r.total_writers, maxTotalWriters) ? maxCls : normCls}`}>
                          {r.total_writers}
                        </td>

                        {/* New Writers */}
                        <td className={`px-5 py-2.5 text-right text-sm tabular-nums ${isMax(r.new_writers, maxNewWriters) ? maxCls : normCls}`}>
                          {r.new_writers}
                        </td>

                        {/* Weeks */}
                        <td className="px-5 pr-6 py-2.5 text-right text-sm tabular-nums text-gray-500 dark:text-white/50">
                          {r.weeks}
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
