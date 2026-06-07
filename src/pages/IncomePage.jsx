import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import { parseDateLocal } from '../utils/format'

// ─── Constants ─────────────────────────────────────────────────────────────────

const INCOME_CATEGORIES  = ['Commission', 'Bonus', 'Override', 'Renewal', 'Other Income']
const EXPENSE_CATEGORIES = ['Leads', 'Licensing & E&O', 'Training & Education', 'Office & Technology', 'Travel', 'Marketing', 'Other Expense']

// Tax deductible defaults by expense category (all true except Other Expense)
const TAX_DEFAULT = Object.fromEntries([
  ...EXPENSE_CATEGORIES.map(c => [c, c !== 'Other Expense']),
])

const DONUT_COLORS = [
  '#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#ef4444','#ec4899','#84cc16','#f97316','#6366f1',
]
const INCOME_COLOR  = '#22c55e'
const EXPENSE_COLOR = '#ef4444'

const PERIOD_PRESETS = [
  { key: 'month',        label: 'This Month'    },
  { key: 'last_month',   label: 'Last Month'    },
  { key: 'quarter',      label: 'This Quarter'  },
  { key: 'last_quarter', label: 'Last Quarter'  },
  { key: 'year',         label: 'This Year'     },
  { key: 'last_year',    label: 'Last Year'     },
  { key: 'custom',       label: 'Custom'        },
]

// ─── Date / period helpers ─────────────────────────────────────────────────────

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function computePeriod(preset, customStart, customEnd) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()

  if (preset === 'month')        return { preset, start: toYMD(new Date(y, m, 1)),    end: toYMD(now) }
  if (preset === 'last_month')   return { preset, start: toYMD(new Date(y, m-1, 1)),  end: toYMD(new Date(y, m, 0)) }
  if (preset === 'quarter') {
    const qs = Math.floor(m / 3) * 3
    return { preset, start: toYMD(new Date(y, qs, 1)), end: toYMD(now) }
  }
  if (preset === 'last_quarter') {
    const qs = Math.floor(m / 3) * 3
    return { preset, start: toYMD(new Date(y, qs-3, 1)), end: toYMD(new Date(y, qs, 0)) }
  }
  if (preset === 'year')         return { preset, start: toYMD(new Date(y, 0, 1)),    end: toYMD(now) }
  if (preset === 'last_year')    return { preset, start: toYMD(new Date(y-1, 0, 1)),  end: toYMD(new Date(y-1, 11, 31)) }
  // custom
  return { preset: 'custom', start: customStart ?? toYMD(new Date(y, m, 1)), end: customEnd ?? toYMD(now) }
}

function periodLabel(period) {
  if (period.preset === 'custom') return `${period.start} – ${period.end}`
  return PERIOD_PRESETS.find(p => p.key === period.preset)?.label ?? period.preset
}

function fmtMoney(n) {
  if (!n && n !== 0) return '$0.00'
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoneyShort(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(abs/1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `$${(abs/1_000).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

// Returns true if period covers only full calendar months
function isFullMonths(period) {
  if (!period.start || !period.end) return false
  const s = parseDateLocal(period.start)
  const e = parseDateLocal(period.end)
  if (!s || !e) return false
  const startOk = s.getDate() === 1
  const endOk   = e.getDate() === new Date(e.getFullYear(), e.getMonth()+1, 0).getDate()
  return startOk && endOk
}

// ─── Donut helpers ─────────────────────────────────────────────────────────────

function groupWithOther(entries, total) {
  if (!total) return []
  const threshold = total * 0.05
  const main  = entries.filter(e => e.value >= threshold)
  const minor = entries.filter(e => e.value < threshold)
  if (minor.length) main.push({ name: 'Other', value: minor.reduce((s,e) => s + e.value, 0) })
  return main
}

// ─── Client-side hash (matches server) ────────────────────────────────────────

async function hashClient(date, signedAmt, description) {
  const str = `${date}|${signedAmt}|${String(description).toLowerCase().trim()}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// ─── CSV date / amount parsers ─────────────────────────────────────────────────

function parseCSVDate(str) {
  if (!str) return null
  str = str.trim()
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
  }
  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
  }
  return null
}

function parseCSVAmount(str) {
  if (!str) return null
  const clean = String(str).replace(/[$,\s]/g, '')
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

// ─── Shared UI pieces ──────────────────────────────────────────────────────────

const inputCls = [
  'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900',
  'placeholder:text-gray-400',
  'dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60 transition-colors',
].join(' ')

const selectCls = inputCls

function Label({ children }) {
  return (
    <label className="block text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">
      {children}
    </label>
  )
}

function CardShell({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-secondary rounded-xl border border-gray-200 dark:border-white/10 ${className}`}>
      {children}
    </div>
  )
}

function EmptyChart({ message = 'No data yet' }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-gray-400 dark:text-white/30 gap-2">
      <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ─── Period Selector ───────────────────────────────────────────────────────────

function PeriodSelector({ period, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => onChange(computePeriod(p.key, period.start, period.end))}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              period.preset === p.key
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={period.start}
            onChange={e => onChange({ ...period, start: e.target.value })}
            className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <span className="text-gray-400 dark:text-white/30 text-xs">to</span>
          <input type="date" value={period.end}
            onChange={e => onChange({ ...period, end: e.target.value })}
            className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1.5 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
        </div>
      )}
    </div>
  )
}

// ─── Summary Cards ─────────────────────────────────────────────────────────────

function SummaryCards({ summary, periodLabel: label }) {
  const cards = [
    { title: 'Total Income',    value: summary.income,       color: 'text-green-600 dark:text-green-400' },
    { title: 'Total Expenses',  value: summary.expense,      color: 'text-red-500 dark:text-red-400'     },
    { title: 'Net',             value: summary.net,          color: summary.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400', signed: true },
    { title: 'Tax Deductible',  value: summary.taxDeductible, color: 'text-blue-600 dark:text-blue-400', sub: 'expenses this period' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <CardShell key={c.title} className="p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">
            {c.title}
          </p>
          <p className={`text-2xl font-bold ${c.color}`}>
            {c.signed
              ? (c.value >= 0 ? '' : '-') + fmtMoney(c.value)
              : fmtMoney(c.value)
            }
          </p>
          <p className="text-xs text-gray-400 dark:text-white/30 mt-1">
            {c.sub ?? label}
          </p>
        </CardShell>
      ))}
    </div>
  )
}

// ─── Chart 1: Income vs Expenses (12-month rolling bar chart) ─────────────────

function IncomeExpenseBarChart({ rolling12, theme }) {
  const hasData = rolling12.some(m => m.income > 0 || m.expense > 0)
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const axisColor = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'

  return (
    <CardShell className="p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">
        Income vs Expenses — 12 Month Rolling
      </h3>
      {!hasData ? <EmptyChart message="Add transactions to see your monthly trend" /> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rolling12} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={fmtMoneyShort} width={52} />
            <Tooltip
              contentStyle={{
                backgroundColor: theme === 'dark' ? '#1e2130' : '#fff',
                border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: 8, fontSize: 12,
              }}
              labelStyle={{ color: theme === 'dark' ? 'rgba(255,255,255,0.7)' : '#374151', fontWeight: 600 }}
              formatter={(val, name) => [fmtMoney(val), name === 'income' ? 'Income' : 'Expenses']}
            />
            <Legend formatter={v => v === 'income' ? 'Income' : 'Expenses'}
              wrapperStyle={{ fontSize: 12, color: axisColor }} />
            <Bar dataKey="income"  fill={INCOME_COLOR}  radius={[3,3,0,0]} name="income" />
            <Bar dataKey="expense" fill={EXPENSE_COLOR} radius={[3,3,0,0]} name="expense" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </CardShell>
  )
}

// ─── Chart 2: Category Breakdown (two donuts) ──────────────────────────────────

function CategoryDonutCharts({ periodTx, theme }) {
  const axisColor = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'

  const incomeEntries = useMemo(() => {
    const map = {}
    for (const tx of periodTx) {
      if (tx.type !== 'income') continue
      const key = tx.category || 'Uncategorized'
      map[key] = (map[key] ?? 0) + tx.amount
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    const entries = Object.entries(map).map(([name, value]) => ({ name, value }))
    return { data: groupWithOther(entries, total), total }
  }, [periodTx])

  const expenseEntries = useMemo(() => {
    const map = {}
    for (const tx of periodTx) {
      if (tx.type !== 'expense') continue
      const key = tx.category || 'Uncategorized'
      map[key] = (map[key] ?? 0) + Math.abs(tx.amount)
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    const entries = Object.entries(map).map(([name, value]) => ({ name, value }))
    return { data: groupWithOther(entries, total), total }
  }, [periodTx])

  function DonutHalf({ label, entries, total }) {
    if (!total) return (
      <div className="flex-1 flex flex-col items-center">
        <p className="text-xs font-semibold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-3">{label}</p>
        <EmptyChart message="No data" />
      </div>
    )
    return (
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-500 dark:text-white/50 uppercase tracking-wide text-center mb-2">{label}</p>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={entries.data} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
              dataKey="value" paddingAngle={2}>
              {entries.data.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: theme === 'dark' ? '#1e2130' : '#fff',
                border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                borderRadius: 8, fontSize: 12,
              }}
              formatter={(val, name) => [fmtMoney(val), name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1 mt-1 px-2">
          {entries.data.map((e, i) => (
            <div key={e.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="truncate text-gray-600 dark:text-white/60">{e.name}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className="text-gray-700 dark:text-white/80 font-medium">{fmtMoney(e.value)}</span>
                <span className={`${axisColor} text-gray-400 dark:text-white/30`}>
                  {total ? `${Math.round(e.value / total * 100)}%` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <CardShell className="p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Category Breakdown</h3>
      <div className="flex gap-6">
        <DonutHalf label="Income by Category" entries={incomeEntries} total={incomeEntries.total} />
        <div className="w-px bg-gray-200 dark:bg-white/10 self-stretch" />
        <DonutHalf label="Expenses by Category" entries={expenseEntries} total={expenseEntries.total} />
      </div>
    </CardShell>
  )
}

// ─── Chart 3: Running Balance ──────────────────────────────────────────────────

function RunningBalanceChart({ periodTx, theme }) {
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const axisColor = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)'

  const chartData = useMemo(() => {
    const sorted = [...periodTx].sort((a, b) => a.date.localeCompare(b.date))
    let running = 0
    return sorted.map(tx => {
      running += tx.amount  // already signed
      return {
        date:       tx.date,
        balance:    running,
        balancePos: Math.max(0, running),
        balanceNeg: Math.min(0, running),
        label:      parseDateLocal(tx.date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? tx.date,
      }
    })
  }, [periodTx])

  const distinctMonths = useMemo(() => {
    const months = new Set(periodTx.map(tx => tx.date?.slice(0,7)))
    return months.size
  }, [periodTx])

  if (chartData.length < 2 || distinctMonths < 2) {
    return (
      <CardShell className="p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Running Balance</h3>
        <EmptyChart message="Need at least 2 months of data to show running balance" />
      </CardShell>
    )
  }

  const ticks = chartData.filter((_, i) => i === 0 || i === chartData.length-1 ||
    chartData[i].date.slice(0,7) !== chartData[i-1].date.slice(0,7)
  ).map(d => d.date)

  return (
    <CardShell className="p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Running Balance</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="gradPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={INCOME_COLOR}  stopOpacity={0.3} />
              <stop offset="95%" stopColor={INCOME_COLOR}  stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="gradNeg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="5%"  stopColor={EXPENSE_COLOR} stopOpacity={0.3} />
              <stop offset="95%" stopColor={EXPENSE_COLOR} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={d => parseDateLocal(d)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? d}
            tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false}
            tickFormatter={fmtMoneyShort} width={52} />
          <ReferenceLine y={0} stroke={theme === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'} strokeDasharray="4 2" />
          <Tooltip
            contentStyle={{
              backgroundColor: theme === 'dark' ? '#1e2130' : '#fff',
              border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              borderRadius: 8, fontSize: 12,
            }}
            labelFormatter={d => parseDateLocal(d)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? d}
            formatter={(val, key) => key === 'balancePos' || key === 'balanceNeg'
              ? [fmtMoney(Math.abs(val)), 'Balance']
              : null
            }
          />
          <Area type="monotone" dataKey="balancePos" stroke={INCOME_COLOR}  strokeWidth={2} fill="url(#gradPos)" dot={false} activeDot={{ r: 4 }} />
          <Area type="monotone" dataKey="balanceNeg" stroke={EXPENSE_COLOR} strokeWidth={2} fill="url(#gradNeg)" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </CardShell>
  )
}

// ─── Chart 4: YTD Summary Table ────────────────────────────────────────────────

function YTDTable({ periodTx }) {
  const incomeByCategory = useMemo(() => {
    const map = {}
    for (const tx of periodTx) {
      if (tx.type !== 'income') continue
      const k = tx.category || 'Uncategorized'
      map[k] = (map[k] ?? 0) + tx.amount
    }
    return map
  }, [periodTx])

  const expenseByCategory = useMemo(() => {
    const map = {}
    for (const tx of periodTx) {
      if (tx.type !== 'expense') continue
      const k = tx.category || 'Uncategorized'
      map[k] = (map[k] ?? 0) + Math.abs(tx.amount)
    }
    return map
  }, [periodTx])

  const totalIncome  = Object.values(incomeByCategory).reduce((s,v) => s+v, 0)
  const totalExpense = Object.values(expenseByCategory).reduce((s,v) => s+v, 0)
  const net = totalIncome - totalExpense

  const incomeRows  = INCOME_CATEGORIES.map(c => ({ category: c, amount: incomeByCategory[c] ?? 0 })).filter(r => r.amount > 0)
  const expenseRows = EXPENSE_CATEGORIES.map(c => ({ category: c, amount: expenseByCategory[c] ?? 0 })).filter(r => r.amount > 0)

  if (!incomeRows.length && !expenseRows.length) return null

  const rows = Math.max(incomeRows.length, expenseRows.length)

  return (
    <CardShell className="p-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-4">Period Summary</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wide w-1/2 pr-4">
                Income
              </th>
              <th className="text-left pb-2 text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wide w-1/2 pl-4 border-l border-gray-200 dark:border-white/10">
                Expenses
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-white/5 last:border-0">
                <td className="py-1.5 pr-4">
                  {incomeRows[i] ? (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-white/60">{incomeRows[i].category}</span>
                      <span className="font-medium text-green-600 dark:text-green-400">{fmtMoney(incomeRows[i].amount)}</span>
                    </div>
                  ) : null}
                </td>
                <td className="py-1.5 pl-4 border-l border-gray-100 dark:border-white/5">
                  {expenseRows[i] ? (
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-white/60">{expenseRows[i].category}</span>
                      <span className="font-medium text-red-500 dark:text-red-400">{fmtMoney(expenseRows[i].amount)}</span>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 dark:border-white/20 font-semibold">
              <td className="pt-2 pr-4">
                <div className="flex justify-between">
                  <span className="text-gray-700 dark:text-white/80">Total Income</span>
                  <span className="text-green-600 dark:text-green-400">{fmtMoney(totalIncome)}</span>
                </div>
              </td>
              <td className="pt-2 pl-4 border-l border-gray-200 dark:border-white/10">
                <div className="flex justify-between">
                  <span className="text-gray-700 dark:text-white/80">Total Expenses</span>
                  <span className="text-red-500 dark:text-red-400">{fmtMoney(totalExpense)}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="pt-2">
                <div className="flex justify-between items-center bg-gray-50 dark:bg-white/5 rounded-lg px-3 py-2">
                  <span className="font-semibold text-gray-700 dark:text-white/80">Net Profit</span>
                  <span className={`font-bold text-lg ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {net < 0 ? '-' : ''}{fmtMoney(net)}
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardShell>
  )
}

// ─── Transaction Modal (Add / Edit) ───────────────────────────────────────────

function TransactionModal({ editing, onClose, onSave }) {
  const today = toYMD(new Date())
  const [form, setForm] = useState(() => editing
    ? {
        date:           editing.date,
        type:           editing.type,
        amount:         String(Math.abs(editing.amount)),
        description:    editing.description,
        category:       editing.category ?? '',
        source:         editing.source ?? '',
        tax_deductible: editing.tax_deductible ?? false,
        notes:          editing.notes ?? '',
      }
    : {
        date: today, type: 'income', amount: '', description: '',
        category: '', source: '', tax_deductible: true, notes: '',
      }
  )
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [conflict, setConflict] = useState(null)  // { existing }

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  function set(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v }
      // Auto-set tax_deductible default when expense category changes
      if (k === 'category' && next.type === 'expense') {
        next.tax_deductible = TAX_DEFAULT[v] ?? false
      }
      // Reset category when type changes
      if (k === 'type') {
        next.category = ''
        if (v === 'income') next.tax_deductible = false
        else next.tax_deductible = true
      }
      return next
    })
    setConflict(null)
  }

  async function handleSubmit(force = false) {
    if (!form.date || !form.description || !form.amount || !form.type) {
      setError('Date, type, amount, and description are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await onSave({
        ...(editing ? { id: editing.id } : {}),
        date:           form.date,
        type:           form.type,
        amount:         parseFloat(form.amount),
        description:    form.description,
        category:       form.category || null,
        source:         form.source   || null,
        tax_deductible: form.type === 'expense' ? form.tax_deductible : false,
        notes:          form.notes    || null,
      }, force)
      if (result?.conflict) {
        setConflict(result)
        setSaving(false)
        return
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-secondary rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {editing ? 'Edit Transaction' : 'Add Transaction'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/80 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Date */}
          <div>
            <Label>Date</Label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
          </div>

          {/* Type toggle */}
          <div>
            <Label>Type</Label>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10">
              {['income','expense'].map(t => (
                <button key={t} onClick={() => set('type', t)}
                  className={`flex-1 py-2 text-sm font-medium capitalize transition-colors ${
                    form.type === t
                      ? t === 'income'
                        ? 'bg-green-500 text-white'
                        : 'bg-red-500 text-white'
                      : 'bg-gray-50 text-gray-600 dark:bg-white/5 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <Label>Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/40 text-sm">$</span>
              <input type="number" min="0" step="0.01" value={form.amount}
                onChange={e => set('amount', e.target.value)}
                placeholder="0.00"
                className={inputCls + ' pl-7'} />
            </div>
          </div>

          {/* Description */}
          <div>
            <Label>Description</Label>
            <input type="text" value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Payment description" className={inputCls} />
          </div>

          {/* Category */}
          <div>
            <Label>Category</Label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className={selectCls}>
              <option value="">— Select category —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Source/Payee */}
          <div>
            <Label>{form.type === 'income' ? 'Carrier / Source' : 'Vendor / Payee'}</Label>
            <input type="text" value={form.source}
              onChange={e => set('source', e.target.value)}
              placeholder={form.type === 'income' ? 'e.g. Transamerica' : 'e.g. Agent Office Supply'}
              className={inputCls} />
          </div>

          {/* Tax deductible — expense only */}
          {form.type === 'expense' && (
            <div className="flex items-center gap-3">
              <input type="checkbox" id="tax_ded" checked={form.tax_deductible}
                onChange={e => set('tax_deductible', e.target.checked)}
                className="w-4 h-4 accent-accent rounded" />
              <label htmlFor="tax_ded" className="text-sm text-gray-700 dark:text-white/80 cursor-pointer">
                Tax deductible
              </label>
            </div>
          )}

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Optional notes..."
              className={inputCls + ' resize-none'} />
          </div>

          {/* Conflict warning */}
          {conflict && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-500/30 rounded-lg p-3 text-sm">
              <p className="text-yellow-800 dark:text-yellow-300 font-medium mb-2">
                This looks like a duplicate of an existing entry
              </p>
              <p className="text-yellow-700 dark:text-yellow-400 text-xs mb-3">
                {parseDateLocal(conflict.existing.date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {conflict.existing.description} — {fmtMoney(Math.abs(conflict.existing.amount))}
              </p>
              <div className="flex gap-2">
                <button onClick={() => handleSubmit(true)}
                  className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
                  Save anyway
                </button>
                <button onClick={() => setConflict(null)}
                  className="text-xs text-yellow-700 dark:text-yellow-400 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={() => handleSubmit(false)} disabled={saving}
            className="px-5 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Transaction'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk Import Wizard ────────────────────────────────────────────────────────

const AMOUNT_FORMATS = [
  { key: 'pos_income',  label: 'Single column — positive = income, negative = expense' },
  { key: 'pos_expense', label: 'Single column — positive = expense, negative = income' },
  { key: 'split',       label: 'Separate credit and debit columns' },
]

function BulkImportWizard({ onImported }) {
  const [step, setStep] = useState(0)

  // Step 0 → 1: CSV parse
  const [headers,    setHeaders]    = useState([])
  const [rawRows,    setRawRows]    = useState([])

  // Step 1 → 2: mapping
  const [mapping, setMapping] = useState({
    dateCol: '', descCol: '', amountCol: '', creditCol: '', debitCol: '',
    amtFormat: 'pos_income',
  })

  // Step 2: rows
  const [parsedRows, setParsedRows] = useState([])   // { idx, date, description, amount, type, hash, status, selected }
  const [filterView, setFilterView] = useState('all') // 'all'|'duplicates'|'valid'

  // Step 3: categories
  const [catMap, setCatMap] = useState({})   // { description: { type, category } }

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const dropRef = useRef(null)

  function reset() {
    setStep(0); setHeaders([]); setRawRows([]); setParsedRows([])
    setMapping({ dateCol: '', descCol: '', amountCol: '', creditCol: '', debitCol: '', amtFormat: 'pos_income' })
    setFilterView('all'); setCatMap({}); setResult(null)
  }

  function handleFile(file) {
    if (!file) return
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: ({ data, meta }) => {
        setHeaders(meta.fields ?? [])
        setRawRows(data)
        // Auto-guess columns
        const fields = (meta.fields ?? []).map(f => f.toLowerCase())
        const guess = (keywords) => meta.fields?.find((_, i) => keywords.some(k => fields[i]?.includes(k))) ?? ''
        setMapping(m => ({
          ...m,
          dateCol:   guess(['date','posted','trans']),
          descCol:   guess(['description','memo','narration','details']),
          amountCol: guess(['amount','debit','credit','value']),
        }))
        setStep(1)
      },
    })
  }

  async function goToStep2() {
    const { dateCol, descCol, amountCol, creditCol, debitCol, amtFormat } = mapping
    if (!dateCol || !descCol) return

    setBusy(true)

    // Fetch existing hashes
    let existingHashes = new Set()
    try {
      const res = await fetch('/api/transactions?hashes_only=1')
      const { hashes } = await res.json()
      existingHashes = new Set(hashes ?? [])
    } catch { /* ignore, dedup won't work but import still proceeds */ }

    // Parse all rows and compute hashes
    const parsed = await Promise.all(rawRows.map(async (row, idx) => {
      const rawDate   = row[dateCol]   ?? ''
      const rawDesc   = row[descCol]   ?? ''
      const date      = parseCSVDate(rawDate)

      let amount = null, type = null
      if (amtFormat === 'split') {
        const credit = parseCSVAmount(row[creditCol])
        const debit  = parseCSVAmount(row[debitCol])
        if (credit != null && credit !== 0) { amount = Math.abs(credit); type = 'income' }
        else if (debit != null && debit !== 0) { amount = -Math.abs(debit); type = 'expense' }
      } else {
        const raw = parseCSVAmount(row[amountCol])
        if (raw != null) {
          const signed = amtFormat === 'pos_expense' ? -raw : raw
          amount = signed
          type   = signed >= 0 ? 'income' : 'expense'
        }
      }

      const invalid = !date || amount === null || !rawDesc.trim()
      if (invalid) {
        return { idx, rawDate, rawDesc, date, amount, type, status: 'invalid', selected: false, hash: '' }
      }

      const signedAmt = type === 'expense' ? -Math.abs(amount) : Math.abs(amount)
      const hash = await hashClient(date, signedAmt, rawDesc)
      const status = existingHashes.has(hash) ? 'duplicate' : 'ready'
      return { idx, rawDate, rawDesc, date, amount: signedAmt, type, status, selected: status !== 'invalid', hash }
    }))

    setParsedRows(parsed)
    setBusy(false)
    setStep(2)
  }

  function toggleRow(idx) {
    setParsedRows(rows => rows.map(r => r.idx === idx ? { ...r, selected: !r.selected } : r))
  }

  function selectAll()   { setParsedRows(r => r.map(x => x.status !== 'invalid' ? { ...x, selected: true }  : x)) }
  function deselectAll() { setParsedRows(r => r.map(x => ({ ...x, selected: false }))) }
  function deselectDupes() { setParsedRows(r => r.map(x => x.status === 'duplicate' ? { ...x, selected: false } : x)) }

  function goToStep3() {
    const selected = parsedRows.filter(r => r.selected)
    const uniqueDescs = [...new Set(selected.map(r => r.rawDesc))]
    const initial = {}
    for (const d of uniqueDescs) {
      // Pre-fill based on type of first matching row
      const row = selected.find(r => r.rawDesc === d)
      initial[d] = { type: row?.type ?? 'income', category: '' }
    }
    // Merge any already set
    setCatMap(prev => Object.fromEntries(uniqueDescs.map(d => [d, prev[d] ?? initial[d]])))
    setStep(3)
  }

  async function confirmImport() {
    const selected = parsedRows.filter(r => r.selected)
    if (!selected.length) return
    setBusy(true)
    try {
      const transactions = selected.map(r => {
        const cat = catMap[r.rawDesc]
        return {
          date:           r.date,
          description:    r.rawDesc,
          amount:         r.amount,
          type:           cat?.type ?? r.type,
          category:       cat?.category || null,
          tax_deductible: cat?.type === 'expense' ? (TAX_DEFAULT[cat?.category] ?? false) : false,
        }
      })
      const res = await fetch('/api/transactions?bulk=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')
      setResult(data)
      setStep(4)
      onImported()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const visibleRows = parsedRows.filter(r =>
    filterView === 'all'        ? true :
    filterView === 'duplicates' ? r.status === 'duplicate' :
    filterView === 'valid'      ? r.status !== 'invalid' : true
  )
  const selectedCount   = parsedRows.filter(r => r.selected).length
  const duplicateCount  = parsedRows.filter(r => r.selected && r.status === 'duplicate').length
  const excludedCount   = parsedRows.filter(r => !r.selected || r.status === 'invalid').length
  const dupIncludeCount = parsedRows.filter(r => r.status === 'duplicate' && r.selected).length

  const previewRows = rawRows.slice(0, 3)

  return (
    <div className="space-y-4">

      {/* ── Step 0: Drop zone ── */}
      {step === 0 && (
        <div
          ref={dropRef}
          onDragOver={e => { e.preventDefault(); dropRef.current.classList.add('border-accent') }}
          onDragLeave={() => dropRef.current.classList.remove('border-accent')}
          onDrop={e => { e.preventDefault(); dropRef.current.classList.remove('border-accent'); handleFile(e.dataTransfer.files[0]) }}
          className="border-2 border-dashed border-gray-300 dark:border-white/20 rounded-xl p-10 text-center cursor-pointer transition-colors hover:border-accent"
          onClick={() => document.getElementById('csv-upload').click()}
        >
          <svg className="w-10 h-10 text-gray-300 dark:text-white/20 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p className="text-sm font-medium text-gray-700 dark:text-white/70">Drop a CSV file here, or click to browse</p>
          <p className="text-xs text-gray-400 dark:text-white/30 mt-1">Bank exports, credit card statements, etc.</p>
          <input id="csv-upload" type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}

      {/* ── Step 1: Column mapping ── */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-white/60">
            We need to identify the following fields in your CSV. Select the column that contains each one.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Date', key: 'dateCol', required: true },
              { label: 'Description', key: 'descCol', required: true },
              { label: 'Amount', key: 'amountCol', required: false },
            ].map(f => (
              <div key={f.key}>
                <Label>{f.label}{f.required ? '' : ' (if single column)'}</Label>
                <select value={mapping[f.key]} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))} className={selectCls}>
                  <option value="">— Select column —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div>
            <Label>How does your bank show amounts?</Label>
            <div className="space-y-1.5 mt-1">
              {AMOUNT_FORMATS.map(af => (
                <label key={af.key} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="amtFormat" value={af.key}
                    checked={mapping.amtFormat === af.key}
                    onChange={() => setMapping(m => ({ ...m, amtFormat: af.key }))}
                    className="accent-accent" />
                  <span className="text-sm text-gray-700 dark:text-white/70">{af.label}</span>
                </label>
              ))}
            </div>
          </div>

          {mapping.amtFormat === 'split' && (
            <div className="grid grid-cols-2 gap-4">
              {[{ label: 'Credit (income) column', key: 'creditCol' }, { label: 'Debit (expense) column', key: 'debitCol' }].map(f => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <select value={mapping[f.key]} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))} className={selectCls}>
                    <option value="">— Not present —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Preview table */}
          {previewRows.length > 0 && mapping.dateCol && mapping.descCol && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wide mb-2">
                Preview (first 3 rows)
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      {[mapping.dateCol, mapping.descCol, mapping.amtFormat === 'split' ? [mapping.creditCol, mapping.debitCol].filter(Boolean).join(' / ') : mapping.amountCol].filter(Boolean).map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-500 dark:text-white/40 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-white/5">
                        <td className="px-3 py-2 text-gray-700 dark:text-white/70">{row[mapping.dateCol]}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-white/70">{row[mapping.descCol]}</td>
                        {mapping.amtFormat === 'split'
                          ? <td className="px-3 py-2 text-gray-700 dark:text-white/70">{row[mapping.creditCol] || row[mapping.debitCol]}</td>
                          : <td className="px-3 py-2 text-gray-700 dark:text-white/70">{row[mapping.amountCol]}</td>
                        }
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={reset} className="px-4 py-2 text-sm text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white transition-colors">
              ← Back
            </button>
            <button onClick={goToStep2} disabled={!mapping.dateCol || !mapping.descCol || busy}
              className="px-5 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {busy ? 'Processing…' : 'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Row selection ── */}
      {step === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={selectAll}     className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">Select all</button>
            <button onClick={deselectAll}   className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-200 dark:hover:bg-white/15 transition-colors">Deselect all</button>
            {parsedRows.some(r => r.status === 'duplicate') && (
              <button onClick={deselectDupes} className="text-xs px-3 py-1.5 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors">
                Deselect duplicates
              </button>
            )}
            <div className="flex gap-1 ml-auto">
              {['all','valid','duplicates'].map(v => (
                <button key={v} onClick={() => setFilterView(v)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${filterView === v ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/70'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10 max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-white/5 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  {['Date','Description','Amount','Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-gray-500 dark:text-white/40 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row.idx}
                    className={`border-t border-gray-100 dark:border-white/5 ${
                      row.status === 'duplicate' ? 'bg-yellow-50/50 dark:bg-yellow-900/10' :
                      row.status === 'invalid'   ? 'bg-red-50/50 dark:bg-red-900/10 opacity-60' : ''
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={row.selected} disabled={row.status === 'invalid'}
                        onChange={() => toggleRow(row.idx)} className="accent-accent" />
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-white/70 whitespace-nowrap">
                      {row.date ?? row.rawDate}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-white/70 max-w-xs truncate">
                      {row.rawDesc}
                    </td>
                    <td className={`px-3 py-2 font-medium whitespace-nowrap ${row.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {row.amount != null ? fmtMoney(row.amount) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.status === 'ready'     ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        row.status === 'duplicate' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {row.status === 'ready' ? 'Ready' : row.status === 'duplicate' ? 'Possible duplicate' : 'Invalid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white transition-colors">← Back</button>
            <button onClick={goToStep3} disabled={selectedCount === 0}
              className="px-5 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              Continue with {selectedCount} row{selectedCount !== 1 ? 's' : ''} →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Categorize ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 text-sm space-y-1">
            <p className="text-gray-700 dark:text-white/80"><span className="font-semibold">{selectedCount}</span> rows selected for import</p>
            {dupIncludeCount > 0 && <p className="text-yellow-600 dark:text-yellow-400">{dupIncludeCount} possible duplicate{dupIncludeCount !== 1 ? 's' : ''} included</p>}
            <p className="text-gray-400 dark:text-white/30">{excludedCount} row{excludedCount !== 1 ? 's' : ''} excluded</p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-white/70 mb-2">
              Apply categories before importing (optional but recommended)
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {Object.keys(catMap).map(desc => {
                const entry = catMap[desc]
                const cats  = entry.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
                return (
                  <div key={desc} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-white/5">
                    <span className="flex-1 text-xs text-gray-600 dark:text-white/60 truncate min-w-0">{desc}</span>
                    <div className="flex gap-1">
                      {['income','expense'].map(t => (
                        <button key={t} onClick={() => setCatMap(m => ({ ...m, [desc]: { ...m[desc], type: t, category: '' } }))}
                          className={`text-xs px-2 py-1 rounded capitalize transition-colors ${entry.type === t ? (t==='income' ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-white/50'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <select value={entry.category}
                      onChange={e => setCatMap(m => ({ ...m, [desc]: { ...m[desc], category: e.target.value } }))}
                      className="text-xs border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:ring-1 focus:ring-accent/60 w-40">
                      <option value="">No category</option>
                      {cats.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white transition-colors">← Back</button>
            <button onClick={confirmImport} disabled={busy}
              className="px-5 py-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {busy ? 'Importing…' : `Import ${selectedCount} transaction${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Done ── */}
      {step === 4 && result && (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-semibold text-gray-900 dark:text-white">Import complete</p>
          <p className="text-sm text-gray-500 dark:text-white/50 mt-1">
            Imported {result.inserted} transaction{result.inserted !== 1 ? 's' : ''}{result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''}` : ''}
          </p>
          <button onClick={reset} className="mt-4 text-sm text-accent hover:text-accent/80 transition-colors font-medium">
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Transaction Table ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const ALL_CATEGORIES = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])]

function TransactionTable({ transactions, onEdit, onDelete, period, canWrite }) {
  const showActions = !!(onEdit || onDelete)
  const [filterType, setFilterType] = useState('all')
  const [filterCats, setFilterCats] = useState([])
  const [filterSearch, setFilterSearch] = useState('')
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [catMenuOpen, setCatMenuOpen] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const catMenuRef = useRef(null)

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [filterType, filterCats, filterSearch, period])

  useEffect(() => {
    function handleClick(e) {
      if (catMenuRef.current && !catMenuRef.current.contains(e.target)) setCatMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const filtered = useMemo(() => {
    let rows = transactions
    if (filterType !== 'all') rows = rows.filter(tx => tx.type === filterType)
    if (filterCats.length > 0) rows = rows.filter(tx => filterCats.includes(tx.category))
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      rows = rows.filter(tx =>
        tx.description?.toLowerCase().includes(q) ||
        tx.source?.toLowerCase().includes(q)
      )
    }
    return [...rows].sort((a, b) => {
      let av = sortField === 'amount' ? Math.abs(a.amount) : a[sortField]
      let bv = sortField === 'amount' ? Math.abs(b.amount) : b[sortField]
      if (av == null) av = ''
      if (bv == null) bv = ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [transactions, filterType, filterCats, filterSearch, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows   = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  function SortIcon({ field }) {
    if (sortField !== field) return <span className="opacity-20">↕</span>
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  async function handleDelete(id) {
    setDeletingId(id)
    try { await onDelete(id) }
    finally { setDeletingId(null) }
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Type */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 text-xs">
          {['all','income','expense'].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filterType === t
                  ? t === 'income'  ? 'bg-green-500 text-white'
                  : t === 'expense' ? 'bg-red-500 text-white'
                  : 'bg-accent text-white'
                  : 'text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>{t}</button>
          ))}
        </div>

        {/* Category multi-select */}
        <div className="relative" ref={catMenuRef}>
          <button onClick={() => setCatMenuOpen(o => !o)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filterCats.length > 0
                ? 'border-accent text-accent bg-accent/5'
                : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            Category {filterCats.length > 0 && <span className="bg-accent text-white rounded-full px-1.5 py-0.5 text-[10px]">{filterCats.length}</span>}
            <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </button>
          {catMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-xl shadow-xl z-20 py-1 max-h-60 overflow-y-auto">
              <button onClick={() => setFilterCats([])} className="w-full text-left px-4 py-2 text-xs text-gray-500 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5">
                Clear filter
              </button>
              {ALL_CATEGORIES.map(c => (
                <button key={c} onClick={() => setFilterCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                  className="w-full text-left px-4 py-2 text-xs flex items-center gap-2 text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${filterCats.includes(c) ? 'bg-accent border-accent' : 'border-gray-300 dark:border-white/20'}`}>
                    {filterCats.includes(c) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                  </span>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-40">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="Search description or payee…"
            className="w-full text-xs bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-gray-700 dark:text-white/70 placeholder:text-gray-400 dark:placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-accent/60" />
        </div>

        <p className="text-xs text-gray-400 dark:text-white/30 ml-auto">
          {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr>
              {[
                { label: 'Date', field: 'date', sortable: true },
                { label: 'Description', field: 'description', sortable: false },
                { label: 'Category', field: 'category', sortable: false },
                { label: 'Source / Payee', field: 'source', sortable: false },
                { label: 'Amount', field: 'amount', sortable: true, right: true },
                { label: 'Tax Ded.', field: null, sortable: false, right: true },
                ...(showActions ? [{ label: '', field: null, sortable: false }] : []),
              ].map(col => (
                <th key={col.label}
                  className={`px-4 py-3 text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-wide whitespace-nowrap ${col.right ? 'text-right' : 'text-left'} ${col.sortable ? 'cursor-pointer hover:text-gray-700 dark:hover:text-white/70 select-none' : ''}`}
                  onClick={() => col.sortable && toggleSort(col.field)}
                >
                  {col.label} {col.sortable && <SortIcon field={col.field} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400 dark:text-white/30 text-sm">
                  {transactions.length === 0 ? 'No transactions yet — add one above or import a CSV.' : 'No transactions match your filters.'}
                </td>
              </tr>
            ) : pageRows.map(tx => (
              <tr key={tx.id} className="border-t border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                <td className="px-4 py-3 text-gray-700 dark:text-white/70 whitespace-nowrap">
                  {parseDateLocal(tx.date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? tx.date}
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-white max-w-xs">
                  <div className="truncate">{tx.description}</div>
                  {tx.notes && <div className="text-xs text-gray-400 dark:text-white/30 truncate">{tx.notes}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs">{tx.category || '—'}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-white/60 text-xs">{tx.source || '—'}</td>
                <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${tx.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  {fmtMoney(Math.abs(tx.amount))}
                </td>
                <td className="px-4 py-3 text-right">
                  {tx.type === 'expense' && tx.tax_deductible && (
                    <svg className="w-4 h-4 text-blue-500 dark:text-blue-400 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </td>
                {showActions && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onEdit && (
                        <button onClick={() => onEdit(tx)} className="text-gray-400 hover:text-accent dark:hover:text-accent transition-colors p-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                          </svg>
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={() => handleDelete(tx.id)} disabled={deletingId === tx.id}
                          className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1 disabled:opacity-40">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/40">
          <p>Showing {(page-1)*PAGE_SIZE + 1}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}</p>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">←</button>
            <span className="px-2 py-1">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="px-2 py-1 rounded disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">→</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function IncomePage() {
  const { theme } = useTheme()
  const { permissions } = useViewing()

  const [allTx,   setAllTx]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const [period, setPeriod] = useState(() => computePeriod('month'))

  const [showAdd,    setShowAdd]    = useState(false)
  const [editTx,     setEditTx]     = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteErr,  setDeleteErr]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/transactions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load transactions')
      setAllTx(data.transactions ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Permission guard — after all hooks (rules-of-hooks)
  if (!permissions.income?.read) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400 dark:text-white/30 text-sm">
        You don&apos;t have access to this section.
      </div>
    )
  }

  const canWrite = !!permissions.income?.write

  // Period-filtered transactions
  const periodTx = useMemo(() =>
    allTx.filter(tx => tx.date >= period.start && tx.date <= period.end),
    [allTx, period]
  )

  // Summary
  const summary = useMemo(() => {
    let income = 0, expense = 0, taxDeductible = 0
    for (const tx of periodTx) {
      if (tx.type === 'income')  income       += tx.amount
      else                       expense      += Math.abs(tx.amount)
      if (tx.tax_deductible && tx.type === 'expense') taxDeductible += Math.abs(tx.amount)
    }
    return { income, expense, net: income - expense, taxDeductible }
  }, [periodTx])

  // 12-month rolling bar chart data
  const rolling12 = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        ym:      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label:   d.toLocaleDateString('en-US', { month: 'short' }),
        income:  0,
        expense: 0,
      })
    }
    for (const tx of allTx) {
      const ym = tx.date?.slice(0, 7)
      const m  = months.find(x => x.ym === ym)
      if (!m) continue
      if (tx.type === 'income') m.income  += tx.amount
      else                      m.expense += Math.abs(tx.amount)
    }
    return months
  }, [allTx])

  // Save handler (add or edit)
  async function handleSave(tx, force = false) {
    const isEdit = !!tx.id
    const url    = isEdit ? `/api/transactions?id=${tx.id}` : '/api/transactions'
    const method = isEdit ? 'PATCH' : 'POST'
    const body   = force ? { ...tx, force: true } : tx

    const res  = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (res.status === 409) return { conflict: true, existing: data.existing }
    if (!res.ok) throw new Error(data.error ?? 'Failed to save transaction')

    await load()
    setShowAdd(false)
    setEditTx(null)
    return { success: true }
  }

  async function handleDelete(id) {
    setDeleteErr(null)
    const res = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      setDeleteErr(data.error ?? 'Delete failed')
      return
    }
    await load()
  }

  const showYTD = isFullMonths(period)

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Income &amp; Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">Track your business income and deductible expenses</p>
        </div>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400 dark:text-white/30 gap-3">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4}/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Loading transactions…
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <SummaryCards summary={summary} periodLabel={periodLabel(period)} />

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <IncomeExpenseBarChart rolling12={rolling12} theme={theme} />
            <CategoryDonutCharts periodTx={periodTx} theme={theme} />
          </div>
          <RunningBalanceChart periodTx={periodTx} theme={theme} />
          {showYTD && <YTDTable periodTx={periodTx} />}

          {/* Bulk import — write only */}
          {canWrite && <CardShell>
            <button
              onClick={() => setImportOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-500 dark:text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-white/80">Bulk CSV Import</span>
                {!importOpen && <span className="text-xs text-gray-400 dark:text-white/30">— import transactions from your bank</span>}
              </div>
              <svg className={`w-4 h-4 text-gray-400 dark:text-white/30 transition-transform ${importOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
            {importOpen && (
              <div className="px-5 pb-5 border-t border-gray-100 dark:border-white/5 pt-4">
                <BulkImportWizard onImported={() => { load(); }} />
              </div>
            )}
          </CardShell>}

          {/* Transaction table */}
          <CardShell className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Transactions</h2>
              {canWrite && (
                <button onClick={() => { setEditTx(null); setShowAdd(true) }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                  </svg>
                  Add Transaction
                </button>
              )}
            </div>

            {deleteErr && (
              <p className="text-sm text-red-500 dark:text-red-400 mb-3">{deleteErr}</p>
            )}

            <TransactionTable
              transactions={periodTx}
              onEdit={canWrite ? tx => { setEditTx(tx); setShowAdd(true) } : null}
              onDelete={canWrite ? handleDelete : null}
              period={period}
            />
          </CardShell>
        </>
      )}

      {/* Add/Edit modal */}
      {showAdd && (
        <TransactionModal
          editing={editTx}
          onClose={() => { setShowAdd(false); setEditTx(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
