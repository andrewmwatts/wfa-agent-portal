import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { supabase } from '../lib/supabaseClient'
import HireMatchingModal from '../components/HireMatchingModal'
import MoreMenu from '../components/ui/MoreMenu'
import { useMinLg, useMinXl } from '../hooks/useMediaQuery'
import useElementWidth from '../hooks/useElementWidth'
import { phoneDigits } from '../utils/format'
import LeadListCard, { REC_TIER_OF } from '../components/leads/LeadListCard'
import { REC_SOURCES, REC_SECTIONS } from '../components/leads/leadFields'
import {
  fmtDateTime,
  isCallbackDue,
  StatusPill,
  ScriptsTab,
  PipelineTab,
  AddLeadModal,
  AddScriptModal,
} from './LeadsPage'

// The lead card and its edit screen load on first use, like on the Leads page
const LeadPanel    = lazy(() => import('../components/leads/LeadPanel'))
const LeadEditView = lazy(() => import('../components/leads/LeadEditView'))


// ─── Recruiting-specific statuses ──────────────────────────────────────────────

export const REC_STATUSES = [
  { key: 'new',                label: 'New',                       pill: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',                 bar: 'bg-blue-500'    },
  { key: 'attempted',          label: 'Attempted Contact',         pill: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:border-fuchsia-500/20', bar: 'bg-fuchsia-500' },
  { key: 'noshow',             label: 'Interview No-Show',         pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',                 bar: 'bg-rose-500'    },
  { key: 'interviewed',        label: 'Interviewed',               pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',           bar: 'bg-amber-500'   },
  { key: 'pre_lic',            label: 'Enrolled in Pre-Licensing', pill: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',                       bar: 'bg-sky-500'     },
  { key: 'pre_lic_done',       label: 'Pre-Licensing Complete',    pill: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-500/20',                 bar: 'bg-cyan-500'    },
  { key: 'exam_done',          label: 'Exam Complete',             pill: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',     bar: 'bg-violet-500'  },
  { key: 'licensed',           label: 'Licensed',                  pill: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20',                 bar: 'bg-teal-500'    },
  { key: 'app_sent',           label: 'Application Sent',          pill: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20',     bar: 'bg-orange-500'  },
  { key: 'app_submitted',      label: 'Application Submitted',     pill: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20',     bar: 'bg-indigo-500'  },
  { key: 'hired',              label: 'Hired',                     pill: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',           bar: 'bg-green-500'   },
  { key: 'fully_contracted',   label: 'Fully Contracted',          pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20', bar: 'bg-emerald-600' },
  { key: 'dead',               label: 'Not Interested / Dead',     pill: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/40 dark:border-white/10',                       bar: 'bg-gray-400'    },
]

// Workflow sort order — most advanced at top, Dead always last
const REC_STATUS_ORDER = [
  'fully_contracted', 'hired', 'app_submitted', 'app_sent',
  'licensed', 'exam_done', 'pre_lic_done', 'pre_lic',
  'interviewed', 'noshow', 'attempted', 'new', 'dead',
]

const TABS = [
  { key: 'leads',          label: 'Leads'          },
  { key: 'callbacks',      label: 'Callbacks'      },
  { key: 'scripts',        label: 'Scripts'        },
  { key: 'pipeline',       label: 'Pipeline'       },
  { key: 'unlinked_hires', label: 'Unlinked Hires' },
]

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function RecruitingPage() {
  const { session } = useAuth()
  const { activeSubject, permissions } = useViewing()

  function authHeaders(extra) {
    const h = { 'Content-Type': 'application/json', ...extra }
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
    return h
  }

  const [tab,          setTab]          = useState('leads')
  const [leads,        setLeads]        = useState([])
  const [scripts,      setScripts]      = useState([])
  const [loading,      setLoading]      = useState(false)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [hideTerminal, setHideTerminal] = useState(false)
  const [showSetup,    setShowSetup]    = useState(false)

  // Detail panel
  const [selected,     setSelected]     = useState(null)
  const [activity,     setActivity]     = useState([])
  const [actLoading,   setActLoading]   = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [attemptError, setAttemptError] = useState('')
  const [editOpen,     setEditOpen]     = useState(false)   // the Edit lead data screen

  // The lead opens in a pane on the right: full screen on phones, a 640px docked pane at 1024–1279px
  // (Edit lead data then opens inside it), 520px from 1280px. The header, search and cards switch to
  // their compact forms according to the room the page and the list actually have.
  const isMinLg = useMinLg()
  const isMinXl = useMinXl()
  const docked  = isMinLg && !isMinXl
  const [pageEl, setPageEl] = useState(null)
  const [listEl, setListEl] = useState(null)
  const pageWidth    = useElementWidth(pageEl)
  const listWidth    = useElementWidth(listEl)
  const compactList  = pageWidth > 0 ? pageWidth < 640 : (!isMinLg || (docked && !!selected))
  const stackedCards = listWidth > 0 && listWidth < 460

  // Modals
  const [showAddLead,   setShowAddLead]   = useState(false)
  const [showAddScript, setShowAddScript] = useState(false)

  // Unlinked hires tab
  const [unlinkedHires,        setUnlinkedHires]        = useState([])
  const [unlinkedLoading,      setUnlinkedLoading]      = useState(false)
  const [unlinkedLoaded,       setUnlinkedLoaded]       = useState(false)
  const [matchingHires,        setMatchingHires]        = useState(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const sfgId = activeSubject?.sfg_id

  const loadLeads = useCallback(async () => {
    if (!sfgId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/leads?sfg_id=${encodeURIComponent(sfgId)}&category=recruiting&include=scripts`,
        { headers: authHeaders() },
      )
      if (res.ok) {
        const { leads: d, scripts: s } = await res.json()
        setLeads(d ?? [])
        setScripts(s ?? [])
      }
    } finally { setLoading(false) }
  }, [sfgId])

  useEffect(() => { loadLeads() }, [loadLeads])
  useEffect(() => {
    if (tab === 'unlinked_hires' && !unlinkedLoaded) loadUnlinkedHires()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadUnlinkedHires() {
    if (!sfgId || unlinkedLoading) return
    setUnlinkedLoading(true)
    try {
      const res = await fetch(
        `/api/leads?action=unlinked_hires&sfg_id=${encodeURIComponent(sfgId)}`,
        { headers: authHeaders() },
      )
      if (res.ok) {
        const { unlinked } = await res.json()
        setUnlinkedHires(unlinked ?? [])
        setUnlinkedLoaded(true)
      }
    } finally { setUnlinkedLoading(false) }
  }

  async function openLead(lead) {
    setSelected(lead)
    setEditOpen(false)
    setAttemptError('')
    setActLoading(true)
    try {
      const res = await fetch(`/api/leads?resource=activity&lead_id=${lead.id}`, { headers: authHeaders() })
      if (res.ok) { const { activity: d } = await res.json(); setActivity(d) }
    } finally { setActLoading(false) }
  }

  function closeDetail() { setSelected(null); setActivity([]); setEditOpen(false) }

  // ── Lead mutations ─────────────────────────────────────────────────────────

  function patchLeadLocal(id, updates) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    setSelected(prev => prev?.id === id ? { ...prev, ...updates } : prev)
  }

  function prependActivity(entry) { setActivity(prev => [entry, ...prev]) }

  // "Log call" / "Log text": one history entry and +1 on the lead's attempt totals. Dialing and
  // texting are plain links in the card — they don't log on their own. Status is never changed here.
  async function logAttempt(type) {
    if (!selected) return null
    setAttemptError('')
    const leadId = selected.id
    const now    = new Date()
    const today  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const body   = type === 'call' ? '📞 Call attempt logged' : '💬 Text attempt logged'
    const update = { last_contact: today }

    let res
    try {
      res = await fetch('/api/leads?resource=activity', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ lead_id: leadId, sfg_id: sfgId, activity_type: type, body, update_lead: update, count_attempt: true }),
      })
    } catch { res = null }
    if (!res?.ok) { setAttemptError('Couldn’t log that attempt. Check your connection and try again.'); return null }

    const { entry, attempt, last_dispositioned_at, lead_update_error } = await res.json()
    prependActivity(entry)
    if (lead_update_error) {
      setAttemptError('The attempt is in the history, but the counters didn’t update. Make sure the latest database migration has been run.')
      return entry
    }
    patchLeadLocal(leadId, {
      ...update, ...attempt,
      last_activity_text: body, last_activity_at: entry.created_at,
      ...(last_dispositioned_at ? { last_dispositioned_at } : {}),
    })
    return entry
  }

  // Attach (or edit) a note on one call/text attempt in the history
  async function saveAttemptNote(activityId, note) {
    try {
      const res = await fetch(`/api/leads?resource=activity&id=${activityId}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ note }),
      })
      if (!res.ok) return false
      const { entry } = await res.json()
      setActivity(prev => prev.map(a => a.id === activityId ? entry : a))
      return true
    } catch { return false }
  }

  async function updateStatus(newStatus) {
    if (!selected) return
    setStatusSaving(true)
    const cfg  = REC_STATUSES.find(s => s.key === newStatus)
    const body = `🔄 Status → ${cfg?.label ?? newStatus}`
    const res = await fetch('/api/leads?resource=activity', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ lead_id: selected.id, sfg_id: sfgId, activity_type: 'status', body, update_lead: { status: newStatus } }),
    })
    if (res.ok) {
      const { entry } = await res.json()
      prependActivity(entry)
      patchLeadLocal(selected.id, { status: newStatus, last_dispositioned_at: entry.created_at, last_activity_text: body, last_activity_at: entry.created_at })
    }
    setStatusSaving(false)
  }

  // Saves one field of the open lead. Resolves true when it was stored. Phone numbers are stored
  // as bare digits and shown hyphenated.
  async function patchLeadField(field, value) {
    if (!selected) return false
    if (field === 'phone' && value) value = phoneDigits(value)
    const prev = selected[field]
    patchLeadLocal(selected.id, { [field]: value })
    try {
      const res = await fetch(`/api/leads?id=${selected.id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) { patchLeadLocal(selected.id, { [field]: prev }); return false }
      return true
    } catch { patchLeadLocal(selected.id, { [field]: prev }); return false }
  }

  async function saveCallback(val) {
    if (!selected) return
    const patch = { callback_at: val || null }
    await fetch(`/api/leads?id=${selected.id}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify(patch),
    })
    if (val) {
      const body = `📅 Callback scheduled: ${fmtDateTime(val)}`
      const res = await fetch('/api/leads?resource=activity', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ lead_id: selected.id, sfg_id: sfgId, activity_type: 'callback', body }),
      })
      if (res.ok) { const { entry } = await res.json(); prependActivity(entry) }
    }
    patchLeadLocal(selected.id, patch)
  }

  async function patchLeadStatus(leadId, newStatus) {
    const cfg  = REC_STATUSES.find(s => s.key === newStatus)
    const body = `🔄 Status → ${cfg?.label ?? newStatus}`
    const res = await fetch('/api/leads?resource=activity', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ lead_id: leadId, sfg_id: sfgId, activity_type: 'status', body, update_lead: { status: newStatus } }),
    })
    if (res.ok) {
      const { entry } = await res.json()
      patchLeadLocal(leadId, { status: newStatus, last_dispositioned_at: entry.created_at, last_activity_text: body, last_activity_at: entry.created_at })
    }
  }

  async function handleAddLead(formData) {
    const res = await fetch('/api/leads', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ sfg_id: sfgId, category: 'recruiting', ...formData, ...(formData.phone ? { phone: phoneDigits(formData.phone) } : {}) }),
    })
    if (res.ok) {
      const { lead } = await res.json()
      setLeads(prev => [lead, ...prev])
      setShowAddLead(false)
    }
    return res
  }

  async function handleAddScript(data) {
    const res = await fetch('/api/leads?resource=scripts', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ sfg_id: sfgId, ...data }),
    })
    if (res.ok) {
      const { script } = await res.json()
      setScripts(prev => [...prev, script])
      setShowAddScript(false)
    }
    return res
  }

  async function handleDeleteScript(id) {
    await fetch(`/api/leads?resource=scripts&id=${id}`, { method: 'DELETE', headers: authHeaders() })
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  // ── Filtered / sorted leads ────────────────────────────────────────────────

  const displayLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = leads.filter(l => {
      const matchQ = !q
        || l.name.toLowerCase().includes(q)
        || (l.phone || '').includes(q)
        || (q.replace(/\D/g, '').length >= 3 && phoneDigits(l.phone).includes(q.replace(/\D/g, '')))
        || (l.state || '').toLowerCase() === q
        || (l.email || '').toLowerCase().includes(q)
      if (!matchQ) return false
      if (statusFilter !== 'all' && l.status !== statusFilter) return false
      if (sourceFilter !== 'all' && (l.source || '') !== sourceFilter) return false
      if (hideTerminal && (l.status === 'hired' || l.status === 'fully_contracted' || l.status === 'dead')) return false
      return true
    })
    list.sort((a, b) => {
      const aIdx = REC_STATUS_ORDER.indexOf(a.status)
      const bIdx = REC_STATUS_ORDER.indexOf(b.status)
      const aOrd = aIdx === -1 ? REC_STATUS_ORDER.length - 1 : aIdx
      const bOrd = bIdx === -1 ? REC_STATUS_ORDER.length - 1 : bIdx
      if (aOrd !== bOrd) return aOrd - bOrd
      // Within same status, newest first
      return (b.added || '').localeCompare(a.added || '') || (b.id - a.id)
    })
    return list
  }, [leads, search, statusFilter, sourceFilter, hideTerminal])

  const callbackLeads = useMemo(() => (
    leads.filter(l => l.callback_at).sort((a, b) => new Date(a.callback_at) - new Date(b.callback_at))
  ), [leads])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!permissions.recruiting.read) return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view recruiting leads.</p>
      </div>
    )
  }

  // Room kept for the lead pane so the header, tabs and list are never hidden under it
  // (a docked 640px pane at 1024–1279px, 520px from 1280px up).
  const paneMr = selected ? 'lg:mr-[640px] xl:mr-[520px]' : ''

  return (
    <div ref={setPageEl} className={`flex flex-col h-full transition-[margin] duration-300 ${paneMr}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex-1">Recruiting</h1>
        {compactList ? (
          <MoreMenu items={[{ label: '⚙️ Setup', onClick: () => setShowSetup(true) }]} />
        ) : (
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 touch:min-h-11 rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            ⚙️ Setup
          </button>
        )}
        <button
          onClick={() => setShowAddLead(true)}
          className="flex items-center gap-1.5 text-sm px-4 py-1.5 h-11 sm:h-auto touch:sm:h-11 rounded-xl sm:rounded-lg border border-accent bg-primary text-white dark:bg-white dark:text-primary font-semibold hover:bg-primary/85 dark:hover:bg-white/90 transition-colors whitespace-nowrap"
        >
          <span className="text-base leading-none">+</span> {compactList ? 'Add' : 'Add Lead'}
        </button>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 dark:border-white/10 px-4 sm:px-6 shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 sm:px-4 py-2.5 min-h-11 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-accent text-gray-900 dark:text-white'
                : 'border-transparent text-gray-500 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/80'
            }`}
          >
            {t.label}
            {t.key === 'callbacks' && callbackLeads.length > 0 && (
              <span className="ml-1.5 text-xs border border-accent bg-primary text-white dark:bg-white dark:text-primary rounded-full px-1.5 py-0.5 font-bold">
                {callbackLeads.filter(l => isCallbackDue(l)).length || ''}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* List area */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Leads tab ─────────────────────────────────────────────────── */}
          {tab === 'leads' && (
            <div className="px-4 sm:px-6 py-4">

              {/* Search */}
              <div className="flex gap-2 mb-3">
                <div className={`flex-1 min-w-0 flex items-center gap-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/15 px-3 ${compactList ? 'h-12 rounded-xl' : 'py-1.5 rounded-lg touch:h-11'}`}>
                  <svg className="w-3.5 h-3.5 text-gray-500 dark:text-white/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search name, phone, state…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-white/50 outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} aria-label="Clear search" className="w-8 h-8 -mr-2 flex items-center justify-center text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70 text-sm leading-none">✕</button>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className={compactList
                ? 'flex flex-nowrap items-center gap-x-2 overflow-x-auto -mx-4 px-4 pb-1 mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'flex flex-wrap items-center gap-x-3 gap-y-2 mb-4'}>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className={`shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors cursor-pointer focus:outline-none ${
                    statusFilter !== 'all'
                      ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                      : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 bg-transparent hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  <option value="all">All Statuses</option>
                  {REC_STATUSES.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  className={`shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors cursor-pointer focus:outline-none ${
                    sourceFilter !== 'all'
                      ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                      : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 bg-transparent hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  <option value="all">All Sources</option>
                  {REC_SOURCES.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => setHideTerminal(h => !h)}
                  className={`whitespace-nowrap shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors ${
                    hideTerminal
                      ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                      : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 bg-transparent hover:border-gray-300 dark:hover:border-white/20'
                  }`}
                >
                  Hide Hired / Contracted / Dead
                </button>
                {(statusFilter !== 'all' || sourceFilter !== 'all') && (
                  <button
                    onClick={() => { setStatusFilter('all'); setSourceFilter('all') }}
                    className="whitespace-nowrap text-xs font-medium px-3 py-1 rounded-full border border-gray-200 dark:border-white/10 text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 hover:border-gray-300 dark:hover:border-white/20 transition-colors"
                  >
                    Show All ✕
                  </button>
                )}
              </div>

              {/* Lead count */}
              <p className="text-sm text-gray-600 dark:text-white/60 mb-3 font-medium">
                {displayLeads.length} lead{displayLeads.length !== 1 ? 's' : ''}
                {(statusFilter !== 'all' || sourceFilter !== 'all' || hideTerminal || search) ? ' (filtered)' : ''}
              </p>

              {loading ? (
                <div className="space-y-3 animate-pulse">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-24 bg-gray-100 dark:bg-white/5 rounded-xl" />
                  ))}
                </div>
              ) : displayLeads.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-white/30">
                  <p className="text-3xl mb-3">🔍</p>
                  <p className="text-sm">No recruiting leads found</p>
                </div>
              ) : (
                <div ref={setListEl} className="space-y-3">
                  {displayLeads.map(l => (
                    <LeadListCard key={l.id} lead={l} onClick={openLead} selected={selected?.id === l.id} statuses={REC_STATUSES} tierOf={REC_TIER_OF} recruiting stacked={stackedCards} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Callbacks tab ─────────────────────────────────────────────── */}
          {tab === 'callbacks' && (
            <div className="px-4 sm:px-6 py-4">
              <p className="text-xs text-gray-400 dark:text-white/30 mb-4 font-medium">
                {callbackLeads.length} scheduled callback{callbackLeads.length !== 1 ? 's' : ''}
              </p>
              {callbackLeads.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-white/30">
                  <p className="text-3xl mb-3">📅</p>
                  <p className="text-sm">No callbacks scheduled</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {callbackLeads.map(l => {
                    const cb      = new Date(l.callback_at)
                    const now     = new Date()
                    const overdue = cb < now
                    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59)
                    const isToday  = cb <= todayEnd && cb >= new Date().setHours(0, 0, 0, 0)
                    return (
                      <div
                        key={l.id}
                        onClick={() => openLead(l)}
                        className="flex items-center gap-3 bg-white dark:bg-primary/30 border border-primary/15 dark:border-white/10 rounded-xl px-4 py-3 cursor-pointer hover:border-accent/30 transition-colors"
                      >
                        <div className={`text-xs font-bold px-2 py-1 rounded-lg border ${
                          overdue  ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                          : isToday ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20'
                          : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20'
                        }`}>
                          {overdue ? 'Overdue' : isToday ? 'Today' : 'Upcoming'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{l.name}</p>
                          <p className="text-xs text-gray-400 dark:text-white/40">{fmtDateTime(l.callback_at)}</p>
                        </div>
                        <StatusPill status={l.status} statuses={REC_STATUSES} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Scripts tab ───────────────────────────────────────────────── */}
          {tab === 'scripts' && (
            <ScriptsTab scripts={scripts} onAdd={() => setShowAddScript(true)} onDelete={handleDeleteScript} />
          )}

          {/* ── Pipeline tab ──────────────────────────────────────────────── */}
          {tab === 'pipeline' && (
            <PipelineTab
              leads={leads}
              statuses={REC_STATUSES}
              onOpenLead={openLead}
              onStatusChange={patchLeadStatus}
            />
          )}

          {/* ── Unlinked Hires tab ────────────────────────────────────────── */}
          {tab === 'unlinked_hires' && (
            <div className="px-4 sm:px-6 py-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-gray-400 dark:text-white/30 font-medium">
                  {unlinkedLoading ? 'Loading…' : `${unlinkedHires.length} unlinked hire${unlinkedHires.length !== 1 ? 's' : ''} in your direct downline`}
                </p>
                <button
                  onClick={loadUnlinkedHires}
                  disabled={unlinkedLoading}
                  className="text-xs text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                >
                  ↺ Refresh
                </button>
              </div>

              {unlinkedLoading ? (
                <div className="space-y-3 animate-pulse">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-100 dark:bg-white/5 rounded-xl" />)}
                </div>
              ) : unlinkedHires.length === 0 ? (
                <div className="text-center py-16 text-gray-400 dark:text-white/30">
                  <p className="text-3xl mb-3">✓</p>
                  <p className="text-sm">All hires are linked to recruiting leads</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {unlinkedHires.map(p => (
                    <div key={p.sfg_id} className="flex items-center gap-3 bg-white dark:bg-primary/30 border border-primary/15 dark:border-white/10 rounded-xl px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.preferred_name || p.sfg_id}</p>
                        <p className="text-xs text-gray-400 dark:text-white/40">
                          {p.hire_date ? `Hired ${p.hire_date}` : 'No hire date'} · {p.sfg_id}
                        </p>
                      </div>
                      <button
                        onClick={() => setMatchingHires([p])}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent/10 transition-colors whitespace-nowrap"
                      >
                        Link →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Lead detail drawer ────────────────────────────────────────── */}
        {selected && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={closeDetail}
          />
        )}
        <div className={`fixed top-[var(--header-h)] right-0 bottom-0 z-30 w-full lg:w-[640px] xl:w-[520px] max-lg:pb-[env(safe-area-inset-bottom)] bg-white dark:bg-secondary border-l border-gray-200 dark:border-white/10 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
          {selected && (
            <Suspense fallback={<div className="flex-1 animate-pulse bg-gray-50 dark:bg-black/20" />}>
              <LeadPanel
                recruiting
                lead={selected}
                activity={activity}
                actLoading={actLoading}
                statuses={REC_STATUSES}
                statusSaving={statusSaving}
                attemptError={attemptError}
                onClose={closeDetail}
                onLogAttempt={logAttempt}
                onAttemptNote={saveAttemptNote}
                onStatusChange={updateStatus}
                onCallbackChange={saveCallback}
                onPatch={patchLeadField}
                onEdit={() => setEditOpen(true)}
                overrideBody={docked && editOpen ? (
                  <Suspense fallback={<div className="flex-1 animate-pulse bg-gray-50 dark:bg-black/20" />}>
                    <LeadEditView
                      pane
                      key={selected.id}
                      lead={selected}
                      sections={REC_SECTIONS}
                      badge="REC"
                      onClose={() => setEditOpen(false)}
                      onPatch={patchLeadField}
                    />
                  </Suspense>
                ) : null}
              />
            </Suspense>
          )}
        </div>

        {/* Edit lead data — full screen over the page (inside the lead pane when docked) */}
        {selected && editOpen && !docked && (
          <Suspense fallback={<div className="fixed top-[var(--header-h)] right-0 bottom-0 left-0 lg:left-[var(--nav-w,4rem)] xl:left-[var(--nav-w,14rem)] z-40 bg-gray-50 dark:bg-secondary" />}>
            <LeadEditView
              key={selected.id}
              lead={selected}
              sections={REC_SECTIONS}
              badge="REC"
              onClose={() => setEditOpen(false)}
              onPatch={patchLeadField}
            />
          </Suspense>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showAddLead && (
        <AddLeadModal onClose={() => setShowAddLead(false)} onSave={handleAddLead} />
      )}
      {showAddScript && (
        <AddScriptModal onClose={() => setShowAddScript(false)} onSave={handleAddScript} />
      )}
      {showSetup && (
        <RecruitingSetupModal
          onClose={() => setShowSetup(false)}
          userId={activeSubject?.id}
          authHeaders={authHeaders}
        />
      )}
      {matchingHires && (
        <HireMatchingModal
          newHires={matchingHires}
          authHeaders={authHeaders}
          onClose={() => { setMatchingHires(null); setUnlinkedLoaded(false) }}
        />
      )}
    </div>
  )
}

// ─── Recruiting Setup Modal ────────────────────────────────────────────────────

function RecruitingSetupModal({ onClose, userId, authHeaders }) {
  const [email,  setEmail]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [step,   setStep]   = useState(null)   // null = loading

  useEffect(() => {
    if (!userId) { setStep('capture'); return }
    supabase.from('users').select('recruiting_email').eq('id', userId).single()
      .then(({ data }) => {
        const e = data?.recruiting_email?.trim() || ''
        setEmail(e)
        setStep(e ? 'setup' : 'capture')
      })
  }, [userId])

  async function handleSaveEmail() {
    if (!email.trim()) { setError('Please enter an email address'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/user-settings', {
        method: 'PUT',
        headers: authHeaders ? authHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, field: 'recruiting_email', value: email.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to save')
      }
      setStep('setup')
    } catch (err) {
      setError(err.message || 'Failed to save email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Recruiting Setup</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-5">

          {/* Loading */}
          {step === null && (
            <p className="text-sm text-gray-400 dark:text-white/30 text-center py-4">Loading…</p>
          )}

          {/* Step 1: capture email */}
          {step === 'capture' && (
            <>
              <p className="text-sm text-gray-700 dark:text-white/80">
                What email address will you be receiving your recruiting leads to?
              </p>
              <div>
                <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">Recruiting Inbox Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveEmail()}
                  placeholder="you@example.com"
                  autoFocus
                  className={INPUT_CLS}
                />
              </div>
              {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
            </>
          )}

          {/* Step 2: setup instructions */}
          {step === 'setup' && (
            <>
              {/* Editable email */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">Recruiting Inbox Email</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError('') }}
                    className={INPUT_CLS + ' flex-1'}
                  />
                  <button
                    onClick={handleSaveEmail}
                    disabled={saving}
                    className="text-sm px-4 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {saving ? 'Saving…' : 'Update'}
                  </button>
                </div>
                {error && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>}
              </div>

              <hr className="border-gray-100 dark:border-white/10" />

              {/* Instructions */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">
                  How to Set Up Automatic Recruiting Lead Import
                </p>
                <div className="space-y-4 text-sm text-gray-600 dark:text-white/60 leading-relaxed">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white/80 mb-1">Forward leads to the import mailbox</p>
                    <p className="mb-2">Set up a rule for any recruiting leads you are receiving. You will need a separate rule for each lead type. For each one, set any incoming emails to forward automatically to <span className="font-medium text-gray-700 dark:text-white/70">leads@wattsfamilyagency.com</span>.</p>
                    <div>
                      <p className="font-medium text-gray-700 dark:text-white/70 mb-1">Current accepted sources:</p>
                      <div className="space-y-0.5 pl-3 border-l-2 border-gray-200 dark:border-white/10">
                        <p>Calendly</p>
                        <p>Stan Store</p>
                      </div>
                    </div>
                    <p className="mt-2">For additional notification emails to be added to the automatic uploader, forward a copy of the email to <span className="font-medium text-gray-700 dark:text-white/70">andrew@wattsfamilyagency.com</span>. The emails need to have a consistent format. If there are variations, send one example of each.</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3">
                    <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">💡 Note</p>
                    <p className="text-amber-700 dark:text-amber-300/80">If you change the address your recruiting leads are being sent to you will need to enter the new address above.</p>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex justify-between shrink-0">
          {step === 'capture' ? (
            <>
              <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSaveEmail}
                disabled={saving || !email.trim()}
                className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="ml-auto text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
