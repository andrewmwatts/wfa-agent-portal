import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'
import AddAgentModal from '../components/AddAgentModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTruthy(val) {
  if (!val) return false
  return ['true', 'yes', 'y', 'x', '1'].includes(val.trim().toLowerCase())
}

// Parse YYYY-MM-DD as local midnight — avoids UTC-offset date shifting
function parseDateLocal(str) {
  if (!str) return null
  const iso = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function toInputDate(str) {
  if (!str) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(str))) return String(str)
  const d = parseDateLocal(str)
  if (!d) return str
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = parseDateLocal(d)
  return (!dt || isNaN(dt)) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Given an owner's SFG ID and the full master-agency list, return the set of
// SFG IDs in that owner's baseshop (stops descending at sub-owners).
function getBaseshopIds(ownerSfgId, allPersonnel) {
  const ownerIds = new Set(
    allPersonnel
      .filter(p => {
        const ao = p.named_milestones?.AO ?? []
        return !!(ao[0] && ao[1] && ao[2])
      })
      .map(p => p.sfg_id.toLowerCase()),
  )

  const childrenOf = {}
  for (const p of allPersonnel) {
    const up = p.upline_sfg_id?.trim().toLowerCase()
    if (!up) continue
    ;(childrenOf[up] ??= []).push(p.sfg_id.toLowerCase())
  }

  const root   = ownerSfgId.toLowerCase()
  const result = new Set()
  function traverse(id) {
    result.add(id)
    for (const child of (childrenOf[id] ?? [])) {
      if (ownerIds.has(child) && child !== root) continue
      traverse(child)
    }
  }
  traverse(root)
  return result
}

// ─── Quick-filter definitions ──────────────────────────────────────────────────
// All         = show all visible agents
// Contracting = agents with contracting incomplete
// Launch      = agents with Kajabi progress < 100%
const QUICK_FILTERS = [
  { id: 'all',         label: 'All'         },
  { id: 'contracting', label: 'Contracting' },
  { id: 'launch',      label: 'Launch'      },
]

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { userProfile }                = useAuth()
  const { activeSubject, permissions } = useViewing()
  const { theme }                      = useTheme()

  const [masterPersonnel, setMasterPersonnel] = useState([])
  const [kajabiMap,       setKajabiMap]       = useState({})   // sfg_id → { count, latestDate }
  const [totalLessons,    setTotalLessons]    = useState(0)
  const [hiddenIds,       setHiddenIds]       = useState(new Set())
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)

  const [selectedScope, setSelectedScope] = useState('master') // 'master' | owner sfg_id
  const [showHidden,    setShowHidden]    = useState(false)

  // Director = role-based; drives master/baseshop toggle
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [quickFilter, setQuickFilter] = useState('all')
  const [search,      setSearch]      = useState('')

  const [selected,    setSelected]    = useState(null) // personnel row for detail modal
  const [showAdd,     setShowAdd]     = useState(false)
  const [addSuccess,  setAddSuccess]  = useState(null) // { uplineWarning } | null

  const isSuperAdmin = userProfile?.role === 'super_admin'

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Load user's hidden list from Supabase ──────────────────────────────────
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

  // ── Load personnel + Kajabi data ───────────────────────────────────────────
  // Always load the full master-agency tree; baseshop filtering is done client-side.
  // Reset scope to 'master' whenever the viewed subject changes.
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    setError(null)
    setSelectedScope('master')
    load(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function load(sfgId) {
    try {
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master`)
      if (!res.ok) throw new Error('Failed to load personnel data')
      const rows = await res.json()

      // Sort: incomplete contracting first, then newest hire date
      const sorted = [...rows].sort((a, b) => {
        const ac = !!a.contracting_complete, bc = !!b.contracting_complete
        if (ac !== bc) return ac ? 1 : -1
        return new Date(b.hire_date || 0) - new Date(a.hire_date || 0)
      })
      setMasterPersonnel(sorted)

      // Batch load Kajabi progress for the full master set
      const sfgIds = rows.map(r => r.sfg_id)
      await loadKajabi(sfgIds)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadKajabi(sfgIds, merge = false) {
    if (!sfgIds.length) return
    try {
      const res = await fetch(`/api/onboarding-progress?sfg_ids=${sfgIds.join(',')}`)
      if (!res.ok) return
      const { summaries, totalLessons: total } = await res.json()
      setTotalLessons(total ?? 0)
      if (merge) {
        setKajabiMap(prev => ({ ...prev, ...(summaries ?? {}) }))
      } else {
        setKajabiMap(summaries ?? {})
      }
    } catch {
      // Non-fatal — table will show "Not enrolled" for all agents
    }
  }

  // ── Hide / unhide ─────────────────────────────────────────────────────────
  function handleHideToggle(sfgId, shouldHide) {
    const normalised = sfgId.toLowerCase()

    // Optimistic update
    setHiddenIds(prev => {
      const next = new Set(prev)
      if (shouldHide) next.add(normalised)
      else            next.delete(normalised)
      return next
    })

    // If we just hid the selected agent and "Show hidden" is off, close the modal
    if (shouldHide && !showHidden) setSelected(null)

    // Fire-and-forget API call
    if (!userProfile?.id) return
    fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userProfile.id,
        action:  shouldHide ? 'hide' : 'unhide',
        sfg_id:  sfgId,
      }),
    }).catch(err => console.error('[OnboardingPage] hide toggle', err))
  }

  // ── Owners derived from master data (AO Month 1 + Month 2 both filled) ──────
  const owners = useMemo(() =>
    masterPersonnel
      .filter(p => {
        const ao = p.named_milestones?.AO ?? []
        return !!(ao[0] && ao[1] && ao[2])
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [masterPersonnel],
  )

  // ── Personnel scoped to current selection (client-side baseshop filter) ────
  const personnel = useMemo(() => {
    if (selectedScope === 'master') return masterPersonnel
    const ids = getBaseshopIds(selectedScope, masterPersonnel)
    return masterPersonnel.filter(p => ids.has(p.sfg_id.toLowerCase()))
  }, [masterPersonnel, selectedScope])

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return personnel.filter(r => {
      const id = r.sfg_id?.toLowerCase() ?? ''
      if (!showHidden && hiddenIds.has(id)) return false
      if (q && !r.name?.toLowerCase().includes(q)) return false

      if (quickFilter === 'contracting' && r.contracting_complete) return false
      if (quickFilter === 'launch') {
        const kajabi = kajabiMap[id]
        const pct    = (kajabi && totalLessons > 0)
          ? Math.round((kajabi.count / totalLessons) * 100)
          : 0
        if (pct >= 100) return false
      }

      return true
    })
  }, [personnel, hiddenIds, showHidden, quickFilter, search, kajabiMap, totalLessons])

  // Visible (non-hidden) count for the counter chip
  const visibleCount = useMemo(
    () => personnel.filter(r => !hiddenIds.has(r.sfg_id?.toLowerCase() ?? '')).length,
    [personnel, hiddenIds]
  )

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 space-y-4 animate-pulse">
        <div className="flex gap-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 dark:bg-white/10 rounded-full w-28" />)}
        </div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </main>
  )

  if (error) return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <p className="text-sm text-accent/80">{error}</p>
      </div>
    </main>
  )

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-5">
      <section className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">Onboarding</h3>
          <div className="flex items-center gap-3">
            {isDirector && owners.length > 0 && (
              <select value={selectedScope} onChange={e => setSelectedScope(e.target.value)}
                className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer">
                <option value="master" style={optionStyle}>Master Agency</option>
                {owners.map(o => (
                  <option key={o.sfg_id} value={o.sfg_id} style={optionStyle}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-gray-400 dark:text-white/30">
              {rows.length.toLocaleString()} of {visibleCount.toLocaleString()} agents
            </span>
            {isSuperAdmin && (
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10 transition-colors whitespace-nowrap"
              >
                + Add Agent
              </button>
            )}
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">

          {/* Quick filters — primary interaction */}
          {QUICK_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setQuickFilter(id)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors whitespace-nowrap
                ${quickFilter === id
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-white/50 border-gray-200 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              {label}
            </button>
          ))}

          {/* Right side: show-hidden + search */}
          <div className="ml-auto flex items-center gap-2">

            {/* Show hidden — secondary escape hatch */}
            <button
              onClick={() => setShowHidden(v => !v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap
                ${showHidden
                  ? 'text-accent border-accent/40 bg-accent/10'
                  : 'text-gray-400 dark:text-white/30 border-gray-200 dark:border-white/10 hover:text-gray-600 dark:hover:text-white/50 hover:border-gray-300 dark:hover:border-white/20'
                }`}
            >
              Show hidden
            </button>

          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-white/30 pointer-events-none"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search agent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 dark:bg-white/5 dark:border-white/15 dark:text-white dark:placeholder:text-white/25 text-xs rounded-lg pl-7 pr-3 py-1.5 w-44 focus:outline-none focus:border-accent/60"
            />
          </div>
          </div>{/* end ml-auto */}
        </div>{/* end filter bar */}

        {/* ── Table ────────────────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40 text-center py-8">No agents match the current filter.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Upline', 'Hire Date', 'Issues', 'No E&O', 'Contracting', 'Course Progress', 'Last Completed'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {rows.map(r => {
                  const id       = r.sfg_id?.toLowerCase() ?? ''
                  const isHidden = hiddenIds.has(id)
                  const kajabi   = kajabiMap[id]
                  const linked   = kajabi !== undefined
                  const pct      = linked && totalLessons > 0
                    ? Math.round((kajabi.count / totalLessons) * 100) : null
                  const hasIssue = r.profile_issues || !!r.no_eando

                  return (
                    <tr
                      key={r.sfg_id}
                      onClick={() => setSelected(r)}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group
                        ${hasIssue && !isHidden ? 'bg-amber-500/5' : ''}
                        ${isHidden ? 'opacity-40' : ''}`}
                    >
                      {/* Agent */}
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900 dark:text-white group-hover:text-accent transition-colors leading-tight text-sm">
                          {r.name}
                        </p>
                      </td>

                      {/* Upline */}
                      <td className="py-3 pr-4 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">
                        {r.upline_name || '—'}
                      </td>

                      {/* Hire Date */}
                      <td className="py-3 pr-4 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">
                        {fmtDate(r.hire_date)}
                      </td>

                      {/* Profile Issues */}
                      <td className="py-3 pr-4">
                        {r.profile_issues
                          ? <span className="text-xs bg-amber-500/20 text-amber-600 dark:text-amber-300 font-medium px-2 py-0.5 rounded">{r.profile_issues}</span>
                          : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                      </td>

                      {/* No E&O */}
                      <td className="py-3 pr-4 text-center">
                        {!!r.no_eando
                          ? <span className="text-xs font-bold text-accent">✕</span>
                          : <span className="text-gray-300 dark:text-white/20 text-xs">—</span>}
                      </td>

                      {/* Contracting */}
                      <td className="py-3 pr-4">
                        <ContractingCell
                          toProducerDate={r.contracting_to_producer}
                          complete={r.contracting_complete}
                        />
                      </td>

                      {/* Course Progress */}
                      <td className="py-3 pr-4 min-w-[110px]">
                        {!linked ? (
                          <span className="text-xs text-gray-400 dark:text-white/25">Not enrolled</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-baseline gap-1.5">
                              <span className={`text-sm font-bold tabular-nums
                                ${pct === 100 ? 'text-green-600 dark:text-green-300' : pct > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40'}`}>
                                {pct}%
                              </span>
                              <span className="text-xs text-gray-400 dark:text-white/30">{kajabi.count}/{totalLessons}</span>
                            </div>
                            <div className="h-1 w-20 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all
                                  ${pct === 100 ? 'bg-green-400' : 'bg-accent'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Last Completed */}
                      <td className="py-3 text-gray-500 dark:text-white/50 text-xs whitespace-nowrap">
                        {linked && kajabi.latestDate ? fmtDate(kajabi.latestDate) : (linked ? '—' : '')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Agent detail modal */}
      {selected && (
        <AgentDetailModal
          agent={selected}
          kajabi={kajabiMap[selected.sfg_id?.toLowerCase()]}
          totalLessons={totalLessons}
          onClose={() => setSelected(null)}
          canWrite={permissions?.onboarding?.write ?? false}
          isHidden={hiddenIds.has(selected.sfg_id?.toLowerCase() ?? '')}
          onHideToggle={handleHideToggle}
          onUpdate={updated => {
            setSelected(updated)
            setMasterPersonnel(prev => prev.map(p => p.sfg_id === updated.sfg_id ? updated : p))
          }}
          onKajabiLinked={sfgId => loadKajabi([sfgId], true)}
        />
      )}

      {/* ── Add Agent Modal ─────────────────────────────────────────────────── */}
      {showAdd && (
        <AddAgentModal
          existingPersonnel={personnel}
          onClose={() => setShowAdd(false)}
          onAgentAdded={({ uplineWarning }) => {
            setShowAdd(false)
            setAddSuccess({ uplineWarning })
            setTimeout(() => setAddSuccess(null), 5000)
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id, mode)
          }}
        />
      )}

      {/* ── Add success toast ──────────────────────────────────────────────── */}
      {addSuccess && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all
          ${addSuccess.uplineWarning ? 'bg-amber-500' : 'bg-green-600'}`}>
          {addSuccess.uplineWarning
            ? 'Agent added — upline SFG ID not found in personnel'
            : 'Agent added successfully'}
        </div>
      )}
    </main>
  )
}

// ─── Contracting Cell ─────────────────────────────────────────────────────────

function ContractingCell({ toProducerDate, complete }) {
  if (complete)
    return <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-300 font-medium px-2 py-0.5 rounded-full">Complete</span>
  if (toProducerDate)
    return <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Sent {fmtDate(toProducerDate)}</span>
  return <span className="text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40 font-medium px-2 py-0.5 rounded-full">Not Started</span>
}

// ─── Agent Detail Modal ────────────────────────────────────────────────────────

const OB_INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

function AgentDetailModal({ agent, kajabi, totalLessons, onClose, canWrite, isHidden, onHideToggle, onUpdate, onKajabiLinked }) {
  const [lessons,     setLessons]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [editing,     setEditing]     = useState(false)
  const [draft,       setDraft]       = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState(null)
  const [kajabiEmail, setKajabiEmail] = useState(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load full lesson list for this agent
  useEffect(() => {
    if (!agent?.sfg_id) return
    loadLessons(agent.sfg_id)
  }, [agent?.sfg_id])

  async function loadLessons(sfgId) {
    setLoading(true)
    try {
      const res = await fetch(`/api/onboarding-progress?sfg_id=${encodeURIComponent(sfgId)}&detail=true`)
      if (!res.ok) { setLessons([]); return }
      const { lessons: data, kajabiEmail: email } = await res.json()
      setLessons(data ?? [])
      setKajabiEmail(email ?? null)
    } catch {
      setLessons([])
    } finally {
      setLoading(false)
    }
  }

  function startEdit() {
    setDraft({ ...agent })
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  function setField(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const keys = ['hire_date', 'upline_sfg_id', 'profile_issues', 'no_eando', 'contracting_to_producer', 'contracting_complete', 'surelc_profile_date']
      const updates = {}
      for (const key of keys) {
        if (String(draft[key] ?? '') !== String(agent[key] ?? '')) {
          updates[key] = String(draft[key] ?? '')
        }
      }

      if (Object.keys(updates).length === 0) {
        cancelEdit()
        return
      }

      const res = await fetch('/api/personnel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sfg_id: agent.sfg_id, updates }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      onUpdate?.(draft)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const completedCount = lessons.filter(l => l.completed).length
  const pct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{agent.name}</h2>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{agent.sfg_id}</p>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-400 dark:text-white/40 mb-1.5">
                <span>{completedCount} of {totalLessons} lessons</span>
                <span className={`font-bold ${pct === 100 ? 'text-green-600 dark:text-green-300' : 'text-gray-900 dark:text-white'}`}>{pct}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-400' : 'bg-accent'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            {/* Hide from page toggle */}
            <button
              onClick={() => onHideToggle?.(agent.sfg_id, !isHidden)}
              className={`text-xs font-medium transition-colors px-2 py-1 rounded-lg
                ${isHidden
                  ? 'text-accent hover:text-accent/80 hover:bg-accent/10'
                  : 'text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'
                }`}
            >
              {isHidden ? 'Unhide' : 'Hide from page'}
            </button>

            {canWrite && !editing && (
              <button
                onClick={startEdit}
                className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10"
              >
                Edit Details
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={cancelEdit}
                  className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {saving && (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300 flex-shrink-0">
            {saveError}
          </div>
        )}

        {/* Edit form panel */}
        {editing && draft && (
          <div className="p-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">Edit Details</p>
            <div className="grid grid-cols-2 gap-3">
              <OBEditField label="Hire Date"          value={toInputDate(draft.hire_date)}               onChange={v => setField('hire_date', v)}               type="date" />
              <OBEditField label="Upline SFG ID"       value={draft.upline_sfg_id ?? ''}                  onChange={v => setField('upline_sfg_id', v)} />
              <OBEditField label="Profile Issues"     value={draft.profile_issues ?? ''}                 onChange={v => setField('profile_issues', v)} />
              <div>
                <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">No E&amp;O</p>
                <label className="flex items-center gap-2 cursor-pointer mt-1.5">
                  <input
                    type="checkbox"
                    checked={!!draft.no_eando}
                    onChange={e => setField('no_eando', e.target.checked ? 'TRUE' : '')}
                    className="w-4 h-4 accent-accent rounded cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 dark:text-white/80">No E&amp;O</span>
                </label>
              </div>
              <OBEditField label="Contracting Sent"     value={toInputDate(draft.contracting_to_producer)} onChange={v => setField('contracting_to_producer', v)} type="date" />
              <OBEditField label="Contracting Complete" value={toInputDate(draft.contracting_complete)}    onChange={v => setField('contracting_complete', v)}    type="date" />
              <OBEditField label="SureLC Profile Date"  value={toInputDate(draft.surelc_profile_date)}    onChange={v => setField('surelc_profile_date', v)}    type="date" />
            </div>
          </div>
        )}

        {/* Kajabi link — always visible to writers; read-only if linked, input if not */}
        {canWrite && (
          <div className="px-4 py-3 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
            <KajabiLinkField
              sfgId={agent.sfg_id}
              kajabiEmail={kajabiEmail}
              onLinked={email => {
                setKajabiEmail(email)
                onKajabiLinked?.(agent.sfg_id)
              }}
            />
          </div>
        )}

        {/* Lesson list */}
        <div className="overflow-y-auto flex-1 p-4">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 bg-gray-100 dark:bg-white/10 rounded-lg" />)}
            </div>
          ) : lessons.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-white/40 text-center py-8">No Kajabi account linked to this agent.</p>
          ) : (
            <div className="space-y-1">
              {lessons.map(lesson => (
                <div
                  key={lesson.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg
                    ${lesson.completed ? 'bg-gray-50 dark:bg-white/5' : ''}`}
                >
                  {/* Check circle */}
                  <span className={`flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center
                    ${lesson.completed ? 'bg-accent border-accent' : 'border-gray-300 dark:border-white/20'}`}>
                    {lesson.completed && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>

                  {/* Lesson name */}
                  <span className={`text-sm flex-1 leading-snug
                    ${lesson.completed ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/45'}`}>
                    {lesson.lesson_name}
                  </span>

                  {/* Completed date */}
                  {lesson.completed_at && (
                    <span className="text-xs text-gray-400 dark:text-white/30 flex-shrink-0 tabular-nums">
                      {new Date(lesson.completed_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && lessons.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs text-gray-400 dark:text-white/25">{kajabi?.latestDate ? `Last activity ${fmtDate(kajabi.latestDate)}` : 'No completions yet'}</span>
            <span className="text-xs text-gray-400 dark:text-white/25">Esc to close</span>
          </div>
        )}
      </div>
    </div>
  )
}

function KajabiLinkField({ sfgId, kajabiEmail, onLinked }) {
  const [input,   setInput]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [linkErr, setLinkErr] = useState(null)

  async function handleLink() {
    const email = input.trim()
    if (!email) return
    setSaving(true)
    setLinkErr(null)
    try {
      const res = await fetch('/api/onboarding-progress', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sfg_id: sfgId, kajabi_email: email }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to link Kajabi email')
      }
      onLinked(email)
      setInput('')
    } catch (e) {
      setLinkErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-2">Kajabi</p>
      {kajabiEmail ? (
        <p className="text-sm text-gray-700 dark:text-white/70 font-mono">{kajabiEmail}</p>
      ) : (
        <>
          <div className="flex gap-2 items-center">
            <input
              type="email"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLink()}
              placeholder="Enter Kajabi email to link…"
              className={OB_INPUT_CLS}
            />
            <button
              onClick={handleLink}
              disabled={saving || !input.trim()}
              className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
            >
              {saving ? 'Linking…' : 'Link'}
            </button>
          </div>
          {linkErr && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{linkErr}</p>}
        </>
      )}
    </div>
  )
}

function OBEditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={OB_INPUT_CLS + (type === 'date' ? ' dark:[color-scheme:dark]' : '')}
      />
    </div>
  )
}
