import { useEffect, useMemo, useState } from 'react'
import RatioPanel from './RatioPanel'
import TrendChart from './TrendChart'
import LeadSpendNote from './LeadSpendNote'
import PolicyModal from './PolicyModal'
import { useViewing } from '../../context/ViewingContext'
import {
  getRolling7Days, getCollapsedPeriod, sumRows,
  toYMD, subDays, fmtCompactAPV, computeGoalCurrentValue,
  buildWeeklyBuckets, getGoalsForAgent, calculatePace, getMostRecentSaturday,
} from './utils/accountabilityCalc'

const DAY_ABB = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Rounds to nearest hundred, displays as $X.Xk; under $1k shows exact dollars
function fmtWeekApv(v) {
  if (!v) return '—'
  if (v >= 1000) {
    const rounded = Math.round(v / 100) * 100
    return `$${(rounded / 1000).toFixed(1)}k`
  }
  return `$${Math.round(v)}`
}

// Full dollar amount with commas for the expanded view
function fmtFullApv(v) {
  if (!v) return '—'
  return `$${Math.round(v).toLocaleString()}`
}

const TABLE_ROWS = [
  { label: 'Dials',     key: 'dials'     },
  { label: 'Contacts',  key: 'contacts'  },
  { label: 'Appts set', key: 'appts_set' },
  { label: 'Appts run', key: 'appts_run' },
]

// ── Pace colors (matches GoalProgress) ───────────────────────────────────────
const PACE_STYLES = {
  ahead:   { bar: '#3b82f6', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'   },
  on_pace: { bar: '#22c55e', badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  behind:  { bar: '#f59e0b', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
}
const PACE_LABELS = { ahead: 'ahead', on_pace: 'on pace', behind: 'behind' }

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#9ca3af' }) {
  if (!data || data.length < 2) return <div style={{ width: 40, height: 14 }} />
  const max = Math.max(...data, 0.01)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 38
    const y = 12 - (v / max) * 12
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={40} height={14} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Stoplight dot with label ──────────────────────────────────────────────────
const STOPLIGHT = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', gray: '#6b7280' }

function LabeledDot({ color, label, title }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={title} style={{ flexShrink: 0 }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: color }} />
      <span style={{ fontSize: 8, lineHeight: 1, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}

function ratioColor(ratio) {
  if (ratio === null) return STOPLIGHT.gray
  if (ratio >= 0.50) return STOPLIGHT.green
  if (ratio >= 0.25) return STOPLIGHT.amber
  return STOPLIGHT.red
}

function leadSpendColor(amount) {
  if (amount >= 300) return STOPLIGHT.green
  if (amount > 0)    return STOPLIGHT.amber
  return STOPLIGHT.red
}

function fmtPct(ratio) {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`
}

// ── Agent row ─────────────────────────────────────────────────────────────────

export default function AgentRow({
  agent, activity, goals, sparklineActivity, today,
  leadSpend7, monthlyIssuedApv, globalExpandCount, globalCollapseCount, onRemove,
}) {
  const [open, setOpen]             = useState(false)
  const [policyModal, setPolicyModal] = useState(false)
  const { activeSubject } = useViewing()

  useEffect(() => { if (globalExpandCount  > 0) setOpen(true)  }, [globalExpandCount])
  useEffect(() => { if (globalCollapseCount > 0) setOpen(false) }, [globalCollapseCount])

  // ── Day: period stats ────────────────────────────────────────────────────────
  const { label: periodLabel, dates: periodDates } = useMemo(() => getCollapsedPeriod(today), [today])

  const collapsedStats = useMemo(() => {
    const ymds = new Set(periodDates.map(toYMD))
    const rows = activity.filter(r => ymds.has(r.date))
    return {
      dials:     sumRows(rows, 'dials'),
      contacts:  sumRows(rows, 'contacts'),
      appts_set: sumRows(rows, 'appts_set'),
      appts_run: sumRows(rows, 'appts_run'),
      apps:      sumRows(rows, 'apps_submitted'),
      apv:       sumRows(rows, 'apv_submitted'),
    }
  }, [activity, periodDates])

  // ── Week: appts vs goal ──────────────────────────────────────────────────────
  const agentGoals = useMemo(() => getGoalsForAgent(goals), [goals])
  const apptGoal   = useMemo(() => agentGoals.find(g => g.goal_type === 'appts_week') ?? { goal_type: 'appts_week', goal_value: 10 }, [agentGoals])

  const weekAppts = useMemo(
    () => computeGoalCurrentValue('appts_week', activity, today),
    [activity, today],
  )

  const weekApptSet = useMemo(() => {
    const weekStartYMD = toYMD(getMostRecentSaturday(today))
    const todayYMD     = toYMD(today)
    const rows = activity.filter(r => r.date >= weekStartYMD && r.date <= todayYMD)
    return sumRows(rows, 'appts_set')
  }, [activity, today])

  const weekApv = useMemo(() => {
    const weekStartYMD = toYMD(getMostRecentSaturday(today))
    const todayYMD     = toYMD(today)
    const rows = activity.filter(r => r.date >= weekStartYMD && r.date <= todayYMD)
    return sumRows(rows, 'apv_submitted')
  }, [activity, today])

  const weekPace = useMemo(
    () => calculatePace('appts_week', apptGoal.goal_value, weekAppts, today),
    [apptGoal.goal_value, weekAppts, today],
  )

  const weekPct = apptGoal.goal_value > 0 ? Math.min((weekAppts / apptGoal.goal_value) * 100, 100) : 0
  const { bar: weekBarColor, badge: weekBadge } = PACE_STYLES[weekPace]

  // ── 4 Wk: sparkline + ratios ─────────────────────────────────────────────────
  const sparkBuckets = useMemo(() => {
    const buckets = buildWeeklyBuckets(sparklineActivity, 4, today)
    return buckets.map(b => b.appts_run)
  }, [sparklineActivity, today])

  const rows28 = useMemo(() => {
    const start = toYMD(subDays(today, 28))
    const end   = toYMD(subDays(today, 1))
    return sparklineActivity.filter(r => r.date >= start && r.date <= end)
  }, [sparklineActivity, today])

  const priorRows28 = useMemo(() => {
    const start = toYMD(subDays(today, 56))
    const end   = toYMD(subDays(today, 29))
    return sparklineActivity.filter(r => r.date >= start && r.date <= end)
  }, [sparklineActivity, today])

  const ratios28 = useMemo(() => {
    const contacts  = sumRows(rows28, 'contacts')
    const appts_set = sumRows(rows28, 'appts_set')
    const appts_run = sumRows(rows28, 'appts_run')
    const apps      = sumRows(rows28, 'apps_submitted')
    return {
      set_rate:  contacts  > 0 ? appts_set / contacts  : null,
      sit_rate:  appts_set > 0 ? appts_run / appts_set : null,
      sale_rate: appts_run > 0 ? apps      / appts_run : null,
    }
  }, [rows28])

  // ── Expanded: rolling 7 days ─────────────────────────────────────────────────
  const rolling7Days = useMemo(() => getRolling7Days(today), [today])

  const rolling7Rows = useMemo(() => {
    const start = toYMD(subDays(today, 7))
    const end   = toYMD(subDays(today, 1))
    return activity.filter(r => r.date >= start && r.date <= end)
  }, [activity, today])

  const totals = useMemo(() => {
    const keys = ['dials','contacts','appts_set','appts_run','apps_submitted','apv_submitted','lead_spend']
    return Object.fromEntries(keys.map(k => [k, sumRows(rolling7Rows, k)]))
  }, [rolling7Rows])

  function cellVal(date, key) {
    const row = rolling7Rows.find(r => r.date === toYMD(date))
    return row ? (Number(row[key]) || 0) : 0
  }

  const cs   = collapsedStats
  const name = agent.preferred_name ?? agent.opt_name ?? ''

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
      {/* ── Collapsed row ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center h-16 px-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* Agent name */}
        <div className="w-36 shrink-0 pr-4">
          <div className="text-[13px] font-medium text-gray-900 dark:text-white leading-tight truncate">{name}</div>
        </div>

        {/* ── [Day]: activity stats — expands to fill available space ──── */}
        <div className="flex-1 flex items-center border-l border-gray-200 dark:border-gray-700 pl-3 overflow-hidden min-w-0">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-400 mr-2 shrink-0">{periodLabel}</span>

          {[
            { label: 'Dials',    val: cs.dials    },
            { label: 'Contacts', val: cs.contacts  },
            { label: 'Set',      val: cs.appts_set },
            { label: 'Ran',      val: cs.appts_run },
          ].map(({ label, val }, i) => (
            <div key={label} className="flex items-center shrink-0">
              {i > 0 && <div className="h-6 border-r border-gray-200 dark:border-gray-600 mx-1.5" />}
              <div className="flex flex-col items-center px-1.5">
                <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100 leading-none tabular-nums">{val}</span>
                <span className="text-[8px] uppercase tracking-wider text-gray-400 dark:text-gray-400 mt-0.5">{label}</span>
              </div>
            </div>
          ))}

          {/* Apps · APV */}
          <div className="flex items-center shrink-0">
            <div className="h-6 border-r border-gray-200 dark:border-gray-600 mx-1.5" />
            <div className="flex flex-col items-center px-1.5">
              {cs.apps > 0 || cs.apv > 0 ? (
                <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 leading-none whitespace-nowrap tabular-nums">
                  {cs.apps} · {fmtCompactAPV(cs.apv)}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 leading-none">—</span>
              )}
              <span className="text-[8px] uppercase tracking-wider text-gray-400 dark:text-gray-400 mt-0.5">Apps · APV</span>
            </div>
          </div>
        </div>

        {/* ── Week + 4 Wk: right-justified group ───────────────────────── */}
        <div className="flex items-center shrink-0 ml-4">

          {/* Week: */}
          <div className="flex items-center gap-2.5 border-l border-gray-200 dark:border-gray-600 pl-4 pr-4">
            <span style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              Week:
            </span>
            {/* SET */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="w-12 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((weekApptSet / 15) * 100, 100)}%`, background: weekBarColor }} />
                </div>
                <span className="text-[10px] text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
                  {weekApptSet}/15
                </span>
              </div>
              <span className="text-[8px] uppercase tracking-wider text-gray-400 dark:text-gray-400">Appts set</span>
            </div>

            {/* RUN */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="w-12 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0">
                  <div className="h-full rounded-full" style={{ width: `${weekPct}%`, background: weekBarColor }} />
                </div>
                <span className="text-[10px] text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
                  {weekAppts}/{apptGoal.goal_value}
                </span>
              </div>
              <span className="text-[8px] uppercase tracking-wider text-gray-400 dark:text-gray-400">Appts run</span>
            </div>
            {/* APV */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                {fmtWeekApv(weekApv)}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-gray-400 dark:text-gray-400">APV</span>
            </div>

            <LabeledDot
              color={leadSpendColor(leadSpend7)}
              label="Leads"
              title={`Lead spend (7d): $${Math.round(leadSpend7)}`}
            />
          </div>

          {/* 4 Wk: */}
          <div className="flex items-center gap-2.5 border-l border-gray-200 dark:border-gray-600 pl-4">
            <span style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              4 Wk:
            </span>
            <Sparkline data={sparkBuckets} color={weekBarColor} />
            <div className="flex items-center gap-2">
              <LabeledDot color={ratioColor(ratios28.set_rate)}  label="Set"  title={`Set rate (28d): ${fmtPct(ratios28.set_rate)}`} />
              <LabeledDot color={ratioColor(ratios28.sit_rate)}  label="Sit"  title={`Sit rate (28d): ${fmtPct(ratios28.sit_rate)}`} />
              <LabeledDot color={ratioColor(ratios28.sale_rate)} label="Sale" title={`Sale rate (28d): ${fmtPct(ratios28.sale_rate)}`} />
            </div>
          </div>

        </div>

        {/* Remove */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(agent.sfg_id) }}
          className="ml-3 p-1 text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors shrink-0"
          title={`Remove ${name} from call`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Chevron */}
        <div
          className="ml-1 text-gray-400 dark:text-gray-400 shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>

      {/* ── Policy modal ────────────────────────────────────────────────────── */}
      {policyModal && (
        <PolicyModal
          agentName={name}
          sfgId={agent.sfg_id}
          ownerSfgId={activeSubject?.sfg_id}
          onClose={() => setPolicyModal(false)}
        />
      )}

      {/* ── Expanded panel ──────────────────────────────────────────────────── */}
      {open && (
        <div className="px-4 pb-5 pt-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-800/30">
          <div className="grid grid-cols-2 gap-5">

            {/* Rolling 7-day table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left pb-2 pr-3 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-400 font-medium w-20" />
                    {rolling7Days.map((d, i) => (
                      <th key={i} className="pb-2 text-center text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-400 font-medium min-w-[30px]">
                        {DAY_ABB[d.getDay()]}
                      </th>
                    ))}
                    <th className="pb-2 text-center text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-400 font-medium min-w-[36px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map(({ label, key }) => (
                    <tr key={key} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{label}</td>
                      {rolling7Days.map((d, i) => {
                        const v = cellVal(d, key)
                        return (
                          <td key={i} className={`py-1.5 text-center tabular-nums ${v === 0 ? 'text-gray-300 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                            {v}
                          </td>
                        )
                      })}
                      <td className="py-1.5 text-center font-medium text-gray-900 dark:text-white bg-gray-100/60 dark:bg-gray-700/40 tabular-nums">
                        {totals[key] ?? 0}
                      </td>
                    </tr>
                  ))}

                  {/* Apps · APV row */}
                  <tr className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">Apps · APV</td>
                    {rolling7Days.map((d, i) => {
                      const apps = cellVal(d, 'apps_submitted')
                      const apv  = cellVal(d, 'apv_submitted')
                      if (!apps && !apv) {
                        return <td key={i} className="py-1.5 text-center text-gray-300 dark:text-gray-500">—</td>
                      }
                      return (
                        <td key={i} className="py-1.5 text-center text-gray-800 dark:text-gray-200 whitespace-nowrap">
                          {apps}·{fmtCompactAPV(apv)}
                        </td>
                      )
                    })}
                    <td className="py-1.5 text-center font-medium text-gray-900 dark:text-white bg-gray-100/60 dark:bg-gray-700/40 whitespace-nowrap">
                      {totals.apps_submitted}·{fmtCompactAPV(totals.apv_submitted)}
                    </td>
                  </tr>

                  {/* Lead spend row */}
                  <tr className="border-t border-gray-100 dark:border-gray-700">
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">Lead spend</td>
                    {rolling7Days.map((d, i) => {
                      const v = cellVal(d, 'lead_spend')
                      if (!v) return <td key={i} className="py-1.5 text-center text-gray-300 dark:text-gray-500">—</td>
                      return <td key={i} className="py-1.5 text-center text-gray-800 dark:text-gray-200 tabular-nums">${Math.round(v)}</td>
                    })}
                    <td className="py-1.5 text-center font-medium text-gray-900 dark:text-white bg-gray-100/60 dark:bg-gray-700/40 tabular-nums">
                      {leadSpend7 ? `$${Math.round(leadSpend7)}` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Coaching ratios */}
            <RatioPanel current={rows28} prior={priorRows28} />

            {/* Monthly APV goal row — full width, between ratios and chart */}
            {(() => {
              const apvGoal = agentGoals.find(g => g.goal_type === 'apv_month')
              const issued  = monthlyIssuedApv
              const goal    = apvGoal?.goal_value ?? 0
              const pct     = goal > 0 ? Math.min((issued / goal) * 100, 100) : 0
              const barColor = issued >= goal ? '#22c55e' : issued >= goal * 0.5 ? '#f59e0b' : '#ef4444'
              return (
                <div className="col-span-2 flex items-center gap-4 py-2 border-t border-b border-gray-100 dark:border-gray-700">
                  {/* Bar */}
                  <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: goal > 0 ? barColor : '#d1d5db' }} />
                  </div>
                  {/* Label + values */}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">Monthly APV Goal:</span>
                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap shrink-0">
                    {goal > 0 ? fmtFullApv(goal) : '—'}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap shrink-0">Issued:</span>
                  <span className="text-[11px] font-medium text-gray-900 dark:text-white tabular-nums whitespace-nowrap shrink-0">
                    {fmtFullApv(issued)}
                  </span>
                  {/* Policy details button */}
                  <button
                    onClick={e => { e.stopPropagation(); setPolicyModal(true) }}
                    className="shrink-0 text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:border-gray-300 dark:hover:border-gray-500 transition-colors"
                  >
                    Policy details
                  </button>
                </div>
              )
            })()}

            {/* Trend chart */}
            <div className="col-span-2">
              <TrendChart data={rolling7Rows} days={rolling7Days} />
            </div>

            {/* Lead spend note */}
            <div className="col-span-2">
              <LeadSpendNote leadSpend={leadSpend7} dials={totals.dials ?? 0} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
