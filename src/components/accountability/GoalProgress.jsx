import { useMemo } from 'react'
import {
  goalDisplayLabel, goalValueText, calculatePace,
  computeGoalCurrentValue, buildWeeklyBuckets,
} from './utils/accountabilityCalc'

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return <div style={{ width: 34, height: 13 }} />
  const max = Math.max(...data, 0.01)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 32
    const y = 11 - (v / max) * 11
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={34} height={13} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const PACE_STYLES = {
  ahead:   { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',   bar: '#3b82f6' },
  on_pace: { badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', bar: '#22c55e' },
  behind:  { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', bar: '#f59e0b' },
}

const PACE_LABELS = { ahead: 'ahead', on_pace: 'on pace', behind: 'behind' }

export default function GoalProgress({ goal, activityRows, sparklineActivity, today }) {
  const { goal_type, goal_value } = goal

  const current = useMemo(
    () => computeGoalCurrentValue(goal_type, activityRows, today),
    [goal_type, activityRows, today],
  )

  const pace = useMemo(
    () => calculatePace(goal_type, goal_value, current, today),
    [goal_type, goal_value, current, today],
  )

  const sparkData = useMemo(() => {
    const buckets = buildWeeklyBuckets(sparklineActivity, 5, today)
    return buckets.map(b => goal_type === 'appts_week' ? b.appts_run : b.apv_submitted)
  }, [sparklineActivity, goal_type, today])

  const pct = goal_value > 0 ? Math.min((current / goal_value) * 100, 100) : 0
  const { badge, bar } = PACE_STYLES[pace]

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-500 dark:text-gray-400 w-14 shrink-0 leading-none">
        {goalDisplayLabel(goal_type)}
      </span>
      <div className="w-11 h-1 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bar }} />
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
        {goalValueText(goal_type, current, goal_value)}
      </span>
      <div className="shrink-0">
        <Sparkline data={sparkData} color={bar} />
      </div>
      <span className={`text-[9px] px-1.5 py-px rounded-full font-medium shrink-0 ${badge}`}>
        {PACE_LABELS[pace]}
      </span>
    </div>
  )
}
