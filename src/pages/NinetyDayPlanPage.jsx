import { useState, useEffect, useCallback } from 'react'
import { useViewing } from '../context/ViewingContext'

const SECTIONS = [
  {
    num: 1,
    title: 'Vision — The Why',
    fields: [
      { key: 'vision_said_yes',            label: 'What made you say yes?' },
      { key: 'vision_no_longer_settle',    label: 'What are you no longer willing to settle for?' },
      { key: 'vision_90_days_different',   label: 'If these 90 days go exactly how you want, what\'s concretely different: your income, your calendar, how you feel?' },
      { key: 'vision_doing_for_whom',      label: 'Who are you doing this for, and what specifically changes for them when you win?' },
      { key: 'vision_one_year_looks_like', label: 'One year from now, what does "this is working" actually look like?' },
    ],
  },
  {
    num: 2,
    title: 'Professional Path',
    fields: [
      { key: 'path_milestone_90_days', label: 'The one professional milestone you must hit in 90 days' },
      { key: 'path_org_one_year',      label: 'Where in the organization you\'ll be a year from now' },
      { key: 'path_skill_change',      label: 'The one skill that would change everything, and how you\'ll build it' },
    ],
  },
  {
    num: 3,
    title: 'Commitment — The Contract',
    fields: [
      { key: 'commitment_non_negotiables', label: 'Your daily non-negotiables — the things you\'ll do no matter what' },
      { key: 'commitment_give_up',         label: 'What you\'ll give up or change to protect your activity' },
      { key: 'commitment_keep_going',      label: 'When it gets hard (and it will), what you\'ll tell yourself to keep going' },
    ],
  },
  {
    num: 4,
    title: 'Support & Accountability',
    fields: [
      { key: 'support_accountability_partner', label: 'Who\'s your accountability partner, and how will they hold you to this?' },
      { key: 'support_coaching_style',         label: 'How do you like to be coached and supported?' },
    ],
  },
]

const ALL_KEYS = SECTIONS.flatMap(s => s.fields.map(f => f.key))
const EMPTY_DRAFT = Object.fromEntries(ALL_KEYS.map(k => [k, '']))

function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function dayOf90(startDate) {
  const start = new Date(startDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today - start) / 86400000) + 1
  return Math.min(Math.max(diff, 1), 90)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function NinetyDayPlanPage() {
  const { activeSubject, permissions } = useViewing()
  const sfgId = activeSubject?.sfg_id
  const agentName = activeSubject?.full_name ?? ''

  const [plans, setPlans]           = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [plan, setPlan]             = useState(null)
  const [editing, setEditing]       = useState(false)
  const [draft, setDraft]           = useState(EMPTY_DRAFT)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newStartDate, setNewStartDate] = useState(todayStr())
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  const canWrite = permissions?.project100?.write ?? false

  const load = useCallback(async () => {
    if (!sfgId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ninety-day-plan?sfg_id=${encodeURIComponent(sfgId)}`)
      const json = await res.json()
      const list = json.plans ?? []
      setPlans(list)
      if (list.length > 0) {
        setSelectedId(list[0].id)
        setPlan(list[0])
      } else {
        setSelectedId(null)
        setPlan(null)
      }
    } catch {
      setError('Failed to load plans')
    }
    setLoading(false)
  }, [sfgId])

  useEffect(() => { load() }, [load])

  function selectPlan(id) {
    const p = plans.find(p => p.id === Number(id))
    if (!p) return
    setSelectedId(p.id)
    setPlan(p)
    setEditing(false)
    setError('')
  }

  function startEdit() {
    setDraft(Object.fromEntries(ALL_KEYS.map(k => [k, plan?.[k] ?? ''])))
    setEditing(true)
    setError('')
  }

  function cancelEdit() {
    setEditing(false)
    setError('')
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/ninety-day-plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: plan.id, sfg_id: sfgId, ...draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setPlan(json.plan)
      setPlans(prev => prev.map(p => p.id === json.plan.id ? json.plan : p))
      setEditing(false)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function createPlan() {
    if (!newStartDate) return
    setSaving(true)
    setError('')
    try {
      const endDate = addDays(newStartDate, 89)
      const res = await fetch('/api/ninety-day-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sfg_id: sfgId, start_date: newStartDate, end_date: endDate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create plan')
      const newPlan = json.plan
      setPlans(prev => [newPlan, ...prev])
      setSelectedId(newPlan.id)
      setPlan(newPlan)
      setShowNewModal(false)
      setDraft({ ...EMPTY_DRAFT })
      setEditing(true)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  async function signPlan() {
    if (!plan) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/ninety-day-plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: plan.id, sfg_id: sfgId, sign: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setPlan(json.plan)
      setPlans(prev => prev.map(p => p.id === json.plan.id ? json.plan : p))
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const day = plan ? dayOf90(plan.start_date) : 0
  const pct = plan ? Math.round((day / 90) * 100) : 0

  if (loading) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading…</div>
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto print:p-0 print:max-w-none">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">90-Day Plan</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">The 'why' behind your numbers</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-5 print:hidden">
        {plans.length > 0 ? (
          <select
            value={selectedId ?? ''}
            onChange={e => selectPlan(e.target.value)}
            className="text-sm border border-gray-200 dark:border-white/15 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-gray-900 dark:text-white min-w-[260px] focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
          >
            {plans.map(p => (
              <option key={p.id} value={p.id}>
                {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500 italic">No plans yet</span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {plan && !editing && canWrite && (
            <button
              onClick={startEdit}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Edit
            </button>
          )}
          {plan && (
            <button
              onClick={() => window.print()}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Print
            </button>
          )}
          {canWrite && (
            <button
              onClick={() => { setShowNewModal(true); setNewStartDate(todayStr()) }}
              className="text-sm px-3 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white transition-colors"
            >
              + New Plan
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {plan ? (
        <>
          {/* Day X of 90 bar */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              <span className="font-medium">Day {day} of 90</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-amber-100 dark:bg-white/10 rounded-full h-3">
              <div
                className="bg-amber-500 h-3 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span>{fmtDate(plan.start_date)}</span>
              <span>{fmtDate(plan.end_date)}</span>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-5">
            {SECTIONS.map(section => (
              <div
                key={section.num}
                className="bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                    {section.num}
                  </span>
                  <h2 className="text-base font-semibold text-accent dark:text-accent-light">{section.title}</h2>
                </div>
                <div className="space-y-5">
                  {section.fields.map(field => (
                    <div key={field.key}>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{field.label}</p>
                      {editing ? (
                        <textarea
                          value={draft[field.key]}
                          onChange={e => setDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                          rows={3}
                          className="w-full text-sm border border-gray-200 dark:border-white/15 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-gray-900 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors"
                          placeholder="Write your response…"
                        />
                      ) : (
                        <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed min-h-[1.4rem]">
                          {plan[field.key] || (
                            <span className="text-gray-300 dark:text-gray-600 italic">—</span>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Edit action bar */}
          {editing && (
            <div className="flex items-center justify-end gap-2 mt-4 print:hidden">
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {/* Commitment block */}
          {!editing && (
            <div className="mt-5 bg-white border border-primary/15 dark:bg-primary/30 dark:border-white/10 rounded-2xl p-6 text-center">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Committed to by
              </p>
              <p
                className="text-5xl text-gray-800 dark:text-gray-100 mb-5"
                style={{ fontFamily: "'Dancing Script', 'Playfair Display', cursive", lineHeight: 1.2 }}
              >
                {agentName}
              </p>
              {plan.signed_at ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Signed {fmtDate(plan.signed_at)} — commitment locked in
                </p>
              ) : canWrite ? (
                <button
                  onClick={signPlan}
                  disabled={saving}
                  className="text-sm px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-dark text-white transition-colors disabled:opacity-50 print:hidden"
                >
                  {saving ? 'Signing…' : 'Commit to this plan'}
                </button>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">Not yet signed</p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-lg mb-4">No 90-day plan yet.</p>
          {canWrite && (
            <button
              onClick={() => { setShowNewModal(true); setNewStartDate(todayStr()) }}
              className="text-sm px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white transition-colors"
            >
              + Create your first plan
            </button>
          )}
        </div>
      )}

      {/* New Plan Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-secondary rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">New 90-Day Plan</h3>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Start date
            </label>
            <input
              type="date"
              value={newStartDate}
              onChange={e => setNewStartDate(e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-white/15 rounded-lg px-3 py-2 bg-white dark:bg-white/5 text-gray-900 dark:text-white mb-1 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors"
            />
            {newStartDate && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
                Ends {fmtDate(addDays(newStartDate, 89))}
              </p>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowNewModal(false); setError('') }}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createPlan}
                disabled={!newStartDate || saving}
                className="text-sm px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
