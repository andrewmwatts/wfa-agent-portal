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
          <p className="text-sm text-gray-500 dark:text-white/50">No pending applications.</p>
        ) : (
          <>
          <ul className="md:hidden -mx-1 divide-y divide-gray-100 dark:divide-white/5">
            {pending.map((r, i) => {
              const isIncomplete = r.status?.toLowerCase() === 'incomplete'
              return (
                <li key={i} className={`px-1 py-3 ${isIncomplete ? 'bg-amber-500/10' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight break-words">{r.applicant || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-white/60">{[r.agent, r.carrier].filter(Boolean).join(' · ')}</p>
                    </div>
                    {r.status && <div className="shrink-0"><StatusBadge status={r.status} /></div>}
                  </div>
                  {r.open_req && (
                    <p className="mt-1.5 text-xs text-gray-700 dark:text-white/75 line-clamp-3">{r.open_req}</p>
                  )}
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-white/50">
                    Submitted {fmtDate(r.submit_date)}
                    {r.last_update ? ` · Updated ${fmtDate(r.last_update)}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'Submit Date', 'Open Requirements', 'Last Update'].map(h => (
                    <th key={h} className={`text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 pb-2.5 pr-4 last:pr-0 whitespace-nowrap ${h === 'Last Update' ? 'max-lg:hidden' : ''}`}>
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
                      <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs whitespace-nowrap">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-gray-700 dark:text-white/80 text-xs">{r.applicant}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{r.carrier}</td>
                      <td className="py-2.5 pr-4">
                        {r.status
                          ? <StatusBadge status={r.status} />
                          : <span className="text-gray-400 dark:text-white/30 text-xs">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(r.submit_date)}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs max-w-[200px]">
                        <span className="line-clamp-2">{r.open_req || '—'}</span>
                      </td>
                      <td className="py-2.5 text-gray-500 dark:text-white/50 text-xs whitespace-nowrap max-lg:hidden">{fmtDate(r.last_update)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </SectionShell>

      {/* ── Pending Lapse ────────────────────────────────────────────── */}
      <SectionShell title="Pending Lapse" canWrite={canWrite}>
        {lapse.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-white/50">No policies at lapse risk.</p>
        ) : (
          <>
          <ul className="md:hidden -mx-1 divide-y divide-gray-100 dark:divide-white/5">
            {lapse.map((r, i) => {
              const days    = r.days_to_lapse
              const urgency = lapseUrgency(days)
              const rowCls  = { overdue: 'bg-red-500/15', critical: 'bg-red-500/10', warning: 'bg-amber-500/10', normal: '' }[urgency]
              return (
                <li key={i} className={`px-1 py-3 ${rowCls}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight break-words">{r.applicant || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-white/60">{[r.agent, r.carrier].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{r.issued_apv || '—'}</p>
                      {days !== null && days !== undefined && (
                        <p className={`text-xs tabular-nums ${daysCls(days)}`}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs">
                    <span className={statusCls(urgency)}>{r.conservation_status || '—'}</span>
                    <span className="text-gray-500 dark:text-white/50">{r.conservation_date ? ` · Lapse ${fmtDate(r.conservation_date)}` : ''}</span>
                  </p>
                </li>
              )
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Client', 'Carrier', 'Status', 'APV', 'Expected Lapse Date', 'Days'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {lapse.map((r, i) => {
                  const days    = r.days_to_lapse
                  const urgency = lapseUrgency(days)
                  const rowCls = { overdue: 'bg-red-500/15', critical: 'bg-red-500/10', warning: 'bg-amber-500/10', normal: '' }[urgency]

                  return (
                    <tr key={i} className={rowCls}>
                      <td className="py-2.5 pr-4 text-gray-900 dark:text-white font-medium text-xs">{r.agent}</td>
                      <td className="py-2.5 pr-4 text-gray-700 dark:text-white/80 text-xs">{r.applicant}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{r.carrier}</td>
                      <td className="py-2.5 pr-4">
                        <span className={statusCls(urgency)}>
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
          </>
        )}
      </SectionShell>
    </>
  )
}

function lapseUrgency(days) {
  if (days === null || days === undefined) return 'normal'
  if (days < 0)   return 'overdue'
  if (days <= 7)  return 'critical'
  if (days <= 30) return 'warning'
  return 'normal'
}

function statusCls(urgency) {
  const tone = urgency === 'normal' ? 'text-gray-500 dark:text-white/60'
    : urgency === 'warning' ? 'text-amber-800 dark:text-amber-300'
    : 'text-red-700 dark:text-red-300'
  return `text-xs font-medium ${tone}`
}

function daysCls(days) {
  return days < 0 ? 'text-red-700 dark:text-red-300 font-bold'
    : days <= 7  ? 'text-red-700 dark:text-red-300 font-semibold'
    : days <= 30 ? 'text-amber-800 dark:text-amber-300'
    : 'text-gray-500 dark:text-white/60'
}

function StatusBadge({ status }) {
  const cls = status.toLowerCase() === 'incomplete'
    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${cls}`}>{status}</span>
}

function DaysBadge({ days }) {
  if (days === null) return <span className="text-gray-400 dark:text-white/30 text-xs">—</span>
  return <span className={`text-xs tabular-nums ${daysCls(days)}`}>{days}</span>
}
