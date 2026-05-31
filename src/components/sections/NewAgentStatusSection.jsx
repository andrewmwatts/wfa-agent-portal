// NewAgentStatusSection — personnel data comes from Dashboard props.
// Only fetches user_settings (hidden agent list) which is specific to this section.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { SectionShell } from './MyInfoSection'

export default function NewAgentStatusSection({ subject, canWrite, personnel = [], loading }) {
  const { userProfile } = useAuth()
  const [hiddenIds, setHiddenIds] = useState(new Set())

  // Load hidden agent list — lightweight, specific to this section
  useEffect(() => {
    if (!userProfile?.id) return
    supabase
      .from('user_settings')
      .select('hidden_sfg_ids')
      .eq('user_id', userProfile.id)
      .maybeSingle()
      .then(({ data }) => {
        setHiddenIds(new Set((data?.hidden_sfg_ids ?? []).map(id => id.toLowerCase())))
      })
  }, [userProfile?.id])

  if (loading) return (
    <SectionShell title="New Agent Status">
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </SectionShell>
  )

  // Sort: incomplete contracting first, then by hire_date descending
  const sorted = [...personnel].sort((a, b) => {
    const aComplete = !!a.contracting_complete
    const bComplete = !!b.contracting_complete
    if (aComplete !== bComplete) return aComplete ? 1 : -1
    return new Date(b.hire_date || 0) - new Date(a.hire_date || 0)
  })

  const visible = sorted.filter(r =>
    !hiddenIds.has(r.sfg_id?.toLowerCase()) && !r.contracting_complete
  )

  return (
    <SectionShell title="New Agent Status" canWrite={canWrite}>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-white/40">No agents in baseshop.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/10">
                {['Agent', 'Hire Date', 'Profile Issues', 'No E&O', 'Contracting'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {visible.map(r => {
                const rowAccent = (r.profile_issues || !!r.no_eando) ? 'bg-amber-500/5' : ''
                return (
                  <tr key={r.sfg_id} className={rowAccent}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-900 dark:text-white leading-tight">{r.name || r.preferred_name || r.full_name}</p>
                    </td>
                    <td className="py-3 pr-4 text-gray-500 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(r.hire_date)}</td>
                    <td className="py-3 pr-4">
                      {r.profile_issues
                        ? <span className="text-xs bg-amber-500/20 text-amber-600 dark:text-amber-300 font-medium px-2 py-0.5 rounded">{r.profile_issues}</span>
                        : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-center">
                      {!!r.no_eando
                        ? <span className="text-xs font-bold text-accent">✕</span>
                        : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                    </td>
                    <td className="py-3">
                      <ContractingCell
                        toProducerDate={r.contracting_to_producer}
                        complete={r.contracting_complete}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionShell>
  )
}

function ContractingCell({ toProducerDate, complete }) {
  if (complete) {
    return <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-300 font-medium px-2 py-0.5 rounded-full">Complete</span>
  }
  if (toProducerDate) {
    return (
      <span className="text-xs font-medium text-amber-600 dark:text-amber-300">
        Sent {fmtDate(toProducerDate)}
      </span>
    )
  }
  return <span className="text-xs bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-white/40 font-medium px-2 py-0.5 rounded-full">Not Started</span>
}

function parseDateLocal(str) {
  if (!str) return null
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = parseDateLocal(d)
  return (!dt || isNaN(dt)) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
