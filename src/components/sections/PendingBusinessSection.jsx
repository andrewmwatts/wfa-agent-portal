// PendingBusinessSection — purely presentational.
// Pending + lapse data is fetched once by Dashboard and passed as props.

import { SectionShell } from './MyInfoSection'
import { fmtDate } from '../../utils/format'

export default function PendingBusinessSection({ subject, canWrite, pending = [], lapse = [], loading }) {
  if (loading) return (
    <>
      <SectionShell title="Pending Business">
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
        </div>
      </SectionShell>
      <SectionShell title="Pending Lapse">
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
        </div>
      </SectionShell>
    </>
  )

  return (
    <>
      {/* ── Pending Business ─────────────────────────────────────────── */}
      <SectionShell title="Pending Business" canWrite={canWrite}>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40">No pending applications.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'Submit Date', 'Open Requirements', 'Last Update'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {pending.map((r, i) => {
                  const isIncomplete = r.status?.toLowerCase() === 'incomplete'
                  return (
                    <tr key={i} className={isIncomplete ? 'bg-amber-500/10' : ''}>
                      <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-gray-700 dark:text-white/80 text-xs">{r.applicant}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{r.carrier}</td>
                      <td className="py-2.5 pr-4">
                        {r.status
                          ? <StatusBadge status={r.status} />
                          : <span className="text-gray-300 dark:text-white/30 text-xs">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(r.submit_date)}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs max-w-[200px]">
                        <span className="line-clamp-2">{r.open_req || '—'}</span>
                      </td>
                      <td className="py-2.5 text-gray-400 dark:text-white/40 text-xs whitespace-nowrap">{fmtDate(r.last_update)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>

      {/* ── Pending Lapse ────────────────────────────────────────────── */}
      <SectionShell title="Pending Lapse" canWrite={canWrite}>
        {lapse.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40">No policies at lapse risk.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'APV', 'Expected Lapse Date', 'Days'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {lapse.map((r, i) => {
                  const days    = r.days_to_lapse
                  const urgency = days === null ? 'normal'
                    : days < 0   ? 'overdue'
                    : days <= 7  ? 'critical'
                    : days <= 30 ? 'warning'
                    : 'normal'
                  const rowCls = { overdue: 'bg-red-500/15', critical: 'bg-red-500/10', warning: 'bg-amber-500/10', normal: '' }[urgency]

                  return (
                    <tr key={i} className={rowCls}>
                      <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-gray-700 dark:text-white/80 text-xs">{r.applicant}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{r.carrier}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs font-medium ${urgency === 'normal' ? 'text-gray-500 dark:text-white/60' : urgency === 'warning' ? 'text-amber-600 dark:text-amber-300' : 'text-red-500 dark:text-red-300'}`}>
                          {r.conservation_status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs tabular-nums">{r.issued_apv || '—'}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(r.conservation_date)}</td>
                      <td className="py-2.5"><DaysBadge days={days} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionShell>
    </>
  )
}

function StatusBadge({ status }) {
  const cls = status.toLowerCase() === 'incomplete'
    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300'
    : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/60'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${cls}`}>{status}</span>
}

function DaysBadge({ days }) {
  if (days === null) return <span className="text-gray-300 dark:text-white/30 text-xs">—</span>
  const cls = days < 0 ? 'text-red-500 dark:text-red-300 font-bold'
    : days <= 7  ? 'text-red-500 dark:text-red-300 font-semibold'
    : days <= 30 ? 'text-amber-600 dark:text-amber-300'
    : 'text-gray-500 dark:text-white/60'
  return <span className={`text-xs tabular-nums ${cls}`}>{days}</span>
}

