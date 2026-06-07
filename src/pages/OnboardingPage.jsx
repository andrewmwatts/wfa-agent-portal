import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'

import AddAgentModal from '../components/AddAgentModal'
import ScopeDropdown from '../components/ScopeDropdown'
import { getBaseshopIds } from '../utils/agencyScope'

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


// ─── Quick-filter definitions ──────────────────────────────────────────────────
const QUICK_FILTERS = [
  { id: 'all',         label: 'All'         },
  { id: 'contracting', label: 'Contracting' },
]

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { userProfile }                = useAuth()
  const { activeSubject, permissions } = useViewing()

  const [masterPersonnel,  setMasterPersonnel]  = useState([])
  const [contractCounts,   setContractCounts]   = useState({}) // sfg_id → count of core carrier numbers
  const [carrierSets,      setCarrierSets]      = useState({}) // sfg_id → string[] of carriers they have
  const [coreCarriers,     setCoreCarriers]     = useState([]) // all core carrier names
  const [totalCarriers,    setTotalCarriers]    = useState(11) // from API
  const [hiddenIds,        setHiddenIds]        = useState(new Set())
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
      const sorted = [...rows].sort((a, b) => {
        const ac = !!a.contracting_complete, bc = !!b.contracting_complete
        if (ac !== bc) return ac ? 1 : -1
        return new Date(b.hire_date || 0) - new Date(a.hire_date || 0)
      })
      setMasterPersonnel(sorted)

      // Fetch contract number counts for all agents in one shot
      if (sorted.length > 0) {
        const ids = sorted.map(p => p.sfg_id).join(',')
        const cRes = await fetch(`/api/personnel?action=contract_counts&sfg_ids=${encodeURIComponent(ids)}`)
        if (cRes.ok) {
          const { counts, carrierSets: cs, total, coreCarriers: cc } = await cRes.json()
          setContractCounts(counts ?? {})
          setCarrierSets(cs ?? {})
          if (total) setTotalCarriers(total)
          if (cc?.length) setCoreCarriers(cc)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
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
      if ((contractCounts[r.sfg_id] ?? 0) >= totalCarriers) return false
      if (q && !r.name?.toLowerCase().includes(q)) return false
      if (quickFilter === 'contracting' && r.contracting_complete) return false
      return true
    })
  }, [personnel, hiddenIds, showHidden, quickFilter, search, contractCounts, totalCarriers])

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
          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">Contracting</h3>
          <div className="flex items-center gap-3">
            {isDirector && (
              <ScopeDropdown
                masterPersonnel={masterPersonnel}
                selfId={activeSubject?.sfg_id}
                value={selectedScope}
                onChange={setSelectedScope}
              />
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
                  {['Agent', 'Upline', 'Hire Date', 'Issues', 'No E&O', 'Contracting'].map(h => (
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
                  const hasIssue = r.profile_issues || !!r.no_eando

                  return (
                    <tr
                      key={r.sfg_id}
                      onClick={() => setSelected(r)}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group
                        ${hasIssue && !isHidden ? 'bg-amber-500/5' : ''}
                        ${isHidden ? 'opacity-40' : ''}`}
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900 dark:text-white group-hover:text-accent transition-colors leading-tight text-sm">{r.name}</p>
                      </td>
                      <td className="py-3 pr-4 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{r.upline_name || '—'}</td>
                      <td className="py-3 pr-4 text-gray-600 dark:text-white/60 text-xs whitespace-nowrap">{fmtDate(r.hire_date)}</td>
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
                      <td className="py-3 pr-4">
                        <ContractingCell
                          toProducerDate={r.contracting_to_producer}
                          complete={r.contracting_complete}
                          contractCount={contractCounts[r.sfg_id] ?? 0}
                          totalCarriers={totalCarriers}
                          agentCarriers={carrierSets[r.sfg_id] ?? []}
                          coreCarriers={coreCarriers}
                          noEando={!!r.no_eando}
                        />
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
          onClose={() => setSelected(null)}
          canWrite={permissions?.onboarding?.write ?? false}
          isHidden={hiddenIds.has(selected.sfg_id?.toLowerCase() ?? '')}
          onHideToggle={handleHideToggle}
          onUpdate={updated => {
            setSelected(updated)
            setMasterPersonnel(prev => prev.map(p => p.sfg_id === updated.sfg_id ? updated : p))
          }}
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

// Carriers that are exempt from the 14-day red rule when no_eando is TRUE.
// "Banner Life (BeyondTerm)" may be stored under either name in the DB.
const CONTRACTING_TRANSAMERICA = 'Transamerica'
const CONTRACTING_EXEMPT = new Set(['Banner Life (BeyondTerm)', 'SBLI', 'American General'])

function contractingIsRed(agentCarriers, coreCarriers, toProducerDate, noEando) {
  if (!coreCarriers.length) return false
  const days = daysSince(toProducerDate)
  if (days === null) return false

  const have = new Set(agentCarriers)
  const missing = coreCarriers.filter(c => !have.has(c))
  if (!missing.length) return false

  const missingTa     = missing.includes(CONTRACTING_TRANSAMERICA)
  const missingOthers = missing.filter(c => c !== CONTRACTING_TRANSAMERICA)

  // Rule 1: Transamerica missing + >30 days
  if (missingTa && days > 30) return true

  // Rule 2: any non-Transamerica carrier missing + >14 days
  if (missingOthers.length > 0 && days > 14) {
    // Exception: ALL remaining missing are exempt carriers AND agent has no E&O
    const onlyExempt = missingOthers.every(c => CONTRACTING_EXEMPT.has(c))
    if (onlyExempt && noEando) return false
    return true
  }

  return false
}

function ContractingCell({
  toProducerDate, complete, contractCount = 0, totalCarriers = 11,
  agentCarriers = [], coreCarriers = [], noEando = false,
}) {
  // All contracts received → green Complete
  if (complete && contractCount >= totalCarriers)
    return <span className="text-xs bg-green-500/20 text-green-600 dark:text-green-300 font-medium px-2 py-0.5 rounded-full">Complete</span>

  // Contracting marked complete, numbers partially or not yet populated
  if (complete) {
    const red = contractingIsRed(agentCarriers, coreCarriers, toProducerDate, noEando)
    const cls = red ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
    if (contractCount > 0)
      return <span className={`text-xs font-semibold ${cls}`}>{contractCount} of {totalCarriers}</span>
    return <span className={`text-xs font-semibold ${cls}`}>Requested</span>
  }

  // Contracting sent but not complete → orange
  if (toProducerDate)
    return <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Sent {fmtDate(toProducerDate)}</span>

  // Not started
  return <span className="text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40 font-medium px-2 py-0.5 rounded-full">Not Started</span>
}

// ─── Agent Detail Modal ────────────────────────────────────────────────────────

const OB_INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

function AgentDetailModal({ agent, onClose, canWrite, isHidden, onHideToggle, onUpdate }) {
  const [contractNums,  setContractNums]  = useState([])
  const [carriers,      setCarriers]      = useState([])
  const [cnLoading,     setCnLoading]     = useState(true)
  const [showOther,     setShowOther]     = useState(false)
  const [editing,       setEditing]       = useState(false)
  const [draft,         setDraft]         = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [saveError,     setSaveError]     = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!agent?.sfg_id) return
    loadContractData(agent.sfg_id)
  }, [agent?.sfg_id])

  async function loadContractData(sfgId) {
    setCnLoading(true)
    try {
      const res = await fetch(`/api/personnel?action=contracts&sfg_id=${encodeURIComponent(sfgId)}`)
      if (!res.ok) { setContractNums({}); setCarriers([]); return }
      const { contracts, carriers: carrierList } = await res.json()
      setContractNums(contracts ?? {})
      setCarriers(carrierList ?? [])
    } catch {
      setContractNums({})
      setCarriers([])
    } finally {
      setCnLoading(false)
    }
  }

  function startEdit() { setDraft({ ...agent }); setEditing(true); setSaveError(null) }
  function cancelEdit() { setEditing(false); setDraft(null); setSaveError(null) }
  function setField(key, value) { setDraft(d => ({ ...d, [key]: value })) }

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
      if (Object.keys(updates).length === 0) { cancelEdit(); return }
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

  const coreCarrierNames = new Set(carriers.map(c => c.name))
  const otherContracts   = Object.values(contractNums).filter(c => !coreCarrierNames.has(c.carrier))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{agent.name}</h2>
            <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">{agent.sfg_id}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onHideToggle?.(agent.sfg_id, !isHidden)}
              className={`text-xs font-medium transition-colors px-2 py-1 rounded-lg
                ${isHidden ? 'text-accent hover:text-accent/80 hover:bg-accent/10'
                : 'text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'}`}
            >
              {isHidden ? 'Unhide' : 'Hide'}
            </button>
            {canWrite && !editing && (
              <button onClick={startEdit} className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10">
                Edit Details
              </button>
            )}
            {editing && (
              <>
                <button onClick={cancelEdit} className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center gap-1.5">
                  {saving && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300 flex-shrink-0">{saveError}</div>
        )}

        {/* Edit form */}
        {editing && draft && (
          <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">Edit Details</p>
            <div className="grid grid-cols-2 gap-3">
              <OBEditField label="Hire Date"            value={toInputDate(draft.hire_date)}               onChange={v => setField('hire_date', v)}               type="date" />
              <OBEditField label="Upline SFG ID"         value={draft.upline_sfg_id ?? ''}                  onChange={v => setField('upline_sfg_id', v)} />
              <OBEditField label="Profile Issues"       value={draft.profile_issues ?? ''}                 onChange={v => setField('profile_issues', v)} />
              <div>
                <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">No E&amp;O</p>
                <label className="flex items-center gap-2 cursor-pointer mt-1.5">
                  <input type="checkbox" checked={!!draft.no_eando}
                    onChange={e => setField('no_eando', e.target.checked ? 'TRUE' : '')}
                    className="w-4 h-4 accent-accent rounded cursor-pointer" />
                  <span className="text-sm text-gray-700 dark:text-white/80">No E&amp;O</span>
                </label>
              </div>
              <OBEditField label="Contracting Sent"     value={toInputDate(draft.contracting_to_producer)} onChange={v => setField('contracting_to_producer', v)} type="date" />
              <OBEditField label="Contracting Complete" value={toInputDate(draft.contracting_complete)}    onChange={v => setField('contracting_complete', v)}    type="date" />
              <OBEditField label="SureLC Profile Date"  value={toInputDate(draft.surelc_profile_date)}    onChange={v => setField('surelc_profile_date', v)}    type="date" />
            </div>
          </div>
        )}

        {/* Contract numbers */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">Contract Numbers</p>

          {cnLoading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-lg" />)}
            </div>
          ) : (
            <>
              {/* Core carriers — inline-editable */}
              <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                      {['Carrier', 'Contract Number', 'Status'].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-3 py-2 first:pl-4 last:pr-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {carriers.map(c => {
                      const cn     = contractNums[c.name]
                      const status = computeContractStatus(cn, agent, c.alert_threshold_days)
                      return (
                        <tr key={c.name} className="bg-white dark:bg-primary/20">
                          <td className="px-3 pl-4 py-2 text-xs font-medium text-gray-800 dark:text-white/80 whitespace-nowrap w-40">{c.name}</td>
                          <td className="px-3 py-1.5">
                            <ContractNumberInput
                              sfgId={agent.sfg_id}
                              carrier={c.name}
                              initialValue={cn?.contract_number ?? ''}
                              onSaved={loadContractData}
                            />
                          </td>
                          <td className="px-3 pr-4 py-2 whitespace-nowrap">
                            <ContractStatusBadge status={status} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Other carriers (collapsible, read-only) */}
              {otherContracts.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowOther(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showOther ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Other carriers ({otherContracts.length})
                  </button>
                  {showOther && (
                    <div className="mt-2 rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                          {otherContracts.map(cn => (
                            <tr key={cn.carrier} className="bg-white dark:bg-primary/20">
                              <td className="px-3 pl-4 py-2 text-xs font-medium text-gray-700 dark:text-white/70 w-40">{cn.carrier}</td>
                              <td className="px-3 pr-4 py-2 text-xs font-mono text-gray-500 dark:text-white/50">{cn.contract_number}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0 flex items-center justify-end">
          <span className="text-xs text-gray-400 dark:text-white/25">Esc to close</span>
        </div>
      </div>
    </div>
  )
}

// ─── Contract number status helpers ──────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  return Math.floor((now - d) / 86400000)
}

function computeContractStatus(cn, agent, thresholdDays) {
  if (cn) return { type: 'ok', cn }

  const days = daysSince(agent.contracting_to_producer)

  if (!agent.contracting_to_producer) return { type: 'not_requested' }

  if (agent.contracting_complete) return { type: 'data_issue' }

  if (days !== null && days > thresholdDays) {
    return { type: 'overdue', days, overdueDays: days - thresholdDays }
  }

  return { type: 'pending', days: days ?? 0 }
}

function ContractNumberInput({ sfgId, carrier, initialValue, onSaved }) {
  const [value,   setValue]   = useState(initialValue)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  // Sync if the parent reloads data (agent switch)
  useEffect(() => { setValue(initialValue) }, [initialValue])

  async function handleBlur() {
    if (value === initialValue) return  // no change
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/personnel?action=upsert_contract', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sfg_id: sfgId, carrier, contract_number: value }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.(sfgId)  // refresh counts + display
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={value}
        onChange={e => { setValue(e.target.value); setSaved(false); setError(null) }}
        onBlur={handleBlur}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        placeholder="—"
        className="w-full max-w-[160px] bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-800 dark:text-white/80 text-xs font-mono rounded px-2 py-1 focus:outline-none focus:border-accent/60 focus:bg-white dark:focus:bg-white/10 transition-colors"
      />
      {saving && <span className="text-[10px] text-gray-400 dark:text-white/30 whitespace-nowrap">Saving…</span>}
      {saved   && <span className="text-[10px] text-green-600 dark:text-green-400 whitespace-nowrap">✓</span>}
      {error   && <span className="text-[10px] text-red-500 whitespace-nowrap">!</span>}
    </div>
  )
}

function ContractStatusBadge({ status }) {
  if (status.type === 'ok') {
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-600 dark:text-green-400"><span className="text-xs">✓</span>On file</span>
  }
  if (status.type === 'not_requested') {
    return <span className="text-[10px] text-gray-400 dark:text-white/30">Not requested</span>
  }
  if (status.type === 'pending') {
    return <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Pending {status.days}d</span>
  }
  if (status.type === 'overdue') {
    return <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">Overdue {status.overdueDays}d</span>
  }
  if (status.type === 'data_issue') {
    return <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400">Requested — # missing</span>
  }
  return null
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
