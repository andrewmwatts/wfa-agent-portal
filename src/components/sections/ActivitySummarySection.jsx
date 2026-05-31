import { useEffect, useState } from 'react'

// Mirrors the ordered metric definitions from ActivityPage
const METRICS = [
  { key: 'dials',        label: 'Dials',        accent: 'text-blue-500   dark:text-blue-400'   },
  { key: 'hours_dialed', label: 'Hours',         accent: 'text-indigo-500 dark:text-indigo-400' },
  { key: 'reachouts',    label: 'Reachouts',     accent: 'text-cyan-600   dark:text-cyan-400'   },
  { key: 'posts',        label: 'Posts',         accent: 'text-pink-500   dark:text-pink-400'   },
  { key: 'contacts',     label: 'Contacts',      accent: 'text-teal-600   dark:text-teal-400'   },
  { key: 'appts_set',    label: 'Appts Set',     accent: 'text-violet-500 dark:text-violet-400' },
  { key: 'appts_kept',   label: 'Appts Kept',    accent: 'text-purple-500 dark:text-purple-400' },
  { key: 'apps_written', label: 'Apps Written',  accent: 'text-orange-500 dark:text-orange-400' },
  { key: 'resets',       label: 'Resets',        accent: 'text-green-600  dark:text-green-400'  },
]

function getWeekRange() {
  const now = new Date()
  const sun = new Date(now)
  sun.setDate(now.getDate() - now.getDay())
  sun.setHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setDate(sun.getDate() + 6)
  const fmt = d => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dy}`
  }
  return { start: fmt(sun), end: fmt(sat) }
}

function getMonthRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, '0')}` }
}

function sumLogs(logs) {
  const t = Object.fromEntries(METRICS.map(m => [m.key, 0]))
  for (const log of logs) {
    for (const m of METRICS) t[m.key] += log[m.key] ?? 0
  }
  return t
}

export default function ActivitySummarySection({ subject, loading: parentLoading }) {
  const [weekLogs,  setWeekLogs]  = useState([])
  const [monthLogs, setMonthLogs] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [tab,       setTab]       = useState('week')   // 'week' | 'month'

  useEffect(() => {
    if (!subject?.sfg_id) return
    setLoading(true)
    const { start: wS, end: wE } = getWeekRange()
    const { start: mS, end: mE } = getMonthRange()
    const base = `/api/activity?sfg_id=${encodeURIComponent(subject.sfg_id)}`
    Promise.all([
      fetch(`${base}&start=${wS}&end=${wE}`).then(r => r.ok ? r.json() : { logs: [] }),
      fetch(`${base}&start=${mS}&end=${mE}`).then(r => r.ok ? r.json() : { logs: [] }),
    ]).then(([week, month]) => {
      setWeekLogs(week.logs  ?? [])
      setMonthLogs(month.logs ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [subject?.sfg_id])

  const totals = sumLogs(tab === 'week' ? weekLogs : monthLogs)
  const isLoading = parentLoading || loading

  return (
    <section className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">
          Activity Summary
        </p>
        <div className="flex gap-1">
          {[['week', 'This Week'], ['month', 'This Month']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-xs px-3 py-1 rounded-lg font-semibold transition-colors ${
                tab === key
                  ? 'bg-accent text-white'
                  : 'border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-4 animate-pulse">
          {METRICS.map(m => (
            <div key={m.key} className="space-y-2">
              <div className="h-3 bg-gray-100 dark:bg-white/10 rounded w-3/4" />
              <div className="h-7 bg-gray-100 dark:bg-white/10 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-4">
          {METRICS.map(m => (
            <div key={m.key}>
              <p className={`text-xs font-semibold mb-1 ${m.accent}`}>{m.label}</p>
              <p className={`text-2xl font-bold tabular-nums ${
                totals[m.key] ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-white/20'
              }`}>
                {totals[m.key] || 0}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
