// MetricsSection — purely presentational.
// Data is fetched once by Dashboard and passed as props.
// Mode toggle calls onModeChange(newMode) so Dashboard can re-fetch.

import { useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { SectionShell } from './MyInfoSection'
import { fmtCurrency as fmtAmt } from '../../utils/format'

export default function MetricsSection({
  subject,
  canWrite,
  appsData,
  isDirector,
  mode,
  loading,
  onModeChange,
  canBreakdown,
}) {
  const { theme }  = useTheme()
  const [breakdown, setBreakdown] = useState(null)   // { title, type, items }

  const stats  = appsData?.metrics ?? null
  const detail = appsData?.detail  ?? null

  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  if (loading || !stats) return (
    <SectionShell title="Metrics">
      <div className="animate-pulse space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-white/10 rounded-xl" />)}
        </div>
        <div className="h-10 bg-gray-100 dark:bg-white/10 rounded" />
        <div className="h-10 bg-gray-100 dark:bg-white/10 rounded" />
      </div>
    </SectionShell>
  )

  return (
    <SectionShell title="Metrics" canWrite={canWrite}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">This Month</p>
        <div className="flex items-center gap-3">
          {isDirector && (
            <select
              value={mode}
              onChange={e => onModeChange?.(e.target.value)}
              className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="master"   style={optionStyle}>Master Agency</option>
              <option value="baseshop" style={optionStyle}>My Baseshop</option>
            </select>
          )}
          <p className="text-sm text-gray-400 dark:text-white/40">{monthLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="Submitted APV"
          value={fmtAmt(stats?.submMonth)}
          proj={fmtAmt(stats?.projSubmMonth)}
          onClick={canBreakdown && detail ? () => setBreakdown({ title: `Submitted APV — ${monthLabel}`, type: 'apv', items: detail.submMonthItems, apvKey: 'subm_apv', dateKey: 'submit_week' }) : null}
        />
        <KpiCard
          label="Issued APV"
          value={fmtAmt(stats?.issMonth)}
          proj={fmtAmt(stats?.projIssMonth)}
          onClick={canBreakdown && detail ? () => setBreakdown({ title: `Issued APV — ${monthLabel}`, type: 'apv', items: detail.issMonthItems, apvKey: 'issued_apv', dateKey: 'issue_date' }) : null}
        />
        <KpiCard
          label="New Writers"
          value={stats?.newWritersMonth ?? '—'}
          proj={stats?.projNewWritersMonth}
          onClick={canBreakdown && detail ? () => setBreakdown({ title: `New Writers — ${monthLabel}`, type: 'writers', items: detail.newWritersItems }) : null}
        />
        <KpiCard
          label="Total Writers"
          value={stats?.totalWritersMonth ?? '—'}
          onClick={canBreakdown && detail ? () => setBreakdown({ title: `Total Writers — ${monthLabel}`, type: 'writers', items: detail.totalWritersItems }) : null}
        />
        <KpiCard
          label="Pending Business"
          value={fmtAmt(stats?.pendingSubmAPV)}
          onClick={canBreakdown && appsData?.pending ? () => setBreakdown({ title: 'Pending Business', type: 'policies', items: appsData.pending }) : null}
        />
        <KpiCard
          label="Open Requirement"
          value={fmtAmt(stats?.openReqSubmAPV)}
          highlight={stats?.openReqSubmAPV > 0}
          onClick={canBreakdown && appsData?.incomplete ? () => setBreakdown({ title: 'Open Requirements (Incomplete)', type: 'policies', items: appsData.incomplete }) : null}
        />
      </div>

      <div className="border-t border-gray-200 dark:border-white/10 pt-5 space-y-4">
        <WeekRow
          label="This Week"
          submApv={fmtAmt(stats?.submWeek)}
          newWriters={stats?.newWritersWeek}
          total={stats?.totalWritersWeek}
        />
        <WeekRow
          label="Last Week"
          submApv={fmtAmt(stats?.submLW)}
          newWriters={stats?.newWritersLW}
          total={stats?.totalWritersLW}
        />
      </div>

      {breakdown && (
        <MetricsBreakdownModal breakdown={breakdown} onClose={() => setBreakdown(null)} />
      )}
    </SectionShell>
  )
}

function KpiCard({ label, value, proj, note, highlight, onClick }) {
  return (
    <div
      className={`border rounded-xl p-4 transition-colors ${
        highlight
          ? 'bg-amber-500/10 border-amber-200 dark:border-white/10'
          : 'bg-gray-50 border-primary/15 dark:bg-primary/60 dark:border-white/10'
      } ${onClick ? 'cursor-pointer hover:border-accent/50 dark:hover:border-accent/40' : ''}`}
      onClick={onClick ?? undefined}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1.5">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value ?? '—'}</p>
      {proj != null && proj !== value && (
        <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">↗ {proj} proj</p>
      )}
      {note && <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">{note}</p>}
      {onClick && <p className="text-[10px] text-accent/50 dark:text-accent/40 mt-1.5">Click to view breakdown</p>}
    </div>
  )
}

// ── Metrics drill-down modal ───────────────────────────────────────────────────

function MetricsBreakdownModal({ breakdown, onClose }) {
  const { title, type, items = [], apvKey = 'subm_apv', dateKey = 'submit_week' } = breakdown

  const thCls = 'text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 whitespace-nowrap'
  const tdCls = 'px-4 py-2 text-xs text-gray-700 dark:text-white/80'

  const totalApv = (type === 'apv' || type === 'policies')
    ? items.reduce((s, r) => {
        const v = r[apvKey] ?? r.subm_apv ?? r.issued_apv ?? '0'
        return s + parseFloat(String(v).replace(/[$,]/g, '') || '0')
      }, 0)
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-primary border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors text-base leading-none"
          >✕</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {type === 'writers' && (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
                <tr>
                  <th className={thCls}>Agent</th>
                  <th className={thCls}>SFG ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {items.length === 0
                  ? <tr><td colSpan={2} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-white/30">No records.</td></tr>
                  : items.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={`${tdCls} font-medium`}>{r.agent || r.sfg_id}</td>
                      <td className={`${tdCls} font-mono text-gray-500 dark:text-white/55`}>{r.sfg_id}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {type === 'apv' && (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
                <tr>
                  <th className={thCls}>Agent</th>
                  <th className={thCls}>Client</th>
                  <th className={thCls}>Carrier</th>
                  <th className={thCls}>{dateKey === 'issue_date' ? 'Issue Date' : 'Submit Week'}</th>
                  <th className={`${thCls} text-right`}>APV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {items.length === 0
                  ? <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-white/30">No records.</td></tr>
                  : items.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={`${tdCls} font-medium`}>{r.agent || r.sfg_id}</td>
                      <td className={tdCls}>{r.applicant || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{r.carrier || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55 tabular-nums`}>{r[dateKey] || '—'}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {r[apvKey] ? `$${parseFloat(String(r[apvKey]).replace(/[$,]/g,'')).toLocaleString('en-US',{maximumFractionDigits:0})}` : '—'}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {type === 'policies' && (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
                <tr>
                  <th className={thCls}>Agent</th>
                  <th className={thCls}>Client</th>
                  <th className={thCls}>Carrier</th>
                  <th className={thCls}>Submit Date</th>
                  <th className={thCls}>Open Req</th>
                  <th className={`${thCls} text-right`}>Subm APV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {items.length === 0
                  ? <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-400 dark:text-white/30">No records.</td></tr>
                  : items.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                      <td className={`${tdCls} font-medium`}>{r.agent || r.sfg_id}</td>
                      <td className={tdCls}>{r.applicant || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55`}>{r.carrier || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55 tabular-nums`}>{r.submit_date || '—'}</td>
                      <td className={`${tdCls} text-gray-500 dark:text-white/55 max-w-[160px] truncate`}>{r.open_req || '—'}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {r.subm_apv ? `$${parseFloat(String(r.subm_apv).replace(/[$,]/g,'')).toLocaleString('en-US',{maximumFractionDigits:0})}` : '—'}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0">
          <span className="text-xs text-gray-400 dark:text-white/35">
            {items.length} {type === 'writers' ? 'agents' : 'policies'}
          </span>
          {totalApv != null && (
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              Total: {fmtAmt(totalApv)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function WeekRow({ label, submApv, newWriters, total }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <p className="text-sm font-semibold text-gray-900 dark:text-white w-24 flex-shrink-0">{label}:</p>
      <Stat label="Submitted APV" value={submApv} />
      <Stat label="New Writers"   value={newWriters} />
      <Stat label="Total Writers" value={total} />
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{value ?? '—'}</p>
    </div>
  )
}

