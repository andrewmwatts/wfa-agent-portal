import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth }    from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import AgentRow from '../components/accountability/AgentRow'
import { toYMD, subDays } from '../components/accountability/utils/accountabilityCalc'

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtHeaderDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// ── Agent search input (used inside MembersDialog) ────────────────────────────

function AgentSearchInput({ allAgents, rosterIds, onAdd }) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlight] = useState(0)
  const [results, setResults]       = useState([])
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) { setResults([]); return }
      const q = query.toLowerCase()
      setResults(
        allAgents
          .filter(a => !rosterIds.has(a.sfg_id) && `${a.preferred_name} ${a.opt_name}`.toLowerCase().includes(q))
          .slice(0, 8)
      )
      setHighlight(0)
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [query, allAgents, rosterIds])

  function pick(agent) {
    onAdd(agent)
    setQuery('')
    setOpen(false)
    setResults([])
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape')    { setOpen(false); setQuery(''); setResults([]) }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter' && results[highlighted]) pick(results[highlighted])
  }

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search to add agent…"
          className="flex-1 bg-transparent text-[13px] text-gray-800 dark:text-white placeholder-gray-400 outline-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-10 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 overflow-hidden">
          {results.map((agent, i) => (
            <button
              key={agent.sfg_id}
              onMouseDown={() => pick(agent)}
              className={`w-full text-left px-3 py-2.5 flex items-center transition-colors ${i === highlighted ? 'bg-gray-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
            >
              <span className="text-[13px] text-gray-800 dark:text-white">{agent.preferred_name}</span>
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && results.length === 0 && (
        <div className="absolute top-10 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 px-3 py-2.5">
          <span className="text-[12px] text-gray-400 dark:text-gray-500">No agents found</span>
        </div>
      )}
    </div>
  )
}

// ── Manage Members dialog ─────────────────────────────────────────────────────

function MembersDialog({ open, onClose, allAgents, rosterIds, agentMap, roster, onAdd, onRemove, onClearAll }) {
  const [clearConfirm, setClearConfirm] = useState(false)

  useEffect(() => {
    if (!open) setClearConfirm(false)
  }, [open])

  if (!open) return null

  const sortedRoster = [...roster].sort((a, b) => {
    const na = agentMap[a]?.preferred_name ?? ''
    const nb = agentMap[b]?.preferred_name ?? ''
    return na.localeCompare(nb)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] border border-gray-200 dark:border-gray-700">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">
            Manage members
            <span className="ml-2 text-[12px] font-normal text-gray-400 dark:text-gray-500">
              {roster.length} on call
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <AgentSearchInput allAgents={allAgents} rosterIds={rosterIds} onAdd={onAdd} />
        </div>

        {/* Member list */}
        <div className="overflow-y-auto flex-1 px-5 py-1">
          {sortedRoster.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-gray-400 dark:text-gray-500">No agents on this call yet.</p>
          ) : (
            sortedRoster.map(id => {
              const agent = agentMap[id]
              if (!agent) return null
              return (
                <div key={id} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                  <span className="text-[13px] text-gray-800 dark:text-gray-200">{agent.preferred_name}</span>
                  <button
                    onClick={() => onRemove(id)}
                    className="p-1 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors"
                    title={`Remove ${agent.preferred_name}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 shrink-0 flex items-center justify-between">
          {clearConfirm ? (
            <span className="flex items-center gap-2 text-[12px]">
              <span className="text-gray-500 dark:text-gray-400">Remove everyone?</span>
              <button
                onClick={() => { onClearAll(); setClearConfirm(false); onClose() }}
                className="text-red-500 font-medium hover:text-red-600"
              >
                Yes, clear all
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setClearConfirm(true)}
              disabled={roster.length === 0}
              className="text-[12px] text-red-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              Remove all
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[12px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Inactive agents dialog ──────────────────────────────────────────────────

function InactiveAgentsDialog({ open, onClose, agents, onRemove }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] border border-gray-200 dark:border-gray-700">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">
            Inactive agents
            <span className="ml-2 text-[12px] font-normal text-gray-400 dark:text-gray-500">
              no data in 7+ days
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Agent list */}
        <div className="overflow-y-auto flex-1 px-5 py-1">
          {agents.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-gray-400 dark:text-gray-500">Every agent has logged data in the last 7 days.</p>
          ) : (
            agents.map(a => (
              <div key={a.sfg_id} className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <div>
                  <div className="text-[13px] text-gray-800 dark:text-gray-200">{a.name}</div>
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                    {a.daysSince == null ? 'No data logged in 60+ days' : `${a.daysSince} day${a.daysSince !== 1 ? 's' : ''} since last log`}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(a.sfg_id)}
                  className="text-[12px] text-red-500 hover:text-red-600 font-medium px-2 py-1 transition-colors"
                  title={`Remove ${a.name}`}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 shrink-0 flex items-center justify-end">
          <button
            onClick={onClose}
            className="text-[12px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyRoster() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600 mb-3">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400">No agents on this call yet</p>
      <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">Click "Manage members" to add agents to your call roster.</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountabilityPage() {
  const { permissions, activeSubject } = useViewing()
  const { userProfile, session } = useAuth()
  const token = session?.access_token

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [loading, setLoading]             = useState(true)
  const [rosterError, setRosterError]     = useState(null)
  const [activityError, setActivityError] = useState(null)
  const [roster, setRoster]               = useState([])
  const [allAgents, setAllAgents]         = useState([])
  const [agentMap, setAgentMap]           = useState({})
  const [activity, setActivity]           = useState([])   // 60-day window
  const [sparkActivity, setSparkActivity] = useState([])   // same 60-day, passed as sparkline source
  const [goals, setGoals]                 = useState([])
  const [leadSpend7, setLeadSpend7]           = useState({})   // sfg_id → 7-day lead spend total
  const [monthlyIssuedApv, setMonthlyIssuedApv]   = useState({}) // sfg_id → calendar-month issued APV
  const [monthlyApvGoal,   setMonthlyApvGoal]     = useState({}) // sfg_id → monthly APV goal from activity_goals
  const [expandCount, setExpandCount]     = useState(0)
  const [collapseCount, setCollapseCount] = useState(0)
  const [membersOpen, setMembersOpen]     = useState(false)
  const [inactiveOpen, setInactiveOpen]   = useState(false)

  const rosterSet = useMemo(() => new Set(roster), [roster])

  // ── Inactive agents: roster agents with no activity_logs row in the previous 7 days ──
  const inactiveAgents = useMemo(() => {
    const sevenDaysAgoYMD = toYMD(subDays(today, 7))
    return roster
      .map(id => {
        const agent = agentMap[id]
        if (!agent) return null
        const rows = activity.filter(r => r.sfg_id === id)
        if (rows.some(r => r.date >= sevenDaysAgoYMD)) return null
        const lastDate = rows.reduce((max, r) => (!max || r.date > max) ? r.date : max, null)
        const daysSince = lastDate
          ? Math.round((today - new Date(`${lastDate}T00:00:00`)) / 86400000)
          : null
        return { sfg_id: id, name: agent.preferred_name ?? agent.opt_name ?? '', daysSince }
      })
      .filter(Boolean)
      .sort((a, b) => (b.daysSince ?? 999) - (a.daysSince ?? 999))
  }, [roster, agentMap, activity, today])

  // ── Mount: load roster + all agents ────────────────────────────────────────
  useEffect(() => {
    if (!activeSubject?.sfg_id || !token) return
    load()
  }, [activeSubject?.sfg_id, token])

  async function load() {
    setLoading(true)
    setRosterError(null)
    setActivityError(null)
    try {
      const enc = encodeURIComponent(activeSubject.sfg_id)
      const [rosterRes, agentsRes] = await Promise.all([
        supabase.from('accountability_rosters').select('agent_sfg_id').eq('owner_sfg_id', activeSubject.sfg_id),
        fetch(`/api/personnel?root=${enc}&mode=master&fields=sfg_id,preferred_name,opt_name,status`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
      ])

      if (rosterRes.error) {
        setRosterError(rosterRes.error.message)
        return
      }

      const ids = (rosterRes.data ?? []).map(r => r.agent_sfg_id)
      setRoster(ids)

      const raw = agentsRes.personnel ?? (Array.isArray(agentsRes) ? agentsRes : [])
      const active = raw.filter(a => a.status?.trim().toLowerCase() === 'active')
                        .sort((a, b) => (a.opt_name ?? '').localeCompare(b.opt_name ?? ''))
      setAllAgents(active)

      const map = {}
      for (const a of active) map[a.sfg_id] = a
      setAgentMap(map)

      if (ids.length > 0) await fetchRosterData(ids)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRosterData(ids) {
    setActivityError(null)
    const ownerEnc = encodeURIComponent(activeSubject.sfg_id)
    const idsEnc   = encodeURIComponent(ids.join(','))
    const res = await fetch(
      `/api/accountability-activity?owner_sfg_id=${ownerEnc}&sfg_ids=${idsEnc}&days=60`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json()).error ?? '' } catch { detail = await res.text() }
      console.error('accountability-activity error:', detail)
      setActivityError(`Activity data unavailable (${res.status})${detail ? ': ' + detail : ''}`)
      return
    }
    const { activity: rows, goals: goalRows, leadSpend7: ls7, monthlyIssuedApv: mia, monthlyApvGoal: mag } = await res.json()
    setActivity(rows)
    setSparkActivity(rows)
    setGoals(goalRows)
    setLeadSpend7(ls7 ?? {})
    setMonthlyIssuedApv(mia ?? {})
    setMonthlyApvGoal(mag ?? {})
  }

  // ── Add agent ───────────────────────────────────────────────────────────────
  async function handleAdd(agent) {
    const { error } = await supabase.from('accountability_rosters').insert({
      owner_sfg_id: activeSubject.sfg_id,
      agent_sfg_id: agent.sfg_id,
    })
    if (error) {
      setRosterError(error.message)
      return
    }
    setRoster(prev => [...prev, agent.sfg_id])
    setAgentMap(prev => ({ ...prev, [agent.sfg_id]: agent }))

    const ownerEnc = encodeURIComponent(activeSubject.sfg_id)
    const res = await fetch(
      `/api/accountability-activity?owner_sfg_id=${ownerEnc}&sfg_ids=${encodeURIComponent(agent.sfg_id)}&days=60`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) { console.error('accountability-activity error:', await res.text()); return }
    const { activity: rows, goals: goalRows, leadSpend7: ls7, monthlyIssuedApv: mia, monthlyApvGoal: mag } = await res.json()
    setActivity(prev => [...prev, ...rows])
    setSparkActivity(prev => [...prev, ...rows])
    setGoals(prev => [...prev, ...goalRows])
    setLeadSpend7(prev => ({ ...prev, ...(ls7 ?? {}) }))
    setMonthlyIssuedApv(prev => ({ ...prev, ...(mia ?? {}) }))
    setMonthlyApvGoal(prev => ({ ...prev, ...(mag ?? {}) }))
  }

  // ── Remove agent ───────────────────────────────────────────────────────────
  async function handleRemove(sfgId) {
    setRoster(prev => prev.filter(id => id !== sfgId))
    setActivity(prev => prev.filter(r => r.sfg_id !== sfgId))
    setSparkActivity(prev => prev.filter(r => r.sfg_id !== sfgId))
    setGoals(prev => prev.filter(r => r.sfg_id !== sfgId))
    setLeadSpend7(prev => { const n = { ...prev }; delete n[sfgId]; return n })
    setMonthlyIssuedApv(prev => { const n = { ...prev }; delete n[sfgId]; return n })
    setMonthlyApvGoal(prev => { const n = { ...prev }; delete n[sfgId]; return n })
    supabase.from('accountability_rosters').delete().eq('agent_sfg_id', sfgId).eq('owner_sfg_id', activeSubject.sfg_id).then(() => {})
  }

  // ── Clear all ──────────────────────────────────────────────────────────────
  async function handleClearAll() {
    setRoster([])
    setActivity([])
    setSparkActivity([])
    setGoals([])
    setLeadSpend7({})
    setMonthlyIssuedApv({})
    setMonthlyApvGoal({})
    supabase.from('accountability_rosters').delete().eq('owner_sfg_id', activeSubject.sfg_id).then(() => {})
  }

  const sortedAgents = useMemo(
    () => roster.map(id => agentMap[id]).filter(Boolean).sort((a, b) => (a.preferred_name ?? '').localeCompare(b.preferred_name ?? '')),
    [roster, agentMap],
  )

  if (!permissions?.accountability?.read) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-500">You don't have access to this section.</p>
      </main>
    )
  }

  return (
    <main className="px-6 py-6" style={{ maxWidth: 1440, margin: '0 auto' }}>

      <MembersDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        allAgents={allAgents}
        rosterIds={rosterSet}
        agentMap={agentMap}
        roster={roster}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onClearAll={handleClearAll}
      />

      <InactiveAgentsDialog
        open={inactiveOpen}
        onClose={() => setInactiveOpen(false)}
        agents={inactiveAgents}
        onRemove={handleRemove}
      />

      {/* Page header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-medium text-gray-900 dark:text-white leading-tight">
            Accountability call
          </h1>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
            {fmtHeaderDate(today)}
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => setCollapseCount(c => c + 1)}
            disabled={roster.length === 0}
            className="text-[12px] text-accent hover:underline disabled:opacity-30 disabled:cursor-default"
          >
            Collapse all
          </button>
          <button
            onClick={() => setExpandCount(c => c + 1)}
            disabled={roster.length === 0}
            className="text-[12px] text-accent hover:underline disabled:opacity-30 disabled:cursor-default"
          >
            Expand all
          </button>
        </div>
      </div>

      {/* Error banners */}
      {rosterError && (
        <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-300">
          <strong>Roster error:</strong> {rosterError}. If this is your first time using this page, run the migration SQL in the Supabase dashboard (<code>scripts/migration-accountability-roster.sql</code>).
        </div>
      )}
      {activityError && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-[12px] text-red-700 dark:text-red-300">
          <strong>Activity error:</strong> {activityError}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMembersOpen(true)}
            className="inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700/60 text-[13px] text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
            Manage members
          </button>
          <button
            onClick={() => setInactiveOpen(true)}
            className={`inline-flex items-center gap-2 h-8 px-3 rounded-lg border text-[13px] transition-colors ${
              inactiveAgents.length > 0
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                : 'border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-700/60 text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Inactive agents: {inactiveAgents.length}
          </button>
        </div>
        <span className="text-[12px] text-gray-400 dark:text-gray-300">
          {roster.length} agent{roster.length !== 1 ? 's' : ''} on call
        </span>
      </div>

      {/* Agent list */}
      {loading ? (
        <div className="py-20 text-center text-[12px] text-gray-400 dark:text-gray-500">Loading…</div>
      ) : roster.length === 0 ? (
        <EmptyRoster />
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          {sortedAgents.map(agent => (
            <AgentRow
              key={agent.sfg_id}
              agent={agent}
              activity={activity.filter(r => r.sfg_id === agent.sfg_id)}
              goals={goals.filter(r => r.sfg_id === agent.sfg_id)}
              sparklineActivity={sparkActivity.filter(r => r.sfg_id === agent.sfg_id)}
              today={today}
              leadSpend7={leadSpend7[agent.sfg_id] ?? 0}
              monthlyIssuedApv={monthlyIssuedApv[agent.sfg_id] ?? 0}
              monthlyApvGoal={monthlyApvGoal[agent.sfg_id] ?? null}
              globalExpandCount={expandCount}
              globalCollapseCount={collapseCount}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </main>
  )
}
