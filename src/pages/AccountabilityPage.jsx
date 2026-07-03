import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth }    from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import AgentRow from '../components/accountability/AgentRow'
import { toYMD, subDays, subWeeks, getCollapsedPeriod } from '../components/accountability/utils/accountabilityCalc'

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtHeaderDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// ── Search input ──────────────────────────────────────────────────────────────

function AgentSearchInput({ allAgents, rosterIds, onAdd }) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlight] = useState(0)
  const [results, setResults]       = useState([])
  const debounceRef = useRef(null)
  const inputRef    = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) { setResults([]); return }
      const q = query.toLowerCase()
      setResults(
        allAgents
          .filter(a => !rosterIds.has(a.sfg_id) && `${a.first_name} ${a.last_name}`.toLowerCase().includes(q))
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
    <div className="relative">
      <div className="flex items-center gap-2 h-8 px-3 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Add agent to call…"
          className="flex-1 bg-transparent text-[13px] text-gray-800 dark:text-white placeholder-gray-400 outline-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-9 left-0 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 overflow-hidden">
          {results.map((agent, i) => (
            <button
              key={agent.sfg_id}
              onMouseDown={() => pick(agent)}
              className={`w-full text-left px-3 py-2 flex items-center gap-1.5 transition-colors ${i === highlighted ? 'bg-gray-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
            >
              <span className="text-[13px] text-gray-800 dark:text-white">{agent.first_name} {agent.last_name}</span>
              {agent.team && <span className="text-[11px] text-gray-400 dark:text-gray-500">· {agent.team}</span>}
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && results.length === 0 && (
        <div className="absolute top-9 left-0 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-30 px-3 py-2.5">
          <span className="text-[12px] text-gray-400 dark:text-gray-500">No agents found</span>
        </div>
      )}
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
      <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-1">Search above to add agents to your call roster.</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountabilityPage() {
  const { permissions, activeSubject } = useViewing()
  const { userProfile } = useAuth()

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [loading, setLoading]               = useState(true)
  const [roster, setRoster]                 = useState([])     // sfg_id[]
  const [allAgents, setAllAgents]           = useState([])     // all active personnel (for search)
  const [agentMap, setAgentMap]             = useState({})     // sfg_id → personnel row
  const [activity, setActivity]             = useState([])     // 14-day window
  const [sparkActivity, setSparkActivity]   = useState([])     // 5-week window
  const [goals, setGoals]                   = useState([])
  const [expandCount, setExpandCount]       = useState(0)
  const [clearState, setClearState]         = useState('idle') // 'idle' | 'confirm'

  const rosterSet = useMemo(() => new Set(roster), [roster])

  // ── Mount: load roster + all agents ────────────────────────────────────────
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    load()
  }, [activeSubject?.sfg_id])

  async function load() {
    setLoading(true)
    try {
      const [rosterRes, agentsRes] = await Promise.all([
        supabase.from('accountability_rosters').select('agent_sfg_id').eq('owner_sfg_id', activeSubject.sfg_id),
        supabase.from('personnel').select('sfg_id, first_name, last_name, team').eq('status', 'Active').order('last_name'),
      ])
      const ids = (rosterRes.data ?? []).map(r => r.agent_sfg_id)
      setRoster(ids)
      setAllAgents(agentsRes.data ?? [])
      if (ids.length > 0) await fetchRosterData(ids)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRosterData(ids) {
    const yesterday = toYMD(subDays(today, 1))
    const start14   = toYMD(subDays(today, 14))
    const start35   = toYMD(subWeeks(today, 5))

    const [actRes, sparkRes, goalsRes, personnelRes] = await Promise.all([
      supabase.from('activity_tracking')
        .select('sfg_id, date, dials, contacts, appts_set, appts_run, apps_submitted, apv_submitted, lead_spend')
        .in('sfg_id', ids).gte('date', start14).lte('date', yesterday),
      supabase.from('activity_tracking')
        .select('sfg_id, date, appts_run, apv_submitted')
        .in('sfg_id', ids).gte('date', start35),
      supabase.from('agent_goals')
        .select('sfg_id, goal_type, goal_value, effective_date')
        .in('sfg_id', ids).order('effective_date', { ascending: false }),
      supabase.from('personnel')
        .select('sfg_id, first_name, last_name, team')
        .in('sfg_id', ids).eq('status', 'Active'),
    ])

    setActivity(actRes.data ?? [])
    setSparkActivity(sparkRes.data ?? [])
    setGoals(goalsRes.data ?? [])
    const map = {}
    for (const a of (personnelRes.data ?? [])) map[a.sfg_id] = a
    setAgentMap(map)
  }

  // ── Add agent ───────────────────────────────────────────────────────────────
  async function handleAdd(agent) {
    await supabase.from('accountability_rosters').insert({
      owner_sfg_id: activeSubject.sfg_id,
      agent_sfg_id: agent.sfg_id,
    })
    setRoster(prev => [...prev, agent.sfg_id])
    setAgentMap(prev => ({ ...prev, [agent.sfg_id]: agent }))

    const yesterday = toYMD(subDays(today, 1))
    const start14   = toYMD(subDays(today, 14))
    const start35   = toYMD(subWeeks(today, 5))
    const [actRes, sparkRes, goalsRes] = await Promise.all([
      supabase.from('activity_tracking')
        .select('sfg_id, date, dials, contacts, appts_set, appts_run, apps_submitted, apv_submitted, lead_spend')
        .eq('sfg_id', agent.sfg_id).gte('date', start14).lte('date', yesterday),
      supabase.from('activity_tracking')
        .select('sfg_id, date, appts_run, apv_submitted')
        .eq('sfg_id', agent.sfg_id).gte('date', start35),
      supabase.from('agent_goals')
        .select('sfg_id, goal_type, goal_value, effective_date')
        .eq('sfg_id', agent.sfg_id).order('effective_date', { ascending: false }),
    ])
    setActivity(prev => [...prev, ...(actRes.data ?? [])])
    setSparkActivity(prev => [...prev, ...(sparkRes.data ?? [])])
    setGoals(prev => [...prev, ...(goalsRes.data ?? [])])
  }

  // ── Remove agent ───────────────────────────────────────────────────────────
  async function handleRemove(sfgId) {
    setRoster(prev => prev.filter(id => id !== sfgId))
    setActivity(prev => prev.filter(r => r.sfg_id !== sfgId))
    setSparkActivity(prev => prev.filter(r => r.sfg_id !== sfgId))
    setGoals(prev => prev.filter(r => r.sfg_id !== sfgId))
    supabase.from('accountability_rosters').delete().eq('agent_sfg_id', sfgId).then(() => {})
  }

  // ── Clear all ──────────────────────────────────────────────────────────────
  async function handleClearAll() {
    setRoster([])
    setActivity([])
    setSparkActivity([])
    setGoals([])
    setAgentMap({})
    setClearState('idle')
    supabase.from('accountability_rosters').delete().eq('owner_sfg_id', activeSubject.sfg_id).then(() => {})
  }

  const sortedAgents = useMemo(
    () => roster.map(id => agentMap[id]).filter(Boolean).sort((a, b) => a.last_name.localeCompare(b.last_name)),
    [roster, agentMap],
  )

  const { label: periodLabel } = useMemo(() => getCollapsedPeriod(today), [today])

  if (!permissions?.accountability?.read) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-500">You don't have access to this section.</p>
      </main>
    )
  }

  return (
    <main className="px-6 py-6" style={{ maxWidth: 1440, margin: '0 auto' }}>

      {/* Page header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-medium text-gray-900 dark:text-white leading-tight">
            Accountability call
          </h1>
          <p className="text-[12px] text-gray-400 dark:text-gray-500 mt-0.5">
            {fmtHeaderDate(today)} · {roster.length} agent{roster.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[12px] text-gray-400 dark:text-gray-500">
            Collapsed: {periodLabel.replace(':', '')}
          </span>
          <button
            onClick={() => setExpandCount(c => c + 1)}
            className="text-[12px] text-primary hover:underline"
          >
            Expand all
          </button>
        </div>
      </div>

      {/* Roster toolbar */}
      <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800 mb-4">
        <AgentSearchInput allAgents={allAgents} rosterIds={rosterSet} onAdd={handleAdd} />
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-gray-400 dark:text-gray-500">
            {roster.length} agent{roster.length !== 1 ? 's' : ''} on call
          </span>

          {clearState === 'idle' ? (
            <button
              onClick={() => setClearState('confirm')}
              disabled={roster.length === 0}
              className="text-[12px] text-red-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-default"
            >
              Clear all
            </button>
          ) : (
            <span className="flex items-center gap-2 text-[12px]">
              <span className="text-gray-500 dark:text-gray-400">Confirm clear?</span>
              <button onClick={handleClearAll} className="text-red-500 font-medium hover:text-red-600">Yes</button>
              <button onClick={() => setClearState('idle')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Cancel</button>
            </span>
          )}
        </div>
      </div>

      {/* Agent list */}
      {loading ? (
        <div className="py-20 text-center text-[12px] text-gray-400 dark:text-gray-500">Loading…</div>
      ) : roster.length === 0 ? (
        <EmptyRoster />
      ) : (
        <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
          {sortedAgents.map(agent => (
            <AgentRow
              key={agent.sfg_id}
              agent={agent}
              activity={activity.filter(r => r.sfg_id === agent.sfg_id)}
              goals={goals.filter(r => r.sfg_id === agent.sfg_id)}
              sparklineActivity={sparkActivity.filter(r => r.sfg_id === agent.sfg_id)}
              today={today}
              globalExpandCount={expandCount}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </main>
  )
}
