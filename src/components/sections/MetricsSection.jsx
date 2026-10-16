// MetricsSection — purely presentational.
// Data is fetched once by Dashboard and passed as props.
// Mode toggle calls onModeChange(newMode) so Dashboard can re-fetch.

import { useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { SectionShell } from './MyInfoSection'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'
import { SHEET_OVERLAY, SHEET_PANEL, SHEET_HEAD_PAD, SHEET_FOOT_PAD } from '../ui/sheetClasses'
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
      <div className="flex flex-wrap items-center sm:items-baseline justify-between gap-x-3 gap-y-2 mb-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">This Month</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {isDirector && (
            <select
              value={mode}
              onChange={e => onModeChange?.(e.target.value)}
              className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer max-sm:h-11 max-sm:rounded-xl max-sm:px-3 touch:sm:min-h-[44px]"
            >
              <option value="master"   style={optionStyle}>Master Agency</option>
              <option value="baseshop" style={optionStyle}>My Baseshop</option>
            </select>
          )}
          <p className="text-sm text-gray-500 dark:text-white/50">{monthLabel}</p>
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
      className={`border rounded-xl p-3 sm:p-4 transition-colors ${
        highlight
          ? 'bg-amber-500/10 border-amber-200 dark:border-white/10'
          : 'bg-gray-50 border-primary/15 dark:bg-primary/60 dark:border-white/10'
      } ${onClick ? 'cursor-pointer hover:border-accent/50 dark:hover:border-accent/40' : ''}`}
      onClick={onClick ?? undefined}
      {...(onClick ? { role: 'button', tabIndex: 0, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 mb-1.5">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">{value ?? '—'}</p>
      {proj != null && proj !== value && (
        <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">↗ {proj} proj</p>
      )}
      {note && <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">{note}</p>}
      {onClick && <p className="text-xs text-gray-500 dark:text-white/50 mt-1.5 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" /><span className="touch:hidden">Click to view breakdown</span><span className="hidden touch:inline">Tap for breakdown</span></p>}
    </div>
  )
}

// ── Metrics drill-down modal ───────────────────────────────────────────────────

function MetricsBreakdownModal({ breakdown, onClose }) {
  const { title, type, items = [], apvKey = 'subm_apv', dateKey = 'submit_week' } = breakdown

  useBodyScrollLock(true)

  const thCls = 'text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 whitespace-nowrap'
  const tdCls = 'px-4 py-2 text-xs text-gray-700 dark:text-white/80'

  const totalApv = (type === 'apv' || type === 'policies')
    ? items.reduce((s, r) => {
        const v = r[apvKey] ?? r.subm_apv ?? r.issued_apv ?? '0'
        return s + parseFloat(String(v).replace(/[$,]/g, '') || '0')
      }, 0)
    : null

  return (
    <div className={SHEET_OVERLAY} onClick={onClose}>
      <div
        className={`${SHEET_PANEL} bg-white dark:bg-primary sm:max-w-2xl sm:max-h-[80vh]`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={`flex items-center justify-between gap-2 max-sm:pl-4 max-sm:pr-2 max-sm:py-2 sm:px-5 sm:py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0 ${SHEET_HEAD_PAD}`}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white min-w-0 truncate">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 sm:w-8 sm:h-8 touch:sm:w-11 touch:sm:h-11 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-colors text-base leading-none shrink-0"
          >✕</button>
        </div>

        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
          {/* Phone: compact list instead of the wide tables */}
          <ul className="sm:hidden divide-y divide-gray-100 dark:divide-white/5">
            {items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-500 dark:text-white/50">No records.</li>
            )}
            {items.map((r, i) => (
              <li key={i} className="px-4 py-3">
                {type === 'writers' ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white min-w-0 break-words">{r.agent || r.sfg_id}</p>
                    <p className="text-xs font-mono text-gray-500 dark:text-white/55 shrink-0">{r.sfg_id}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white break-words">{r.applicant || '—'}</p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-white/60">{[r.agent || r.sfg_id, r.carrier].filter(Boolean).join(' · ')}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white shrink-0">{fmtRowApv(type === 'apv' ? r[apvKey] : r.subm_apv)}</p>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-white/50">
                      {type === 'apv'
                        ? `${dateKey === 'issue_date' ? 'Issued' : 'Submit week'} ${r[dateKey] || '—'}`
                        : `Submitted ${r.submit_date || '—'}`}
                    </p>
                    {type === 'policies' && r.open_req && (
                      <p className="mt-1 text-xs text-gray-700 dark:text-white/75">{r.open_req}</p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
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
                  ? <tr><td colSpan={2} className="px-4 py-8 text-center text-xs text-gray-500 dark:text-white/50">No records.</td></tr>
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
                  ? <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-gray-500 dark:text-white/50">No records.</td></tr>
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
                  ? <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-500 dark:text-white/50">No records.</td></tr>
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
        </div>

        <div className={`flex items-center justify-between px-4 sm:px-5 pt-3 sm:py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0 ${SHEET_FOOT_PAD}`}>
          <span className="text-xs text-gray-500 dark:text-white/50">
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

function fmtRowApv(v) {
  if (!v) return '—'
  const n = parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function WeekRow({ label, submApv, newWriters, total }) {
  return (
    <div className="sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-2">
      <p className="text-sm font-semibold text-gray-900 dark:text-white sm:w-24 sm:flex-shrink-0 max-sm:mb-1.5">{label}:</p>
      <div className="grid grid-cols-3 gap-3 sm:contents">
        <Stat label="Submitted APV" value={submApv} />
        <Stat label="New Writers"   value={newWriters} />
        <Stat label="Total Writers" value={total} />
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-white/50 mb-0.5">{label}</p>
      <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tabular-nums">{value ?? '—'}</p>
    </div>
  )
}

