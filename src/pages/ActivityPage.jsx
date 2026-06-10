import { useCallback, useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'

// ─── Metric definitions ────────────────────────────────────────────────────────

const METRICS = [
  { key: 'dials',        label: 'Dials',            short: 'Dials',     accent: 'text-blue-500   dark:text-blue-400'   },
  { key: 'hours_dialed', label: 'Hours Dialed',      short: 'Hours',     accent: 'text-indigo-500 dark:text-indigo-400', step: '0.5', decimal: true },
  { key: 'contacts',     label: 'Contacts',          short: 'Contacts',  accent: 'text-teal-600   dark:text-teal-400'   },
  { key: 'appts_set',    label: 'Appts Set',         short: 'Set',       accent: 'text-violet-500 dark:text-violet-400' },
  { key: 'appts_kept',   label: 'Appts Kept',        short: 'Kept',      accent: 'text-purple-500 dark:text-purple-400' },
  { key: 'resets',       label: 'Resets',            short: 'Resets',    accent: 'text-green-600  dark:text-green-400'  },
  { key: 'reachouts',    label: 'Reachouts',         short: 'Reachouts', accent: 'text-cyan-600   dark:text-cyan-400'   },
  { key: 'posts',        label: 'Social Media Post', short: 'Social',    accent: 'text-pink-500   dark:text-pink-400'   },
]

// Display-only derived rows (not logged to activity_logs)
const DERIVED_ROWS = [
  { key: 'apps_written', label: 'Apps Written',  accent: 'text-orange-500 dark:text-orange-400', currency: false },
  { key: 'submitted_apv', label: 'Submitted APV', accent: 'text-green-600  dark:text-green-400',  currency: true  },
  { key: 'lead_spend',   label: 'Lead Spend',    accent: 'text-red-500    dark:text-red-400',    currency: true  },
]

const METRIC_KEYS = METRICS.map(m => m.key)

const EMPTY_DRAFT = { dials: '', hours_dialed: '', reachouts: '', posts: '', contacts: '', appts_set: '', appts_kept: '', resets: '', notes: '', lead_spend: '' }

// ─── Date helpers ──────────────────────────────────────────────────────────────

function getWeekStart(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay()) // back to Sunday
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDateStr(date) {
  // local YYYY-MM-DD
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateStr(str) {
  // parse YYYY-MM-DD as local midnight (no UTC shift)
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtDayHeader(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

function fmtDayDate(date) {
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

function fmtFullDay(dateStr) {
  return parseDateStr(dateStr).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function fmtWeekRange(weekStart) {
  const end = addDays(weekStart, 6)
  return (
    weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' +
    end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  )
}

// ─── Stats range config ────────────────────────────────────────────────────────

const STAT_RANGES = [
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'year',  label: 'This Year'  },
  { key: 'all',   label: 'All Time'   },
]

// ─── Goals config ─────────────────────────────────────────────────────────────

const GOAL_FIELDS = [
  { key: 'weekly_dials',          label: 'Dials',         period: 'per week',  currency: false },
  { key: 'weekly_appts',          label: 'Appts Run',     period: 'per week',  currency: false },
  { key: 'monthly_apv_submitted', label: 'APV Submitted', period: 'per month', currency: true  },
  { key: 'monthly_apv_issued',    label: 'APV Issued',    period: 'per month', currency: true  },
]

const EMPTY_GOALS = { weekly_dials: '', weekly_appts: '', monthly_apv_submitted: '', monthly_apv_issued: '' }

function fmtGoalsMonth(ym) {
  return new Date(ym.year, ym.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function addMonths(ym, n) {
  const d = new Date(ym.year, ym.month + n, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

function toYearMonth(ym) {
  return `${ym.year}-${String(ym.month + 1).padStart(2, '0')}`
}

function fmtGoalValue(val, currency) {
  if (val === null || val === undefined || val === '') return '—'
  const n = Number(val)
  if (isNaN(n)) return '—'
  if (currency) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return n.toLocaleString('en-US')
}

function getStatDateRange(rangeKey) {
  const now = new Date()
  if (rangeKey === 'week') {
    const start = getWeekStart(now)
    return { start: toDateStr(start), end: toDateStr(addDays(start, 6)) }
  }
  if (rangeKey === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { start: toDateStr(start), end: toDateStr(end) }
  }
  if (rangeKey === 'year') {
    return {
      start: `${now.getFullYear()}-01-01`,
      end:   `${now.getFullYear()}-12-31`,
    }
  }
  return { start: null, end: null } // all time
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const { activeSubject, permissions } = useViewing()

  const [weekStart,  setWeekStart]  = useState(() => getWeekStart(new Date()))
  const [logs,       setLogs]       = useState({}) // { 'YYYY-MM-DD': row }
  const [loading,    setLoading]    = useState(false)
  const [editDate,   setEditDate]   = useState(null)
  const [draft,      setDraft]      = useState(EMPTY_DRAFT)
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState('')
  const [statsRange, setStatsRange] = useState('week')
  const [statsLogs,  setStatsLogs]  = useState([])
  const [statsLoading, setStatsLoading] = useState(false)

  // Policy and lead-spend data
  const [policies,  setPolicies]  = useState([])
  const [leadTxs,   setLeadTxs]   = useState([])

  // Goals
  const now = new Date()
  const [goalsMonth,   setGoalsMonth]   = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [goals,        setGoals]        = useState(null)   // null = loading, {} = no goals saved
  const [goalsDraft,   setGoalsDraft]   = useState(null)   // null = view mode
  const [goalsSaving,  setGoalsSaving]  = useState(false)
  const [goalsLoading, setGoalsLoading] = useState(false)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const todayStr = toDateStr(new Date())

  // ── Load week's logs ─────────────────────────────────────────────────────────
  const loadLogs = useCallback(async () => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    try {
      const start = toDateStr(days[0])
      const end   = toDateStr(days[6])
      const res = await fetch(
        `/api/activity?sfg_id=${encodeURIComponent(activeSubject.sfg_id)}&start=${start}&end=${end}`,
      )
      if (res.ok) {
        const { logs: rows } = await res.json()
        const byDate = {}
        for (const row of rows) byDate[row.log_date] = row
        setLogs(byDate)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [activeSubject?.sfg_id, days])

  useEffect(() => { loadLogs() }, [loadLogs])

  // ── Load stats range logs ────────────────────────────────────────────────────
  const loadStatsLogs = useCallback(async () => {
    if (!activeSubject?.sfg_id) return
    setStatsLoading(true)
    try {
      const { start, end } = getStatDateRange(statsRange)
      const params = new URLSearchParams({ sfg_id: activeSubject.sfg_id })
      if (start) params.set('start', start)
      if (end)   params.set('end',   end)
      const res = await fetch(`/api/activity?${params}`)
      if (res.ok) {
        const { logs: rows } = await res.json()
        setStatsLogs(rows ?? [])
      }
    } catch { /* ignore */ } finally {
      setStatsLoading(false)
    }
  }, [activeSubject?.sfg_id, statsRange])

  useEffect(() => { loadStatsLogs() }, [loadStatsLogs])

  // ── Load agent policies (for apps-written and submitted APV display) ──────────
  const loadPolicies = useCallback(async () => {
    if (!activeSubject?.sfg_id) return
    try {
      const res = await fetch(`/api/policies?sfg_ids=${encodeURIComponent(activeSubject.sfg_id)}`)
      if (res.ok) { const { policies: rows } = await res.json(); setPolicies(rows ?? []) }
    } catch { /* ignore */ }
  }, [activeSubject?.sfg_id])

  useEffect(() => { loadPolicies() }, [loadPolicies])

  // ── Load all lead-spend transactions ─────────────────────────────────────────
  const loadLeadTxs = useCallback(async () => {
    if (!activeSubject?.sfg_id) return
    try {
      const res = await fetch('/api/transactions?category=Leads')
      if (res.ok) { const { transactions } = await res.json(); setLeadTxs(transactions ?? []) }
    } catch { /* ignore */ }
  }, [activeSubject?.sfg_id])

  useEffect(() => { loadLeadTxs() }, [loadLeadTxs])

  // When a day is saved, refresh stats if it falls in the current stats window
  function refreshStatsAfterSave(dateStr) {
    const { start, end } = getStatDateRange(statsRange)
    const inRange = (!start || dateStr >= start) && (!end || dateStr <= end)
    if (inRange) loadStatsLogs()
  }

  // ── Goals load/save ──────────────────────────────────────────────────────────
  const loadGoals = useCallback(async () => {
    if (!activeSubject?.sfg_id) return
    setGoalsLoading(true)
    try {
      const res = await fetch(
        `/api/activity?type=goals&sfg_id=${encodeURIComponent(activeSubject.sfg_id)}&month=${toYearMonth(goalsMonth)}`,
      )
      if (res.ok) { const { goals: g } = await res.json(); setGoals(g ?? {}) }
    } catch { /* ignore */ } finally { setGoalsLoading(false) }
  }, [activeSubject?.sfg_id, goalsMonth])

  useEffect(() => { loadGoals() }, [loadGoals])

  async function saveGoals() {
    if (!activeSubject?.sfg_id || !goalsDraft) return
    setGoalsSaving(true)
    try {
      const res = await fetch('/api/activity?type=goals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sfg_id:     activeSubject.sfg_id,
          year_month: toYearMonth(goalsMonth),
          ...goalsDraft,
        }),
      })
      if (res.ok) { const { goals: g } = await res.json(); setGoals(g); setGoalsDraft(null) }
    } catch { /* ignore */ } finally { setGoalsSaving(false) }
  }

  // Reset edit when week changes
  useEffect(() => { setEditDate(null) }, [weekStart])

  // ── Edit helpers ─────────────────────────────────────────────────────────────
  function openEdit(dateStr) {
    const existing = logs[dateStr]
    const leadAmt  = leadsByDate[dateStr] ?? ''
    if (existing) {
      setDraft({
        dials:        existing.dials        ?? '',
        hours_dialed: existing.hours_dialed ?? '',
        reachouts:    existing.reachouts    ?? '',
        posts:        existing.posts        ?? '',
        contacts:     existing.contacts     ?? '',
        appts_set:    existing.appts_set    ?? '',
        appts_kept:   existing.appts_kept   ?? '',
        resets:       existing.resets       ?? '',
        notes:        existing.notes        ?? '',
        lead_spend:   leadAmt,
      })
    } else {
      setDraft({ ...EMPTY_DRAFT, lead_spend: leadAmt })
    }
    setEditDate(dateStr)
    setSaveError('')
  }

  function toggleEdit(dateStr) {
    if (editDate === dateStr) {
      setEditDate(null)
    } else {
      openEdit(dateStr)
    }
  }

  function setField(key, val) {
    setDraft(d => ({ ...d, [key]: val }))
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!activeSubject?.sfg_id || !editDate) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/activity', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sfg_id:       activeSubject.sfg_id,
          log_date:     editDate,
          dials:        draft.dials,
          hours_dialed: draft.hours_dialed,
          reachouts:    draft.reachouts,
          posts:        draft.posts,
          contacts:     draft.contacts,
          appts_set:    draft.appts_set,
          appts_kept:   draft.appts_kept,
          resets:       draft.resets,
          notes:        draft.notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error ?? 'Save failed'); return }
      setLogs(prev => ({ ...prev, [editDate]: data.log }))
      refreshStatsAfterSave(editDate)

      // ── Sync lead spend transaction ─────────────────────────────────────────
      // Delete all existing Leads transactions for this date, then create a new one if non-zero
      const existingLeadTxs = leadTxs.filter(tx => tx.date === editDate)
      await Promise.all(existingLeadTxs.map(tx =>
        fetch(`/api/transactions?id=${tx.id}`, { method: 'DELETE' })
      ))
      const leadAmt = parseFloat(draft.lead_spend)
      if (!isNaN(leadAmt) && leadAmt > 0) {
        await fetch('/api/transactions?force=true', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date:        editDate,
            description: 'Lead Spend',
            amount:      leadAmt,
            type:        'expense',
            category:    'Leads',
            force:       true,
          }),
        })
      }
      await loadLeadTxs()

      setEditDate(null)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Totals (for the weekly grid column) ─────────────────────────────────────
  const weekTotals = useMemo(() => {
    const t = Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))
    for (const log of Object.values(logs)) {
      for (const k of METRIC_KEYS) t[k] += log[k] ?? 0
    }
    return t
  }, [logs])

  // ── Policies keyed by submit_date ────────────────────────────────────────────
  const policiesByDate = useMemo(() => {
    const map = {}
    for (const p of policies) {
      const d = p.submit_date?.slice(0, 10)
      if (!d) continue
      ;(map[d] ??= []).push(p)
    }
    return map
  }, [policies])

  // ── Lead spend keyed by date ──────────────────────────────────────────────────
  const leadsByDate = useMemo(() => {
    const map = {}
    for (const tx of leadTxs) {
      map[tx.date] = (map[tx.date] ?? 0) + Math.abs(tx.amount)
    }
    return map
  }, [leadTxs])

  // ── Stats-range totals (for the Conversion Ratios + Totals blocks) ───────────
  const totals = useMemo(() => {
    const t = Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))
    for (const log of statsLogs) {
      for (const k of METRIC_KEYS) t[k] += log[k] ?? 0
    }
    return t
  }, [statsLogs])

  // ── Stats-range policy + lead aggregates ─────────────────────────────────────
  const { statsPolicyApps, statsPolicySubAPV, statsLeadSpend } = useMemo(() => {
    const { start, end } = getStatDateRange(statsRange)
    let apps = 0, apv = 0, leads = 0
    for (const p of policies) {
      const d = p.submit_date?.slice(0, 10)
      if (!d) continue
      if (start && d < start) continue
      if (end   && d > end)   continue
      apps++
      apv += p.submitted_apv ?? 0
    }
    for (const tx of leadTxs) {
      const d = tx.date
      if (start && d < start) continue
      if (end   && d > end)   continue
      leads += Math.abs(tx.amount)
    }
    return { statsPolicyApps: apps, statsPolicySubAPV: apv, statsLeadSpend: leads }
  }, [policies, leadTxs, statsRange])

  // ── Ratios ───────────────────────────────────────────────────────────────────
  const ratios = useMemo(() => {
    function pct(num, den) {
      if (!den) return null
      return Math.round((num / den) * 100)
    }
    const dialRate = totals.hours_dialed > 0
      ? (totals.dials / totals.hours_dialed).toFixed(1)
      : null
    const avgAPVVal = statsPolicyApps > 0 ? Math.round(statsPolicySubAPV / statsPolicyApps) : null
    const avgAPVDisplay = avgAPVVal != null ? `$${avgAPVVal.toLocaleString()}` : null
    return [
      { label: 'Dials/Hr',     display: dialRate ? `${dialRate}` : null, sub: dialRate ? `${totals.dials} dials / ${totals.hours_dialed}h` : null, title: 'Dials per hour dialed' },
      { label: 'Contact Rate', pct: pct(totals.contacts,   totals.dials),      num: totals.contacts,   den: totals.dials,      title: 'Contacts per dial'                  },
      { label: 'Appt Rate',    pct: pct(totals.appts_set,  totals.contacts),   num: totals.appts_set,  den: totals.contacts,   title: 'Appointments set per contact'       },
      { label: 'Show Rate',    pct: pct(totals.appts_kept, totals.appts_set),  num: totals.appts_kept, den: totals.appts_set,  title: 'Appointments kept per set'          },
      { label: 'Close Rate',   pct: pct(statsPolicyApps,   totals.appts_kept), num: statsPolicyApps,   den: totals.appts_kept, title: 'Apps submitted per appointment kept' },
      { label: 'Reset Rate',   pct: pct(totals.resets,     totals.appts_kept), num: totals.resets,     den: totals.appts_kept, title: 'Resets per appointment run'         },
      { label: 'Avg APV',      display: avgAPVDisplay, sub: avgAPVVal != null ? `${statsPolicyApps} apps` : null, title: 'Average submitted APV per application' },
    ]
  }, [totals, statsPolicyApps, statsPolicySubAPV])

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (!permissions.activity.read) return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to track activity.</p>
      </div>
    )
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex-1 min-w-0">
          Activity Tracking
        </h1>

        {/* Week navigation */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setWeekStart(w => addDays(w, -7))}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors text-lg leading-none"
            aria-label="Previous week"
          >
            ‹
          </button>

          <span className="text-sm font-medium text-gray-700 dark:text-white/80 min-w-[168px] text-center">
            {fmtWeekRange(weekStart)}
          </span>

          <button
            onClick={() => setWeekStart(w => addDays(w, 7))}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors text-lg leading-none"
            aria-label="Next week"
          >
            ›
          </button>

          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            This Week
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-72 bg-gray-100 dark:bg-white/10 rounded-2xl" />
          <div className="h-28 bg-gray-100 dark:bg-white/10 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* ── Weekly grid ──────────────────────────────────────────────────── */}
          <div className="bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">

                {/* Day header row */}
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/10">
                    <th className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-4 py-3 w-[110px]">
                      Metric
                    </th>

                    {days.map(day => {
                      const ds       = toDateStr(day)
                      const isToday  = ds === todayStr
                      const isEdit   = ds === editDate
                      const hasData  = !!logs[ds]

                      return (
                        <th key={ds} className="px-1.5 py-2.5 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            <span className={`block text-xs font-semibold ${isToday ? 'text-accent' : 'text-gray-500 dark:text-white/50'}`}>
                              {fmtDayHeader(day)}
                            </span>
                            <span className={`block text-[10px] tabular-nums ${isToday ? 'text-accent/70' : 'text-gray-400 dark:text-white/30'}`}>
                              {fmtDayDate(day)}
                            </span>
                            <button
                              onClick={() => toggleEdit(ds)}
                              className={`text-[10px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                                isEdit
                                  ? 'bg-accent text-white'
                                  : hasData
                                    ? 'bg-accent/10 text-accent hover:bg-accent/20 dark:bg-accent/15 dark:hover:bg-accent/25'
                                    : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-white/30 hover:bg-gray-200 dark:hover:bg-white/10'
                              }`}
                            >
                              {isEdit ? 'Close' : hasData ? 'Edit' : 'Log'}
                            </button>
                          </div>
                        </th>
                      )
                    })}

                    <th className="text-right text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-4 py-3 w-16">
                      Total
                    </th>
                  </tr>
                </thead>

                {/* Metric rows */}
                <tbody className="divide-y divide-gray-50 dark:divide-white/[0.04]">
                  {METRICS.map(metric => (
                    <tr key={metric.key} className="hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors">
                      <td className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap ${metric.accent}`}>
                        {metric.label}
                      </td>
                      {days.map(day => {
                        const ds  = toDateStr(day)
                        const val = logs[ds]?.[metric.key]
                        const hasVal = val !== undefined && val !== null && val !== 0
                        return (
                          <td key={ds} className="px-1.5 py-2.5 text-center">
                            <span className={`text-sm tabular-nums font-medium ${
                              hasVal
                                ? 'text-gray-900 dark:text-white'
                                : 'text-gray-200 dark:text-white/15'
                            }`}>
                              {hasVal ? val : '—'}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-4 py-2.5 text-right">
                        <span className={`text-sm tabular-nums font-bold ${
                          weekTotals[metric.key]
                            ? 'text-gray-900 dark:text-white'
                            : 'text-gray-300 dark:text-white/20'
                        }`}>
                          {weekTotals[metric.key] || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {/* Derived rows — sourced from policies / transactions, not activity_logs */}
                  {DERIVED_ROWS.map(row => {
                    const weekDerivedTotal = days.reduce((sum, day) => {
                      const ds = toDateStr(day)
                      if (row.key === 'apps_written') return sum + (policiesByDate[ds]?.length ?? 0)
                      if (row.key === 'submitted_apv') return sum + (policiesByDate[ds]?.reduce((s, p) => s + (p.submitted_apv ?? 0), 0) ?? 0)
                      if (row.key === 'lead_spend') return sum + (leadsByDate[ds] ?? 0)
                      return sum
                    }, 0)
                    const fmtDerived = (val, ds) => {
                      if (row.key === 'apps_written') return policiesByDate[ds]?.length || null
                      if (row.key === 'submitted_apv') {
                        const apv = policiesByDate[ds]?.reduce((s, p) => s + (p.submitted_apv ?? 0), 0) ?? 0
                        return apv > 0 ? `$${Math.round(apv).toLocaleString()}` : null
                      }
                      if (row.key === 'lead_spend') return leadsByDate[ds] > 0 ? `$${Math.round(leadsByDate[ds]).toLocaleString()}` : null
                      return null
                    }
                    const fmtTotal = val => {
                      if (!val) return '—'
                      return row.currency ? `$${Math.round(val).toLocaleString()}` : val
                    }
                    return (
                      <tr key={row.key} className="hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors border-t border-dashed border-gray-100 dark:border-white/[0.06]">
                        <td className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap italic ${row.accent}`}>
                          {row.label}
                        </td>
                        {days.map(day => {
                          const ds  = toDateStr(day)
                          const val = fmtDerived(0, ds)
                          return (
                            <td key={ds} className="px-1.5 py-2.5 text-center">
                              <span className={`text-sm tabular-nums font-medium ${
                                val ? 'text-gray-900 dark:text-white' : 'text-gray-200 dark:text-white/15'
                              }`}>
                                {val ?? '—'}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-4 py-2.5 text-right">
                          <span className={`text-sm tabular-nums font-bold ${
                            weekDerivedTotal ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-white/20'
                          }`}>
                            {fmtTotal(weekDerivedTotal)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Inline day editor ─────────────────────────────────────────── */}
            {editDate && (
              <div className="border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-white/[0.02] px-5 py-5">

                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-4">
                  {fmtFullDay(editDate)}
                </p>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                  {METRICS.map(metric => (
                    <div key={metric.key}>
                      <label className={`block text-xs font-semibold mb-1.5 ${metric.accent}`}>
                        {metric.short}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step={metric.step ?? '1'}
                        inputMode={metric.decimal ? 'decimal' : 'numeric'}
                        value={draft[metric.key] ?? ''}
                        onChange={e => setField(metric.key, e.target.value)}
                        onFocus={e => e.target.select()}
                        placeholder="0"
                        className="w-full text-sm text-center rounded-lg px-2 py-1.5 border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors tabular-nums"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 text-red-500 dark:text-red-400">
                      Lead $
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      value={draft.lead_spend ?? ''}
                      onChange={e => setField('lead_spend', e.target.value)}
                      onFocus={e => e.target.select()}
                      placeholder="0"
                      className="w-full text-sm text-center rounded-lg px-2 py-1.5 border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors tabular-nums"
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs text-gray-400 dark:text-white/40 mb-1.5">
                    Notes <span className="font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={draft.notes}
                    onChange={e => setField('notes', e.target.value)}
                    rows={2}
                    placeholder="Follow-ups, observations…"
                    className="w-full text-sm rounded-lg px-3 py-1.5 border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors resize-y"
                  />
                </div>

                {saveError && (
                  <p className="text-xs text-red-500 dark:text-red-400 mb-3">{saveError}</p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-sm px-5 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditDate(null)}
                    className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Stats section (shared time-frame selector) ──────────────────── */}
          <div className="space-y-4">

            {/* Shared header with range picker */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
                Stats
              </p>
              <div className="flex gap-1">
                {STAT_RANGES.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setStatsRange(r.key)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                      statsRange === r.key
                        ? 'bg-accent text-white'
                        : 'border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversion ratios */}
            <div className={`bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5 transition-opacity ${statsLoading ? 'opacity-50' : ''}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-5">
                Conversion Ratios
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6">
                {ratios.map(r => (
                  <RatioCard key={r.label} {...r} />
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className={`bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5 transition-opacity ${statsLoading ? 'opacity-50' : ''}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-5">
                Totals
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mb-4">
                {METRICS.map(m => (
                  <div key={m.key}>
                    <p className={`text-xs font-semibold mb-1 ${m.accent}`}>{m.label}</p>
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                      {totals[m.key] || 0}
                    </p>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-100 dark:border-white/10 pt-4 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold italic mb-1 text-orange-500 dark:text-orange-400">Apps Written</p>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{statsPolicyApps || 0}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold italic mb-1 text-green-600 dark:text-green-400">Submitted APV</p>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {statsPolicySubAPV > 0 ? `$${Math.round(statsPolicySubAPV).toLocaleString()}` : '0'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold italic mb-1 text-red-500 dark:text-red-400">Lead Spend</p>
                  <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {statsLeadSpend > 0 ? `$${Math.round(statsLeadSpend).toLocaleString()}` : '0'}
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* ── Goals section ────────────────────────────────────────────────── */}
          <div className={`bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5 transition-opacity ${goalsLoading ? 'opacity-50' : ''}`}>

            {/* Header row */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
                Goals
              </p>

              {/* Month navigation */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setGoalsMonth(m => addMonths(m, -1)); setGoalsDraft(null) }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors text-base leading-none"
                >‹</button>
                <span className="text-xs font-medium text-gray-600 dark:text-white/70 min-w-[110px] text-center">
                  {fmtGoalsMonth(goalsMonth)}
                </span>
                <button
                  onClick={() => { setGoalsMonth(m => addMonths(m, 1)); setGoalsDraft(null) }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors text-base leading-none"
                >›</button>
              </div>

              {/* Edit / Save / Cancel */}
              <div className="ml-auto flex gap-2">
                {goalsDraft ? (
                  <>
                    <button
                      onClick={saveGoals}
                      disabled={goalsSaving}
                      className="text-xs px-4 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
                    >
                      {goalsSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setGoalsDraft(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setGoalsDraft({
                      weekly_dials:          goals?.weekly_dials          ?? '',
                      weekly_appts:          goals?.weekly_appts          ?? '',
                      monthly_apv_submitted: goals?.monthly_apv_submitted ?? '',
                      monthly_apv_issued:    goals?.monthly_apv_issued    ?? '',
                    })}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    {goals && Object.values(goals).some(v => v !== null && v !== undefined && v !== '') ? 'Edit' : 'Set Goals'}
                  </button>
                )}
              </div>
            </div>

            {/* Goals grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {GOAL_FIELDS.map(f => (
                <div key={f.key}>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{f.label}</p>
                  <p className="text-[10px] text-gray-300 dark:text-white/20 mb-2">{f.period}</p>
                  {goalsDraft ? (
                    <input
                      type="number"
                      min="0"
                      step={f.currency ? '100' : '1'}
                      inputMode={f.currency ? 'decimal' : 'numeric'}
                      value={goalsDraft[f.key] ?? ''}
                      onChange={e => setGoalsDraft(d => ({ ...d, [f.key]: e.target.value }))}
                      onFocus={e => e.target.select()}
                      placeholder="—"
                      className="w-full text-sm rounded-lg px-2.5 py-1.5 border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors tabular-nums"
                    />
                  ) : (
                    <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                      {goals === null ? '…' : fmtGoalValue(goals[f.key], f.currency)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

        </>
      )}
    </main>
  )
}

// ─── Ratio card ────────────────────────────────────────────────────────────────

function RatioCard({ label, pct, num, den, display, sub, title }) {
  const value   = display !== undefined ? display   : (pct !== null ? `${pct}%` : null)
  const subline = display !== undefined ? sub       : (den > 0 ? `${num} / ${den}` : null)
  return (
    <div className="text-center" title={title}>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-1.5 leading-tight">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
        {value ?? '—'}
      </p>
      {subline && (
        <p className="text-[10px] text-gray-400 dark:text-white/30 mt-0.5 tabular-nums">
          {subline}
        </p>
      )}
    </div>
  )
}
