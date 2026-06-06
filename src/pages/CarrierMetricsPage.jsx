import { useEffect, useMemo, useState } from 'react'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(val) {
  if (val === null || val === undefined || val === 0) return '—'
  return `${val}%`
}

function buildCarrierTotal(carrier, subtypeRows) {
  const issued    = subtypeRows.reduce((s, r) => s + r.issued,    0)
  const declined  = subtypeRows.reduce((s, r) => s + r.declined,  0)
  const withdrawn = subtypeRows.reduce((s, r) => s + r.withdrawn, 0)
  const not_taken = subtypeRows.reduce((s, r) => s + r.not_taken, 0)
  const total     = issued + declined + withdrawn + not_taken
  const pct       = n => total ? Math.round(n / total * 100) : null

  const daysSum = subtypeRows.reduce((s, r) => s + (r.issue_days_sum   ?? 0), 0)
  const daysCnt = subtypeRows.reduce((s, r) => s + (r.issue_days_count ?? 0), 0)

  return {
    carrier,
    issued, declined, withdrawn, not_taken,
    issued_pct:    pct(issued),
    declined_pct:  pct(declined),
    withdrawn_pct: pct(withdrawn),
    not_taken_pct: pct(not_taken),
    avg_issue_days: daysCnt > 0 ? Math.round(daysSum / daysCnt) : null,
  }
}

// ── PctCell — colour only; alignment lives on the <td> ────────────────────────

function PctCell({ val, kind }) {
  const text = fmt(val)
  let cls
  if (text === '—') {
    cls = 'text-gray-300 dark:text-white/20'
  } else if (kind === 'issued') {
    cls = val >= 80 ? 'text-green-700 dark:text-green-400 font-semibold'
        : val >= 60 ? 'text-green-600 dark:text-green-500'
        : 'text-gray-700 dark:text-white/80'
  } else if (kind === 'declined') {
    cls = val >= 20 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-white/80'
  } else {
    cls = 'text-gray-700 dark:text-white/80'
  }
  return <span className={cls}>{text}</span>
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CarrierMetricsPage() {
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [collapsed, setCollapsed] = useState(new Set())

  useEffect(() => {
    fetch('/api/policies?type=carrier-metrics')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setRows(data)
        else setError(data?.error ?? 'Failed to load carrier metrics')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const carrierGroups = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      if (!map.has(row.carrier)) map.set(row.carrier, [])
      map.get(row.carrier).push(row)
    }
    return Array.from(map.entries()).map(([carrier, subtypes]) => ({
      carrier,
      subtypes,
      total: buildCarrierTotal(carrier, subtypes),
    }))
  }, [rows])

  function toggle(carrier) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(carrier) ? next.delete(carrier) : next.add(carrier)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Carrier Metrics</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-white/50">
              Placement rates and average issue time — all agents, all time
            </p>
          </div>
          {!loading && !error && carrierGroups.length > 0 && (
            <div className="flex gap-2 shrink-0 mt-1">
              <button
                onClick={() => setCollapsed(new Set())}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-white dark:hover:bg-white/5 transition-colors"
              >
                Expand all
              </button>
              <button
                onClick={() => setCollapsed(new Set(carrierGroups.map(g => g.carrier)))}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-white dark:hover:bg-white/5 transition-colors"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">

        {loading && (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && carrierGroups.length === 0 && (
          <div className="flex items-center justify-center h-48 text-gray-400 dark:text-white/30 text-sm">
            No policy data available yet.
          </div>
        )}

        {!loading && !error && carrierGroups.length > 0 && (
          <div className="bg-white dark:bg-primary border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                  <th className="text-left  px-4 py-3 font-semibold text-gray-600 dark:text-white/60 w-52">Carrier</th>
                  <th className="text-left  px-3 py-3 font-semibold text-gray-600 dark:text-white/60 w-44">Subtype</th>
                  <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-white/60 w-20">Issued</th>
                  <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-white/60 w-20">Declined</th>
                  <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-white/60 w-24">Withdrawn</th>
                  <th className="text-right px-3 py-3 font-semibold text-gray-600 dark:text-white/60 w-24">Not Taken</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-white/60 w-28">Avg Days</th>
                </tr>
              </thead>
              <tbody>
                {carrierGroups.map((group, gi) => {
                  const isCollapsed = collapsed.has(group.carrier)
                  const isLast      = gi === carrierGroups.length - 1
                  return (
                    <CarrierGroup
                      key={group.carrier}
                      group={group}
                      isCollapsed={isCollapsed}
                      onToggle={() => toggle(group.carrier)}
                      isLast={isLast}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CarrierGroup ───────────────────────────────────────────────────────────────

function CarrierGroup({ group, isCollapsed, onToggle, isLast }) {
  const showDivider = isLast ? 'border-transparent' : 'border-gray-200 dark:border-white/10'
  return (
    <>
      {/* Carrier total row — always first; caret expands/collapses subtypes below */}
      <tr className={`bg-gray-50 dark:bg-white/[0.04] border-b-2 ${isCollapsed ? showDivider : 'border-transparent'}`}>
        <td className="px-4 py-2.5">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 text-gray-800 dark:text-white hover:text-accent transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform text-gray-400 dark:text-white/30 ${isCollapsed ? '-rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <span className="font-semibold text-sm">{group.carrier} Total</span>
          </button>
        </td>
        <td className="px-3 py-2.5" />
        <td className="px-3 py-2.5 text-right tabular-nums"><PctCell val={group.total.issued_pct}    kind="issued"   /></td>
        <td className="px-3 py-2.5 text-right tabular-nums"><PctCell val={group.total.declined_pct}  kind="declined" /></td>
        <td className="px-3 py-2.5 text-right tabular-nums"><PctCell val={group.total.withdrawn_pct} kind="other"    /></td>
        <td className="px-3 py-2.5 text-right tabular-nums"><PctCell val={group.total.not_taken_pct} kind="other"    /></td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-700 dark:text-white/80">
          {group.total.avg_issue_days ?? '—'}
        </td>
      </tr>

      {/* Subtype rows — indented below, visible when expanded */}
      {!isCollapsed && group.subtypes.map((row, ri) => (
        <tr
          key={`${row.carrier}|${row.subtype ?? ''}|${ri}`}
          className={`border-b transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]
            ${ri === group.subtypes.length - 1 && !isLast
              ? 'border-b-2 border-gray-200 dark:border-white/10'
              : 'border-gray-100 dark:border-white/5'
            }`}
        >
          <td className="px-4 py-2" />
          <td className="px-3 py-2 text-gray-600 dark:text-white/60 pl-8">
            {row.subtype ?? <span className="text-gray-300 dark:text-white/20">—</span>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums"><PctCell val={row.issued_pct}    kind="issued"   /></td>
          <td className="px-3 py-2 text-right tabular-nums"><PctCell val={row.declined_pct}  kind="declined" /></td>
          <td className="px-3 py-2 text-right tabular-nums"><PctCell val={row.withdrawn_pct} kind="other"    /></td>
          <td className="px-3 py-2 text-right tabular-nums"><PctCell val={row.not_taken_pct} kind="other"    /></td>
          <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-white/60">
            {row.avg_issue_days ?? '—'}
          </td>
        </tr>
      ))}
    </>
  )
}
