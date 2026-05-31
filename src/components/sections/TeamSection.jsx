import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SectionShell } from './MyInfoSection'

export default function TeamSection({ subject, canWrite }) {
  const [members, setMembers]       = useState([])
  const [totalLessons, setTotalLessons] = useState(0)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    if (!subject?.sfg_id) return
    setLoading(true)
    loadTeam(subject.sfg_id)
  }, [subject?.sfg_id])

  async function loadTeam(sfgId) {
    const [{ data: memberData }, { count: lessonCount }] = await Promise.all([
      supabase
        .from('users')
        .select('id, sfg_id, full_name, role, is_active, hire_date, profile_issues, no_eando, contracting_to_producer, contracting_complete')
        .eq('upline_sfg_id', sfgId)
        .order('hire_date', { ascending: false }),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ])

    setTotalLessons(lessonCount ?? 0)

    if (!memberData?.length) { setMembers([]); setLoading(false); return }

    // Get kajabi emails + completion counts in two queries
    const sfgIds = memberData.map(m => m.sfg_id)
    const { data: emailMaps } = await supabase
      .from('kajabi_email_map')
      .select('sfg_id, kajabi_email')
      .in('sfg_id', sfgIds)

    const kajabi_emails = (emailMaps ?? []).map(m => m.kajabi_email)
    let completionMap = {}
    if (kajabi_emails.length) {
      const { data: completions } = await supabase
        .from('onboarding_progress')
        .select('kajabi_email')
        .in('kajabi_email', kajabi_emails)
        .eq('completed', true)
      for (const c of (completions ?? [])) {
        completionMap[c.kajabi_email] = (completionMap[c.kajabi_email] ?? 0) + 1
      }
    }

    const emailBySfg = Object.fromEntries((emailMaps ?? []).map(m => [m.sfg_id, m.kajabi_email]))
    setMembers(memberData.map(m => {
      const ke = emailBySfg[m.sfg_id]
      return { ...m, onboardingCompleted: ke != null ? (completionMap[ke] ?? 0) : null }
    }))
    setLoading(false)
  }

  const now       = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const active        = members.filter(m => m.is_active).length
  const inTraining    = members.filter(m => m.onboardingCompleted !== null && (totalLessons === 0 || m.onboardingCompleted < totalLessons)).length
  const newThisMonth  = members.filter(m => m.hire_date && (parseDateLocal(m.hire_date) ?? 0) >= monthStart).length

  if (loading) return (
    <SectionShell title="Team">
      <div className="space-y-2 animate-pulse">
        <div className="grid grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-white/10 rounded-xl" />)}
        </div>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </SectionShell>
  )

  return (
    <SectionShell title="Team" canWrite={canWrite}>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-white/40">No direct team members yet.</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Total Members"  value={members.length} />
            <StatCard label="Active"         value={active} />
            <StatCard label="In Training"    value={inTraining} />
            <StatCard label="New This Month" value={newThisMonth} />
          </div>

          {/* Status table */}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Hire Date', 'Profile Issues', 'E&O', 'Contracting', 'Onboarding'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-5 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {members.map(m => {
                  const pct = totalLessons > 0 && m.onboardingCompleted !== null
                    ? Math.round((m.onboardingCompleted / totalLessons) * 100) : null
                  const stage = !m.contracting_to_producer ? 'none'
                    : !m.contracting_complete ? 'in-progress' : 'complete'

                  return (
                    <tr key={m.id} className={`${!m.is_active ? 'opacity-40' : ''}`}>
                      <td className="py-3 pr-5">
                        <p className="font-medium text-gray-900 dark:text-white leading-tight">{m.full_name}</p>
                        <p className="text-xs text-gray-400 dark:text-white/40 font-mono mt-0.5">{m.sfg_id}</p>
                      </td>
                      <td className="py-3 pr-5 text-gray-500 dark:text-white/60 whitespace-nowrap text-xs">
                        {m.hire_date ? fmtDate(m.hire_date) : '—'}
                      </td>
                      <td className="py-3 pr-5">
                        {m.profile_issues
                          ? <span className="text-xs bg-amber-500/20 text-amber-600 dark:text-amber-300 font-medium px-2 py-0.5 rounded">{m.profile_issues}</span>
                          : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                      </td>
                      <td className="py-3 pr-5">
                        {m.no_eando
                          ? <span className="text-xs font-bold text-accent">✕</span>
                          : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                      </td>
                      <td className="py-3 pr-5">
                        <ContractingBadge stage={stage} />
                      </td>
                      <td className="py-3">
                        {pct !== null
                          ? <ProgressBar pct={pct} />
                          : <span className="text-gray-300 dark:text-white/20 text-xs">No Kajabi link</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionShell>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-gray-50 border border-gray-200 dark:bg-primary/60 dark:border-white/10 rounded-xl p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1.5">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}

function ContractingBadge({ stage }) {
  if (stage === 'complete')    return <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-300 font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Complete</span>
  if (stage === 'in-progress') return <span className="text-xs bg-amber-500/20 text-amber-600 dark:text-amber-300 font-medium px-2 py-0.5 rounded-full whitespace-nowrap">In Progress</span>
  return <span className="text-xs bg-gray-100 text-gray-400 dark:bg-white/10 dark:text-white/40 font-medium px-2 py-0.5 rounded-full whitespace-nowrap">Not Started</span>
}

function ProgressBar({ pct }) {
  const color = pct === 100 ? 'bg-green-500 dark:bg-green-400' : pct >= 50 ? 'bg-accent' : 'bg-gray-300 dark:bg-white/40'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-white/50 tabular-nums">{pct}%</span>
    </div>
  )
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
