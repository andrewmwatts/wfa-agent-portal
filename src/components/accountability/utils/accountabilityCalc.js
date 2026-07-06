export const AGENCY_DEFAULT_GOAL = {
  goal_type: 'appts_week',
  goal_value: 10,
}

export const RATIO_TARGETS = {
  set_rate:  0.50,
  sit_rate:  0.50,
  sale_rate: 0.50,
}

export const RATIO_FLAT_THRESHOLD = 0.03
export const LOW_SAMPLE_THRESHOLD = 3

// ── Date helpers ──────────────────────────────────────────────────────────────

export function toYMD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function subDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() - n)
  return d
}

export function subWeeks(date, n) {
  return subDays(date, n * 7)
}

export function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

export function differenceInDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000
  const aMs = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bMs = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((aMs - bMs) / msPerDay)
}

// WFA business week: Sat–Fri. Returns the Saturday that opened the current week.
export function getMostRecentSaturday(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0=Sun … 6=Sat
  // Days since last Sat: Sun→1, Mon→2, … Fri→6, Sat→0
  const daysSinceSat = (dow + 1) % 7
  d.setDate(d.getDate() - daysSinceSat)
  return d
}

// Returns { label, dates[] } for the collapsed activity block.
// Sat/Sun/Mon all show the full Fri–Sun weekend window (whatever days have passed).
export function getCollapsedPeriod(today) {
  const dow = today.getDay() // 0=Sun … 6=Sat
  if (dow === 6) { // Saturday — only Friday has passed
    return { label: 'Fri–Sun:', dates: [subDays(today, 1)] }
  }
  if (dow === 0) { // Sunday — Friday and Saturday have passed
    return { label: 'Fri–Sun:', dates: [subDays(today, 2), subDays(today, 1)] }
  }
  if (dow === 1) { // Monday — full weekend has passed
    return { label: 'Fri–Sun:', dates: [subDays(today, 3), subDays(today, 2), subDays(today, 1)] }
  }
  const yesterday = subDays(today, 1)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { label: dayNames[yesterday.getDay()] + ':', dates: [yesterday] }
}

// Returns 7 Date objects, oldest→newest, ending yesterday
export function getRolling7Days(today) {
  return Array.from({ length: 7 }, (_, i) => subDays(today, 7 - i))
}

export function calculatePace(goalType, goalValue, currentValue, today) {
  let expectedByNow = 0
  if (goalType === 'appts_week' || goalType === 'apv_week') {
    const weekStart = getMostRecentSaturday(today)
    const daysElapsed = differenceInDays(today, weekStart) + 1
    expectedByNow = (goalValue / 7) * daysElapsed
  } else if (goalType === 'apv_month') {
    const daysElapsed = today.getDate()
    expectedByNow = (goalValue / getDaysInMonth(today)) * daysElapsed
  }
  if (expectedByNow === 0) return 'on_pace'
  const ratio = currentValue / expectedByNow
  if (ratio >= 1.1) return 'ahead'
  if (ratio >= 0.9) return 'on_pace'
  return 'behind'
}

// Compact APV display for collapsed view
export function fmtCompactAPV(amount) {
  if (!amount) return '—'
  if (amount < 1000)  return `$${Math.round(amount)}`
  if (amount < 10000) return `$${(amount / 1000).toFixed(1)}k`
  return `$${Math.round(amount / 1000)}k`
}

export function sumRows(rows, key) {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
}

export function goalDisplayLabel(goalType) {
  if (goalType === 'appts_week') return 'Appts/wk'
  if (goalType === 'apv_week')   return 'APV/wk'
  if (goalType === 'apv_month')  return 'APV/mo'
  return goalType
}

export function goalValueText(goalType, current, target) {
  if (goalType === 'apv_week' || goalType === 'apv_month') {
    return `${fmtCompactAPV(current)}/${fmtCompactAPV(target)}`
  }
  return `${Math.round(current)}/${Math.round(target)}`
}

// Returns deduplicated goals (most recent per type), or the agency default
export function getGoalsForAgent(goalRows) {
  if (!goalRows || goalRows.length === 0) return [AGENCY_DEFAULT_GOAL]
  const byType = {}
  for (const row of goalRows) {
    if (!byType[row.goal_type] || row.effective_date > byType[row.goal_type].effective_date) {
      byType[row.goal_type] = row
    }
  }
  return Object.values(byType)
}

// Sum the relevant activity metric for a goal's measurement period
export function computeGoalCurrentValue(goalType, activityRows, today) {
  let rows
  if (goalType === 'appts_week' || goalType === 'apv_week') {
    const weekStartYMD = toYMD(getMostRecentSaturday(today))
    const todayYMD     = toYMD(today)
    rows = activityRows.filter(r => r.date >= weekStartYMD && r.date <= todayYMD)
  } else if (goalType === 'apv_month') {
    const monthStartYMD = toYMD(new Date(today.getFullYear(), today.getMonth(), 1))
    const todayYMD      = toYMD(today)
    rows = activityRows.filter(r => r.date >= monthStartYMD && r.date <= todayYMD)
  } else {
    return 0
  }
  if (goalType === 'appts_week') return sumRows(rows, 'appts_run')
  return sumRows(rows, 'apv_submitted')
}

// Returns n weekly bucket totals oldest→newest for sparklines
export function buildWeeklyBuckets(activityRows, n, today) {
  const currentWeekStart = getMostRecentSaturday(today)
  return Array.from({ length: n }, (_, i) => {
    const weeksAgo = n - 1 - i
    const ws = subWeeks(currentWeekStart, weeksAgo)
    const we = weeksAgo > 0 ? subDays(subWeeks(currentWeekStart, weeksAgo - 1), 1) : today
    const wsYMD = toYMD(ws)
    const weYMD = toYMD(we)
    const rows = activityRows.filter(r => r.date >= wsYMD && r.date <= weYMD)
    return {
      appts_run:     sumRows(rows, 'appts_run'),
      apv_submitted: sumRows(rows, 'apv_submitted'),
    }
  })
}
