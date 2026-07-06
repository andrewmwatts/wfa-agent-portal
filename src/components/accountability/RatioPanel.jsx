import { useMemo } from 'react'
import { RATIO_TARGETS, RATIO_FLAT_THRESHOLD, LOW_SAMPLE_THRESHOLD, sumRows } from './utils/accountabilityCalc'

function ArrowUpRight() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500 dark:text-green-400">
      <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
    </svg>
  )
}
function ArrowDownRight() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 dark:text-red-400">
      <line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/>
    </svg>
  )
}
function Minus() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-gray-400">
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

const RATIO_ROWS = [
  { key: 'set_rate',  label: 'Set rate',  numKey: 'appts_set',      denKey: 'contacts'   },
  { key: 'sit_rate',  label: 'Sit rate',  numKey: 'appts_run',      denKey: 'appts_set'  },
  { key: 'sale_rate', label: 'Sale rate', numKey: 'apps_submitted', denKey: 'appts_run'  },
]

function safeRatio(num, den) {
  return den > 0 ? num / den : null
}

// current = rolling 28-day rows, prior = previous 28-day rows (for trend arrows)
export default function RatioPanel({ current = [], prior = [] }) {
  const ratios = useMemo(() => RATIO_ROWS.map(({ key, label, numKey, denKey }) => {
    const curNum = sumRows(current, numKey)
    const curDen = sumRows(current, denKey)
    const preNum = sumRows(prior, numKey)
    const preDen = sumRows(prior, denKey)

    const cur    = safeRatio(curNum, curDen)
    const pre    = safeRatio(preNum, preDen)
    const target = RATIO_TARGETS[key]

    let trend = 'flat'
    if (cur !== null && pre !== null) {
      const diff = cur - pre
      if (Math.abs(diff) > RATIO_FLAT_THRESHOLD) trend = diff > 0 ? 'up' : 'down'
    }

    const isLowSample = key === 'sale_rate' && curDen < LOW_SAMPLE_THRESHOLD
    const onTarget = cur !== null && cur >= target

    return { key, label, cur, target, onTarget, trend, isLowSample }
  }), [current, prior])

  const targetPct = RATIO_TARGETS.set_rate * 100

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-400 font-medium pb-2 border-b border-gray-200 dark:border-gray-600 mb-3">
        Coaching ratios · rolling 28 days
      </div>

      <div className="flex flex-col gap-3">
        {ratios.map(({ key, label, cur, onTarget, trend, isLowSample }) => {
          const fillPct = cur !== null ? Math.min(cur * 100, 100) : 0
          const fillColor = onTarget ? '#22c55e' : cur !== null && cur >= 0.25 ? '#f59e0b' : '#ef4444'
          const valueStr = cur !== null ? `${Math.round(cur * 100)}%` : '—'

          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-300 w-[52px] shrink-0 leading-none">{label}</span>

              {/* Bar + target line */}
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-600 rounded-full relative">
                {cur !== null && (
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fillPct}%`, background: fillColor }} />
                )}
                <div
                  className="absolute top-[-3px] w-0.5 h-3 bg-gray-400 dark:bg-gray-400 z-10"
                  style={{ left: `${targetPct}%` }}
                />
              </div>

              {/* Value + trend */}
              <div className="flex items-center gap-1 w-14 shrink-0">
                <span className="text-[10px] font-medium text-gray-700 dark:text-gray-200 tabular-nums">
                  {valueStr}
                  {isLowSample && cur !== null && (
                    <span className="text-[9px] text-gray-400 dark:text-gray-400 font-normal"> low</span>
                  )}
                </span>
                {trend === 'up'   && <ArrowUpRight />}
                {trend === 'down' && <ArrowDownRight />}
                {trend === 'flat' && <Minus />}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3">
        <div className="w-2.5 h-0.5 bg-gray-400 dark:bg-gray-400 rounded" />
        <span className="text-[9px] text-gray-400 dark:text-gray-400">{targetPct}% target</span>
      </div>
    </div>
  )
}
