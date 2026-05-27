import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SectionShell } from './MyInfoSection'

export default function OnboardingSection({ subject, canWrite }) {
  const [rows, setRows]       = useState([])
  const [linked, setLinked]   = useState(true)  // false = no kajabi_email_map entry
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!subject?.sfg_id) return
    setLoading(true)
    load(subject.sfg_id)
  }, [subject?.sfg_id])

  async function load(sfgId) {
    // 1. Resolve kajabi email for this agent
    const { data: mapRow } = await supabase
      .from('kajabi_email_map')
      .select('kajabi_email')
      .eq('sfg_id', sfgId)
      .maybeSingle()

    if (!mapRow) {
      setLinked(false)
      setLoading(false)
      return
    }

    const kajabi_email = mapRow.kajabi_email

    // 2. All lessons (ordered)
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, lesson_name, display_order')
      .eq('is_active', true)
      .order('display_order')

    // 3. This agent's completions
    const { data: progress } = await supabase
      .from('onboarding_progress')
      .select('lesson_id, completed, completed_at')
      .eq('kajabi_email', kajabi_email)

    const progressMap = Object.fromEntries(
      (progress ?? []).map(p => [p.lesson_id, p])
    )

    setRows((lessons ?? []).map(l => ({
      ...l,
      completed:    progressMap[l.id]?.completed    ?? false,
      completed_at: progressMap[l.id]?.completed_at ?? null,
    })))
    setLinked(true)
    setLoading(false)
  }

  const completedCount = rows.filter(r => r.completed).length
  const total          = rows.length

  if (loading) return (
    <SectionShell title="Onboarding Progress">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-100 dark:bg-white/10 rounded animate-pulse" />
        ))}
      </div>
    </SectionShell>
  )

  if (!linked) return (
    <SectionShell title="Onboarding Progress">
      <p className="text-sm text-gray-400 dark:text-white/40">
        No Kajabi account linked to this SFG ID yet.
      </p>
    </SectionShell>
  )

  return (
    <SectionShell title="Onboarding Progress" canWrite={canWrite}>
      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex justify-between text-xs text-gray-400 dark:text-white/40 mb-1.5">
          <span>{completedCount} of {total} lessons complete</span>
          <span>{total > 0 ? Math.round((completedCount / total) * 100) : 0}%</span>
        </div>
        <div className="h-1.5 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: total > 0 ? `${(completedCount / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Lesson list */}
      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {rows.map(row => (
          <div
            key={row.id}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
              row.completed ? 'bg-gray-50 dark:bg-white/5' : 'bg-transparent'
            }`}
          >
            <span className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ${
              row.completed
                ? 'bg-accent border-accent'
                : 'border-gray-300 dark:border-white/20'
            }`}>
              {row.completed && (
                <svg className="w-2.5 h-2.5 text-white fill-white" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className={`text-sm flex-1 ${row.completed ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/50'}`}>
              {row.lesson_name}
            </span>
            {row.completed_at && (
              <span className="text-xs text-gray-400 dark:text-white/30 flex-shrink-0">
                {new Date(row.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
        ))}
      </div>
    </SectionShell>
  )
}
