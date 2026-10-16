import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'

import AddAgentModal from '../components/AddAgentModal'
import BulkAgentImportModal from '../components/BulkAgentImportModal'
import ScopeDropdown from '../components/ScopeDropdown'
import MoreMenu from '../components/ui/MoreMenu'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { useMinSm } from '../hooks/useMediaQuery'
import { SHEET_OVERLAY, SHEET_PANEL, SHEET_FOOT_PAD } from '../components/ui/sheetClasses'
import { getBaseshopIds } from '../../shared/agencyScope'
import { toInputDate, fmtDate, parseDateLocal } from '../utils/format'
import { makeAuthHeaders } from '../utils/authHeaders'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTruthy(val) {
  if (!val) return false
  if (typeof val === 'boolean') return val
  return ['true', 'yes', 'y', 'x', '1'].includes(String(val).trim().toLowerCase())
}


// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { userProfile, session }       = useAuth()
  const { activeSubject, permissions } = useViewing()
  const { theme } = useTheme()

  const authHeaders = () => makeAuthHeaders(session)

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
  const [carrierFilter, setCarrierFilter] = useState('') // '' | core carrier name — missing-contract filter

  // Director = role-based; drives master/baseshop toggle
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [search, setSearch] = useState('')

  const [selected,    setSelected]    = useState(null) // personnel row for detail modal
  const [showAdd,     setShowAdd]     = useState(false)
  const [showImport,  setShowImport]  = useState(false)
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
      if (!showHidden && r.contracting_complete && (contractCounts[r.sfg_id] ?? 0) >= totalCarriers) return false
      if (carrierFilter && !(r.contracting_complete && !(carrierSets[r.sfg_id] ?? []).includes(carrierFilter))) return false
      if (q && !r.name?.toLowerCase().includes(q)) return false
      return true
    })
  }, [personnel, hiddenIds, showHidden, search, contractCounts, totalCarriers, carrierFilter, carrierSets])

  // Visible (non-hidden) count for the counter chip
  const visibleCount = useMemo(
    () => personnel.filter(r => !hiddenIds.has(r.sfg_id?.toLowerCase() ?? '')).length,
    [personnel, hiddenIds]
  )

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 space-y-4 animate-pulse">
        <div className="flex gap-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 dark:bg-white/10 rounded-full w-28" />)}
        </div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 dark:bg-white/10 rounded" />)}
      </div>
    </main>
  )

  if (error) return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
      <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6">
        <p className="text-sm text-accent/80">{error}</p>
      </div>
    </main>
  )

  const ctlCls = 'bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg focus:outline-none focus:border-accent cursor-pointer'

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-5">
      <section className="md:bg-white md:dark:bg-primary/30 md:border md:border-gray-200 md:dark:border-white/10 md:rounded-2xl md:p-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        {/* Phone: title with the scope select beside it; Add / Import move behind the ⋯ menu */}
        <div className="flex items-center gap-1.5 md:gap-3 mb-3 md:mb-5">
          <h3 className="flex-1 min-w-0 truncate text-[22px] font-bold text-gray-900 dark:text-white md:flex-none md:text-sm md:font-semibold md:uppercase md:tracking-widest md:text-gray-500 md:dark:text-white/50">Contracting</h3>
          <div className="md:flex-1" />
          {isDirector && (
            <ScopeDropdown
              masterPersonnel={masterPersonnel}
              selfId={activeSubject?.sfg_id}
              value={selectedScope}
              onChange={setSelectedScope}
            />
          )}
          <span className="hidden md:inline text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">
            {rows.length.toLocaleString()} of {visibleCount.toLocaleString()} agents
          </span>
          <MoreMenu
            className="md:hidden shrink-0"
            items={[
              { label: '+ Add Agent', onClick: () => setShowAdd(true),    hidden: !isSuperAdmin },
              { label: 'Import CSV',  onClick: () => setShowImport(true), hidden: !isSuperAdmin },
            ]}
          />
          {isSuperAdmin && (
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => setShowAdd(true)}
                className="text-xs px-3 py-1.5 touch:min-h-[44px] rounded-lg border border-accent text-gray-900 dark:text-white font-semibold hover:bg-accent/10 transition-colors whitespace-nowrap"
              >
                + Add Agent
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="text-xs px-3 py-1.5 touch:min-h-[44px] rounded-lg border border-accent bg-primary text-white dark:bg-white dark:text-primary font-semibold hover:bg-primary/85 dark:hover:bg-white/90 transition-colors whitespace-nowrap"
              >
                Import CSV
              </button>
            </div>
          )}
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <p className="md:hidden w-full text-sm text-gray-600 dark:text-white/60">
            {rows.length.toLocaleString()} of {visibleCount.toLocaleString()} agents
          </p>

          {/* Search first on a phone (full width); right-aligned with the other controls from md up */}
          <div className="relative w-full md:w-44 order-first md:order-last">
            <svg className="absolute left-3.5 md:left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] md:w-3 md:h-3 text-gray-400 dark:text-white/50 pointer-events-none"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search agent…"
              aria-label="Search agent"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-500 dark:bg-white/5 dark:border-white/15 dark:text-white dark:placeholder:text-white/40 text-base md:text-xs rounded-xl md:rounded-lg pl-10 md:pl-7 pr-3 h-12 md:h-auto md:py-1.5 touch:md:min-h-[44px] focus:outline-none focus:border-accent/60"
            />
          </div>

          <div className="md:ml-auto flex items-center gap-2 w-full md:w-auto">
            {/* Missing carrier — only among agents with contracting complete */}
            {coreCarriers.length > 0 && (
              <select
                value={carrierFilter}
                onChange={e => setCarrierFilter(e.target.value)}
                aria-label="Missing carrier"
                className={`${ctlCls} flex-1 md:flex-none min-w-0 text-xs max-md:text-base max-md:h-11 max-md:rounded-xl px-2.5 max-md:px-3 py-1 touch:md:min-h-[44px]`}
              >
                <option value="" style={theme === 'dark' ? { background: '#003539', color: '#fff' } : {}}>Missing carrier…</option>
                {coreCarriers.map(c => (
                  <option key={c} value={c} style={theme === 'dark' ? { background: '#003539', color: '#fff' } : {}}>{c}</option>
                ))}
              </select>
            )}

            {/* Show hidden — secondary escape hatch */}
            <button
              onClick={() => setShowHidden(v => !v)}
              aria-pressed={showHidden}
              className={`text-sm md:text-xs font-medium px-3 max-md:h-11 md:py-1.5 touch:md:min-h-[44px] rounded-xl md:rounded-lg border transition-colors whitespace-nowrap
                ${showHidden
                  ? 'text-gray-900 dark:text-white border-accent bg-accent/15'
                  : 'text-gray-600 dark:text-white/60 border-gray-200 dark:border-white/15 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/25'
                }`}
            >
              Show hidden
            </button>
          </div>
        </div>{/* end filter bar */}

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-white/50 text-center py-8">No agents match the current filter.</p>
        ) : (
          <>
          {/* Phone: one card per agent */}
          <ul className="md:hidden space-y-2.5">
            {rows.map(r => {
              const id       = r.sfg_id?.toLowerCase() ?? ''
              const isHidden = hiddenIds.has(id)
              const hasIssue = r.profile_issues || !!r.no_eando
              return (
                <li key={r.sfg_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors active:bg-gray-50 dark:active:bg-white/10
                      ${hasIssue && !isHidden ? 'bg-amber-500/5 border-amber-500/40' : 'bg-white dark:bg-primary/30 border-gray-200 dark:border-white/10'}
                      ${isHidden ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-base font-semibold text-gray-900 dark:text-white truncate">{r.name}</span>
                      <span className="shrink-0">
                        <ContractingCell
                          toProducerDate={r.contracting_to_producer}
                          complete={r.contracting_complete}
                          contractCount={contractCounts[r.sfg_id] ?? 0}
                          totalCarriers={totalCarriers}
                          agentCarriers={carrierSets[r.sfg_id] ?? []}
                          coreCarriers={coreCarriers}
                          noEando={!!r.no_eando}
                        />
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-white/65">
                      {r.upline_name ? `Upline ${r.upline_name}` : 'No upline'} · Hired {fmtDate(r.hire_date)}
                    </div>
                    {(r.profile_issues || !!r.no_eando) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.profile_issues && <span className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium px-2 py-0.5 rounded">{r.profile_issues}</span>}
                        {!!r.no_eando && <span className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 font-medium px-2 py-0.5 rounded">No E&amp;O</span>}
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {['Agent', 'Upline', 'Hire Date', 'Issues', 'No E&O', 'Contracting'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 pb-2.5 pr-4 last:pr-0 whitespace-nowrap">
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
                          : <span className="text-gray-400 dark:text-white/35 text-xs">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-center">
                        {!!r.no_eando
                          ? <span className="text-xs font-bold text-accent">✕</span>
                          : <span className="text-gray-400 dark:text-white/35 text-xs">—</span>}
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
          </>
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
            if (activeSubject?.sfg_id) load(activeSubject.sfg_id)
          }}
        />
      )}

      {/* ── Bulk Import Modal ───────────────────────────────────────────────── */}
      {showImport && (
        <BulkAgentImportModal
          existingPersonnel={personnel}
          authHeaders={authHeaders}
          onClose={() => setShowImport(false)}
          onImportDone={() => { if (activeSubject?.sfg_id) load(activeSubject.sfg_id) }}
        />
      )}

      {/* ── Add success toast ──────────────────────────────────────────────── */}
      {addSuccess && (
        <div className={`fixed z-[60] max-sm:inset-x-4 max-sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-6 sm:right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all !mt-0
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

// Carriers that are exempt from the 7-day red rule when no_eando is TRUE.
// "Banner Life (BeyondTerm)" may be stored under either name in the DB.
const CONTRACTING_TRANSAMERICA = 'Transamerica'
const CONTRACTING_EXEMPT = new Set(['Banner Life (BeyondTerm)', 'SBLI', 'American General'])

function contractingIsRed(agentCarriers, coreCarriers, completeDate, noEando) {
  if (!coreCarriers.length) return false
  const days = daysSince(completeDate)
  if (days === null) return false

  const have = new Set(agentCarriers)
  const missing = coreCarriers.filter(c => !have.has(c))
  if (!missing.length) return false

  const missingTa     = missing.includes(CONTRACTING_TRANSAMERICA)
  const missingOthers = missing.filter(c => c !== CONTRACTING_TRANSAMERICA)

  // Rule 1: Transamerica missing + >30 days
  if (missingTa && days > 30) return true

  // Rule 2: any non-Transamerica carrier missing + >7 days
  if (missingOthers.length > 0 && days > 7) {
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
    return <span className="text-sm md:text-xs bg-green-500/20 text-green-700 dark:text-green-300 font-medium px-2 py-0.5 rounded-full">Complete</span>

  // Contracting marked complete, numbers partially or not yet populated
  if (complete) {
    const red = contractingIsRed(agentCarriers, coreCarriers, complete, noEando)
    const cls = red ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
    if (contractCount > 0)
      return <span className={`text-sm md:text-xs font-semibold ${cls}`}>{contractCount} of {totalCarriers}</span>
    return <span className={`text-sm md:text-xs font-semibold ${cls}`}>Requested</span>
  }

  // Contracting sent but not complete → orange
  if (toProducerDate)
    return <span className="text-sm md:text-xs font-medium text-orange-700 dark:text-orange-400">Sent {fmtDate(toProducerDate)}</span>

  // Not started
  return <span className="text-sm md:text-xs bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 font-medium px-2 py-0.5 rounded-full">Not Started</span>
}

// ─── Agent Detail Modal ────────────────────────────────────────────────────────

const OB_INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 max-sm:py-3 max-sm:rounded-xl touch:sm:min-h-[44px] focus:outline-none focus:ring-2 focus:ring-accent/60'

function AgentDetailModal({ agent, onClose, canWrite, isHidden, onHideToggle, onUpdate }) {
  const [contractNums,  setContractNums]  = useState([])
  const [carriers,      setCarriers]      = useState([])
  const [cnLoading,     setCnLoading]     = useState(true)
  const [showOther,     setShowOther]     = useState(false)
  const [editing,       setEditing]       = useState(false)
  const [draft,         setDraft]         = useState(null)
  const [saving,        setSaving]        = useState(false)
  const [saveError,     setSaveError]     = useState(null)
  const isSm = useMinSm()
  useBodyScrollLock(true)

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

  const spinner = (
    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
  )

  // Phone: Hide / Text live behind "⋯" so the top bar stays one tidy row.
  const moreItems = [
    { label: 'Text agent', hidden: !agent.phone, onClick: () => { window.location.href = `sms:${agent.phone}` } },
    { label: isHidden ? 'Unhide agent' : 'Hide agent', onClick: () => onHideToggle?.(agent.sfg_id, !isHidden) },
  ]

  return (
    <div
      className={SHEET_OVERLAY}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`${SHEET_PANEL} bg-gray-50 dark:bg-secondary sm:max-w-2xl sm:max-h-[88vh]`}>

        {/* ── Phone top bar ───────────────────────────────────────────────── */}
        <div className="sm:hidden shrink-0 pt-[env(safe-area-inset-top)] bg-white dark:bg-primary border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center h-14 pl-1 pr-2">
            {editing ? (
              <>
                <button type="button" onClick={cancelEdit} className="h-11 w-24 px-3 text-left text-base font-semibold text-gray-900 dark:text-white">Cancel</button>
                <h2 className="flex-1 min-w-0 text-center text-base font-bold text-gray-900 dark:text-white truncate">Edit details</h2>
                <div className="w-24" />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg>
                </button>
                <h2 className="flex-1 min-w-0 ml-1 text-base font-bold text-gray-900 dark:text-white truncate">Agent</h2>
                {canWrite && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="h-10 px-4 mr-1.5 rounded-xl border border-accent text-sm font-semibold text-gray-900 dark:text-white hover:bg-accent/10"
                  >
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
              </>
            )}
          </div>
        </div>

        {/* ── Header (sm+) ────────────────────────────────────────────────── */}
        <div className="hidden sm:flex items-start justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{agent.name}</h2>
              {agent.phone && (
                <a
                  href={`sms:${agent.phone}`}
                  onClick={e => e.stopPropagation()}
                  title="Text"
                  aria-label={`Text ${agent.name}`}
                  className="flex items-center justify-center w-7 h-7 touch:w-11 touch:h-11 rounded-full text-gray-500 dark:text-white/50 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </a>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">{agent.sfg_id}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onHideToggle?.(agent.sfg_id, !isHidden)}
              className={`text-xs font-medium transition-colors px-2 py-1 touch:min-h-[44px] rounded-lg
                ${isHidden ? 'text-gray-900 dark:text-white hover:bg-accent/10'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'}`}
            >
              {isHidden ? 'Unhide' : 'Hide'}
            </button>
            {canWrite && !editing && (
              <button onClick={startEdit} className="text-xs font-medium text-gray-900 dark:text-white transition-colors px-2 py-1 touch:min-h-[44px] rounded-lg hover:bg-accent/10">
                Edit Details
              </button>
            )}
            {editing && (
              <>
                <button onClick={cancelEdit} className="text-xs font-medium text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 touch:min-h-[44px] rounded-lg hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="text-xs font-semibold border border-accent bg-primary text-white dark:bg-white dark:text-primary px-3 py-1.5 touch:min-h-[44px] rounded-lg hover:bg-primary/85 dark:hover:bg-white/90 transition-colors disabled:opacity-60 flex items-center gap-1.5">
                  {saving && spinner}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button onClick={onClose} aria-label="Close" className="text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white transition-colors p-1 touch:p-3">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* ── Scroll area ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">

          {/* Phone summary: the sm+ header carries this instead */}
          <div className="sm:hidden px-4 pt-4 pb-3">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{agent.name}</h2>
            <p className="text-sm text-gray-600 dark:text-white/60 mt-0.5">{agent.sfg_id}{isHidden ? ' · Hidden' : ''}</p>
          </div>

          {saveError && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 dark:text-red-300">{saveError}</div>
          )}

          {/* Edit form */}
          {editing && draft && (
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-white/10">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 mb-3">Edit Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <OBEditField label="Hire Date"            value={toInputDate(draft.hire_date)}               onChange={v => setField('hire_date', v)}               type="date" />
                <OBEditField label="Upline SFG ID"         value={draft.upline_sfg_id ?? ''}                  onChange={v => setField('upline_sfg_id', v)} />
                <OBEditField label="Profile Issues"       value={draft.profile_issues ?? ''}                 onChange={v => setField('profile_issues', v)} />
                <div>
                  <p className="text-xs text-gray-500 dark:text-white/50 mb-0.5">No E&amp;O</p>
                  <label className="flex items-center gap-3 sm:gap-2 cursor-pointer mt-1 max-sm:min-h-[44px] touch:min-h-[44px]">
                    <input type="checkbox" checked={!!draft.no_eando}
                      onChange={e => setField('no_eando', e.target.checked ? 'TRUE' : '')}
                      className="w-5 h-5 sm:w-4 sm:h-4 accent-accent rounded cursor-pointer" />
                    <span className="text-base sm:text-sm text-gray-700 dark:text-white/80">No E&amp;O</span>
                  </label>
                </div>
                <OBEditField label="Contracting Sent"     value={toInputDate(draft.contracting_to_producer)} onChange={v => setField('contracting_to_producer', v)} type="date" />
                <OBEditField label="Contracting Complete" value={toInputDate(draft.contracting_complete)}    onChange={v => setField('contracting_complete', v)}    type="date" />
                <OBEditField label="SureLC Profile Date"  value={toInputDate(draft.surelc_profile_date)}    onChange={v => setField('surelc_profile_date', v)}    type="date" />
              </div>
            </div>
          )}

          {/* Agent status strip */}
          <div className="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-white/10 flex flex-wrap items-center gap-2">
            {agent.profile_issues
              ? <span className="text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium px-2 py-0.5 rounded">{agent.profile_issues}</span>
              : <span className="text-xs text-gray-500 dark:text-white/45">No profile issues</span>
            }
            {isTruthy(agent.no_eando)
              ? <span className="text-xs bg-red-500/15 text-red-700 dark:text-red-400 font-medium px-2 py-0.5 rounded">No E&amp;O</span>
              : <span className="text-xs text-gray-500 dark:text-white/45">E&amp;O on file</span>
            }
            {agent.contracting_complete
              ? <span className="text-xs text-green-700 dark:text-green-400">Contracts completed {fmtDate(agent.contracting_complete)}</span>
              : agent.contracting_to_producer
              ? <span className="text-xs text-amber-700 dark:text-amber-400">Contracts sent {fmtDate(agent.contracting_to_producer)}</span>
              : <span className="text-xs text-gray-500 dark:text-white/45">Contracts not sent</span>
            }
          </div>

          {/* Contract numbers */}
          <div className="px-4 sm:px-6 py-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">Contract Numbers</p>

            {cnLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-lg" />)}
              </div>
            ) : (
              <>
                {/* Core carriers — inline-editable. Phone: one block per carrier; sm+: table */}
                {!isSm ? (
                  <ul className="space-y-2.5">
                    {carriers.map(c => {
                      const cn     = contractNums[c.name]
                      const status = computeContractStatus(cn, agent, c.alert_threshold_days)
                      return (
                        <li key={c.name} className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-primary/20 px-4 py-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
                            <ContractStatusBadge status={status} />
                          </div>
                          <ContractNumberInput
                            sfgId={agent.sfg_id}
                            carrier={c.name}
                            initialValue={cn?.contract_number ?? ''}
                            onSaved={loadContractData}
                            ariaLabel={`${c.name} contract number`}
                          />
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                          {['Carrier', 'Contract Number', 'Status'].map(h => (
                            <th key={h} className="text-left text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50 px-3 py-2 first:pl-4 last:pr-4 whitespace-nowrap">{h}</th>
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
                                  ariaLabel={`${c.name} contract number`}
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
                )}

                {/* Other carriers (collapsible, read-only) */}
                {otherContracts.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowOther(v => !v)}
                      aria-expanded={showOther}
                      className="flex items-center gap-1.5 text-sm sm:text-xs font-medium text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors max-sm:min-h-[44px] touch:min-h-[44px]"
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
                                <td className="px-3 pl-4 py-2.5 text-xs font-medium text-gray-700 dark:text-white/70 sm:w-40">{cn.carrier}</td>
                                <td className="px-3 pr-4 py-2.5 text-xs font-mono text-gray-600 dark:text-white/60 text-right sm:text-left">{cn.contract_number}</td>
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
        </div>

        {/* Phone: pinned Save while editing */}
        {editing && (
          <div className={`sm:hidden shrink-0 border-t border-gray-200 dark:border-white/10 bg-white dark:bg-primary px-4 pt-3 ${SHEET_FOOT_PAD}`}>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-12 rounded-xl border border-accent bg-primary text-white dark:bg-white dark:text-primary text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving && spinner}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}

        <div className="hidden sm:flex px-6 py-3 border-t border-gray-200 dark:border-white/10 flex-shrink-0 items-center justify-end">
          <span className="text-xs text-gray-500 dark:text-white/40">Esc to close</span>
        </div>
      </div>
    </div>
  )
}

// ─── Contract number status helpers ──────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return null
  const d = parseDateLocal(dateStr); if (!d) return null; d.setHours(0,0,0,0)
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

function ContractNumberInput({ sfgId, carrier, initialValue, onSaved, ariaLabel }) {
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
        aria-label={ariaLabel}
        className="w-full sm:max-w-[160px] bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-800 dark:text-white/80 text-xs font-mono max-sm:h-11 max-sm:rounded-lg max-sm:px-3 sm:rounded sm:px-2 sm:py-1 touch:sm:min-h-[44px] focus:outline-none focus:border-accent/60 focus:bg-white dark:focus:bg-white/10 transition-colors"
      />
      {saving && <span className="text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">Saving…</span>}
      {saved   && <span className="text-xs text-green-700 dark:text-green-400 whitespace-nowrap">✓</span>}
      {error   && <span className="text-xs text-red-600 whitespace-nowrap">!</span>}
    </div>
  )
}

function ContractStatusBadge({ status }) {
  if (status.type === 'ok') {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400"><span className="text-xs">✓</span>On file</span>
  }
  if (status.type === 'not_requested') {
    return <span className="text-xs text-gray-500 dark:text-white/50">Not requested</span>
  }
  if (status.type === 'pending') {
    return <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Pending {status.days}d</span>
  }
  if (status.type === 'overdue') {
    return <span className="text-xs font-semibold text-red-700 dark:text-red-400">Overdue {status.overdueDays}d</span>
  }
  if (status.type === 'data_issue') {
    return <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">Requested — # missing</span>
  }
  return null
}

function OBEditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-white/50 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={OB_INPUT_CLS + (type === 'date' ? ' dark:[color-scheme:dark]' : '')}
      />
    </div>
  )
}
