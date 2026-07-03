import { useEffect, useMemo, useState } from 'react'
import GoalProgress from './GoalProgress'
import RatioPanel from './RatioPanel'
import TrendChart from './TrendChart'
import LeadSpendNote from './LeadSpendNote'
import {
  getRolling7Days, getCollapsedPeriod, getGoalsForAgent,
  sumRows, toYMD, subDays, fmtCompactAPV,
} from './utils/accountabilityCalc'

const DAY_ABB = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const TABLE_ROWS = [
  { label: 'Dials',     key: 'dials'     },
  { label: 'Contacts',  key: 'contacts'  },
  { label: 'Appts set', key: 'appts_set' },
  { label: 'Appts run', key: 'appts_run' },
]

export default function AgentRow({ agent, activity, goals, sparklineActivity, today, globalExpandCount, onRemove }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (globalExpandCount > 0) setOpen(true)
  }, [globalExpandCount])

  // ── Collapsed stats ─────────────────────────────────────────────────────────
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

  const agentGoals = useMemo(() => getGoalsForAgent(goals), [goals])

  // ── Expanded: rolling 7 days ────────────────────────────────────────────────
  const rolling7Days = useMemo(() => getRolling7Days(today), [today])

  const rolling7Rows = useMemo(() => {
    const start = toYMD(subDays(today, 7))
    const end   = toYMD(subDays(today, 1))
    return activity.filter(r => r.date >= start && r.date <= end)
  }, [activity, today])

  const prior7Rows = useMemo(() => {
    const start = toYMD(subDays(today, 14))
    const end   = toYMD(subDays(today, 8))
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

  const cs = collapsedStats
  const name = `${agent.first_name} ${agent.last_name}`

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      {/* ── Collapsed row ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center h-14 px-4 cursor-pointer hover:bg-gray-50/70 dark:hover:bg-gray-800/40 select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* Agent name + team */}
        <div className="w-36 shrink-0 pr-4">
          <div className="text-[13px] font-medium text-gray-900 dark:text-white leading-tight truncate">{name}</div>
          {agent.team && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{agent.team}</div>
          )}
        </div>

        {/* Activity stats */}
        <div className="flex-1 flex items-center border-l border-gray-100 dark:border-gray-800 pl-4 overflow-hidden">
          <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mr-3 shrink-0">{periodLabel}</span>

          {[
            { label: 'Dials',    val: cs.dials    },
            { label: 'Contacts', val: cs.contacts  },
            { label: 'Set',      val: cs.appts_set },
            { label: 'Ran',      val: cs.appts_run },
          ].map(({ label, val }, i) => (
            <div key={label} className="flex items-center shrink-0">
              {i > 0 && <div className="h-[26px] border-r border-gray-200 dark:border-gray-700 mx-2" />}
              <div className="flex flex-col items-center px-2">
                <span className="text-[15px] font-medium text-gray-900 dark:text-white leading-none tabular-nums">{val}</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">{label}</span>
              </div>
            </div>
          ))}

          {/* Apps · APV */}
          <div className="flex items-center shrink-0">
            <div className="h-[26px] border-r border-gray-200 dark:border-gray-700 mx-2" />
            <div className="flex flex-col items-center px-2">
              {cs.apps > 0 || cs.apv > 0 ? (
                <span className="text-[11px] font-medium text-gray-900 dark:text-white leading-none whitespace-nowrap tabular-nums">
                  {cs.apps} · {fmtCompactAPV(cs.apv)}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 leading-none">0 · —</span>
              )}
              <span className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">Apps · APV</span>
            </div>
          </div>
        </div>

        {/* Goals */}
        <div className="w-52 shrink-0 border-l border-gray-100 dark:border-gray-800 pl-3 flex flex-col gap-1.5">
          {agentGoals.map(goal => (
            <GoalProgress
              key={goal.goal_type}
              goal={goal}
              activityRows={activity}
              sparklineActivity={sparklineActivity}
              today={today}
            />
          ))}
        </div>

        {/* Remove */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(agent.sfg_id) }}
          className="ml-3 p-1 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors shrink-0"
          title={`Remove ${name} from call`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* Chevron */}
        <div
          className="ml-1 text-gray-400 dark:text-gray-500 shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>

      {/* ── Expanded panel ──────────────────────────────────────────────────── */}
      {open && (
        <div className="px-4 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/20">
          <div className="grid grid-cols-2 gap-5">

            {/* Rolling 7-day table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left pb-2 pr-3 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium w-20" />
                    {rolling7Days.map((d, i) => (
                      <th key={i} className="pb-2 text-center text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium min-w-[30px]">
                        {DAY_ABB[d.getDay()]}
                      </th>
                    ))}
                    <th className="pb-2 text-center text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium min-w-[36px]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map(({ label, key }) => (
                    <tr key={key} className="border-t border-gray-100 dark:border-gray-700/60">
                      <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{label}</td>
                      {rolling7Days.map((d, i) => {
                        const v = cellVal(d, key)
                        return (
                          <td key={i} className={`py-1.5 text-center tabular-nums ${v === 0 ? 'text-gray-300 dark:text-gray-600' : 'text-gray-800 dark:text-gray-200'}`}>
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
                  <tr className="border-t border-gray-100 dark:border-gray-700/60">
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">Apps · APV</td>
                    {rolling7Days.map((d, i) => {
                      const apps = cellVal(d, 'apps_submitted')
                      const apv  = cellVal(d, 'apv_submitted')
                      if (!apps && !apv) {
                        return <td key={i} className="py-1.5 text-center text-gray-300 dark:text-gray-600">—</td>
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
                  <tr className="border-t border-gray-100 dark:border-gray-700/60">
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">Lead spend</td>
                    {rolling7Days.map((d, i) => {
                      const v = cellVal(d, 'lead_spend')
                      if (!v) return <td key={i} className="py-1.5 text-center text-gray-300 dark:text-gray-600">—</td>
                      return <td key={i} className="py-1.5 text-center text-gray-800 dark:text-gray-200 tabular-nums">${Math.round(v)}</td>
                    })}
                    <td className="py-1.5 text-center font-medium text-gray-900 dark:text-white bg-gray-100/60 dark:bg-gray-700/40 tabular-nums">
                      {totals.lead_spend ? `$${Math.round(totals.lead_spend)}` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Coaching ratios */}
            <RatioPanel current7={rolling7Rows} prior7={prior7Rows} />

            {/* Trend chart */}
            <div className="col-span-2">
              <TrendChart data={rolling7Rows} days={rolling7Days} />
            </div>

            {/* Lead spend note */}
            <div className="col-span-2">
              <LeadSpendNote leadSpend={totals.lead_spend ?? 0} dials={totals.dials ?? 0} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
