import { useMemo, useState } from 'react'
import { parseDateLocal } from '../../utils/format'

const RANGE_DAYS = { week: 7, month: 30 }

// Days from today until the next occurrence of a birth date's month/day
// (this year if it hasn't passed yet, otherwise next year).
function nextBirthday(birthDateStr, today) {
  const d = parseDateLocal(birthDateStr)
  if (!d || isNaN(d)) return null
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate())
  if (next < todayMid) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate())
  return { date: next, days: Math.round((next - todayMid) / 86400000) }
}

function fmtInDays(days) {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

export default function AgentBirthdays({ personnel, onAgentClick }) {
  const [range, setRange] = useState('week')

  const upcoming = useMemo(() => {
    const today = new Date()
    const maxDays = RANGE_DAYS[range]
    return personnel
      .map(p => {
        const next = p.birth_date ? nextBirthday(p.birth_date, today) : null
        return next ? { ...p, _days: next.days, _date: next.date } : null
      })
      .filter(p => p && p._days <= maxDays)
      .sort((a, b) => a._days - b._days || (a.name ?? '').localeCompare(b.name ?? ''))
  }, [personnel, range])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/15 overflow-hidden">
          {[{ key: 'week', label: 'Next 7 days' }, { key: 'month', label: 'Next 30 days' }].map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r.key
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-white/30">
          {upcoming.length} birthday{upcoming.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/10">
                {['Name', 'Upline', 'Birthday', 'In'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3 first:pl-6 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {upcoming.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-400 dark:text-white/30">
                    No birthdays in this window.
                  </td>
                </tr>
              ) : upcoming.map(p => (
                <tr
                  key={p.sfg_id}
                  onClick={() => onAgentClick(p)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-5 pl-6 py-3">
                    <span className="font-medium text-gray-900 dark:text-white">{p.name || '—'}</span>
                    <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">{p.sfg_id}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 dark:text-white/70">{p.upline_name || '—'}</td>
                  <td className="px-5 py-3 text-sm text-gray-600 dark:text-white/70">
                    {p._date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 dark:text-white/70">{fmtInDays(p._days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
