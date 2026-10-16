import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { supabase } from '../lib/supabaseClient'
import BulkLeadImportModal from '../components/BulkLeadImportModal'
import LeadListCard from '../components/leads/LeadListCard'
import { SOURCE_DISPLAY, typeCfg, getLeadTZ } from '../components/leads/leadHelpers'
import CalendarEventModal from '../components/CalendarEventModal'
import { fmtDate, fmtDateTime } from '../utils/format'
import { useMinSm, useMinLg, useMinXl } from '../hooks/useMediaQuery'
import MoreMenu from '../components/ui/MoreMenu'
import PaneTabs from '../components/leads/PaneTabs'
// Re-exported for RecruitingPage, which imports it from this module
export { fmtDateTime }

// The pane carries the full script text, so it loads on first open rather than
// riding in the main bundle (which sits close to the PWA precache size limit).
const ScriptPane = lazy(() => import('../components/ScriptPane'))
// The CQF screen (form + config) is only needed once an agent opens it, so it loads on demand too.
const CqfView = lazy(() => import('../components/leads/CqfView'))
// Same for the lead card panel — the list renders without it.
const LeadPanel = lazy(() => import('../components/leads/LeadPanel'))

// ─── Status config ─────────────────────────────────────────────────────────────

export const STATUSES = [
  { key: 'new',       label: 'New',                   pill: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',             bar: 'bg-blue-500'    },
  { key: 'attempted', label: 'Attempted Contact',     pill: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20', bar: 'bg-orange-500'  },
  { key: 'callback',  label: 'Call Back Scheduled',   pill: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',                   bar: 'bg-sky-500'     },
  { key: 'contacted', label: 'Contacted',             pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',       bar: 'bg-amber-500'   },
  { key: 'appt',      label: 'Appointment Set',       pill: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20', bar: 'bg-violet-500'  },
  { key: 'noshow',    label: 'No-Show',               pill: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-500/10 dark:text-pink-300 dark:border-pink-500/20',             bar: 'bg-pink-500'    },
  { key: 'quotes',    label: 'Running Quotes',        pill: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20',             bar: 'bg-teal-500'    },
  { key: 'thinking',  label: 'Thinking About It',     pill: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/20', bar: 'bg-yellow-500'  },
  { key: 'sold',      label: 'Policy Sold',           pill: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',       bar: 'bg-green-500'   },
  { key: 'notint',    label: 'Not Interested',        pill: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/40 dark:border-white/10',                   bar: 'bg-gray-400'    },
  { key: 'dnc',       label: 'Do Not Call',           pill: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',                   bar: 'bg-red-500'     },
  { key: 'ghost',     label: 'Ghost / No Response',   pill: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/40 dark:border-white/10',                   bar: 'bg-gray-400'    },
  { key: 'bad',       label: 'Bad Lead',              pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',             bar: 'bg-rose-500'    },
]
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]))
function statusCfg(key) { return STATUS_MAP[key] ?? STATUSES[0] }

// Quick-filter groups for the status row
const STATUS_GROUP_FILTERS = [
  { key: 'pre_appt',  label: 'Pre-Appointment',  statuses: new Set(['new', 'attempted', 'callback', 'contacted', 'appt', 'noshow']) },
  { key: 'appt_run',  label: 'Appointment Run',  statuses: new Set(['quotes', 'thinking', 'ghost']) },
  { key: 'sold',      label: 'Policy Sold',       statuses: new Set(['sold']) },
  { key: 'dead',      label: 'Dead Lead',         statuses: new Set(['notint', 'dnc', 'bad']) },
]

// ─── Misc helpers ──────────────────────────────────────────────────────────────

export function isCallbackDue(lead) {
  if (!lead.callback_at) return false
  return new Date(lead.callback_at) <= new Date(Date.now() + 24 * 60 * 60 * 1000)
}

// Shared Tailwind classes
const INPUT_CLS  = 'w-full text-sm rounded-lg px-3 py-1.5 border bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors'
const SELECT_CLS = INPUT_CLS + ' cursor-pointer'
const LABEL_CLS  = 'block text-xs text-gray-500 dark:text-white/50 mb-1'

// ─── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'leads',     label: 'Leads'     },
  { key: 'callbacks', label: 'Callbacks' },
  { key: 'scripts',   label: 'Scripts'   },
  { key: 'pipeline',  label: 'Pipeline'  },
]

const CATEGORY_FILTERS = [
  { key: 'digital',  label: 'Digital'  },
  { key: 'analog',   label: 'Analog'   },
  { key: 'referral', label: 'Referral' },
]

const TYPE_FILTERS = [
  { key: 'life', label: 'Life',           types: ['Life Insurance - Standard', 'Life Insurance - Premium'] },
  { key: 'fe',   label: 'Final Expense',  types: ['Final Expense'] },
  { key: 'mp',   label: 'Mortgage',       types: ['Mortgage Protection'] },
]

export default function LeadsPage() {
  const { session, userProfile, fetchAndSetProfile } = useAuth()
  const { activeSubject, permissions } = useViewing()

  // Auth header for all leads API calls
  function authHeaders(extra) {
    const h = { 'Content-Type': 'application/json', ...extra }
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
    return h
  }

  const [tab,        setTab]        = useState('leads')
  const [leads,      setLeads]      = useState([])
  const [scripts,    setScripts]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [typeFilter,     setTypeFilter]     = useState('all')
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [sortKey,    setSortKey]    = useState('added')   // added | last_attempt | status_changed
  const [sortDesc,   setSortDesc]   = useState(true)
  const [showSetup,     setShowSetup]     = useState(false)
  const [subjectOptName, setSubjectOptName] = useState('')

  // Detail panel
  const [selected,     setSelected]     = useState(null)   // lead object
  const [activity,     setActivity]     = useState([])
  const [actLoading,   setActLoading]   = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [attemptError, setAttemptError] = useState('')
  const [cqfOpen,      setCqfOpen]      = useState(false)

  // Modals
  const [showAddLead,   setShowAddLead]   = useState(false)
  const [showAddScript, setShowAddScript] = useState(false)
  const [showImport,    setShowImport]    = useState(false)

  // Script pane — opens beside the lead card so a call can be worked from both
  const [scriptsOpen, setScriptsOpen] = useState(false)
  const [scriptId,    setScriptId]    = useState('default-best')

  // Layout. 1024–1279px (iPad landscape): the lead docks beside a 320px list in a 640px pane
  // and Scripts / CQF become tabs in it. Below 1024 the lead opens full width over the list;
  // from 1280 up the script pane sits beside the card (see the drawer below).
  const isMinSm = useMinSm()
  const isMinLg = useMinLg()
  const isMinXl = useMinXl()
  const docked      = isMinLg && !isMinXl
  const compactList = !isMinSm || (docked && !!selected)   // list column is ~320–380px wide
  const paneTab     = cqfOpen ? 'cqf' : scriptsOpen ? 'scripts' : 'lead'
  function setPaneTab(t) { setCqfOpen(t === 'cqf'); setScriptsOpen(t === 'scripts') }

  // ── Load ─────────────────────────────────────────────────────────────────────

  const sfgId = activeSubject?.sfg_id

  const loadLeads = useCallback(async () => {
    if (!sfgId) return
    setLoading(true)
    try {
      // include=scripts returns leads + scripts in one round-trip; personnel fetched
      // in parallel for opt_name since it's a separate function endpoint.
      const enc = encodeURIComponent(sfgId)
      const [leadsRes, personnelRes] = await Promise.all([
        fetch(`/api/leads?sfg_id=${enc}&include=scripts`, { headers: authHeaders() }),
        fetch(`/api/personnel?sfg_id=${enc}`, { headers: authHeaders() }),
      ])
      if (leadsRes.ok) {
        const { leads: d, scripts: s } = await leadsRes.json()
        setLeads(d ?? [])
        setScripts(s ?? [])
      }
      if (personnelRes.ok) {
        const data = await personnelRes.json()
        const rec = Array.isArray(data) ? data[0] : data
        setSubjectOptName(rec?.opt_name?.trim() || '')
      }
    } finally { setLoading(false) }
  }, [sfgId])

  useEffect(() => { loadLeads() }, [loadLeads])

  // Clear any pending push-notification badge when the agent views Leads directly
  // (not via tapping the notification, which already clears it in the service worker)
  useEffect(() => {
    if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [])

  async function openLead(lead) {
    setSelected(lead)
    setCqfOpen(false)
    setAttemptError('')
    setActLoading(true)
    try {
      const res = await fetch(`/api/leads?resource=activity&lead_id=${lead.id}`, { headers: authHeaders() })
      if (res.ok) { const { activity: d } = await res.json(); setActivity(d) }
    } finally { setActLoading(false) }
  }

  function closeDetail() { setSelected(null); setActivity([]); setScriptsOpen(false); setCqfOpen(false) }

  // ── Lead mutations ────────────────────────────────────────────────────────────

  function patchLeadLocal(id, updates) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    setSelected(prev => prev?.id === id ? { ...prev, ...updates } : prev)
  }

  function prependActivity(entry) {
    setActivity(prev => [entry, ...prev])
  }

  // "Log call attempt" / "Log text attempt": one history entry, +1 on the lead's attempt
  // totals, and the last-attempt time. A brand-new lead moves to Attempted Contact.
  // Dialing and texting are plain links in the panel — they don't log on their own.
  async function logAttempt(type) {
    if (!selected) return null
    setAttemptError('')
    const leadId = selected.id
    const now    = new Date()
    const today  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const body   = type === 'call' ? '📞 Call attempt logged' : '💬 Text attempt logged'
    const update = { last_contact: today }
    if (selected.status === 'new') update.status = 'attempted'

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

  // Autosave target for the CQF screen — takes an explicit lead id so a save that fires
  // as the form closes still lands on the right lead.
  async function saveLeadFields(leadId, fields) {
    patchLeadLocal(leadId, fields)
    try {
      const res = await fetch(`/api/leads?id=${leadId}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(fields),
      })
      if (!res.ok) return false
      const { lead } = await res.json()
      if (lead?.cqf_updated_at) patchLeadLocal(leadId, { cqf_updated_at: lead.cqf_updated_at })
      return true
    } catch { return false }
  }

  async function updateStatus(newStatus) {
    if (!selected) return
    setStatusSaving(true)
    const body = `🔄 Status → ${statusCfg(newStatus).label}`
    const [actRes, leadRes] = await Promise.all([
      fetch('/api/leads?resource=activity', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ lead_id: selected.id, sfg_id: sfgId, activity_type: 'status', body, update_lead: { status: newStatus } }),
      }),
    ])
    if (actRes.ok) {
      const { entry } = await actRes.json()
      prependActivity(entry)
      patchLeadLocal(selected.id, { status: newStatus, last_dispositioned_at: entry.created_at, last_activity_text: body, last_activity_at: entry.created_at })
    }
    setStatusSaving(false)
  }

  async function patchLeadField(field, value) {
    if (!selected) return
    patchLeadLocal(selected.id, { [field]: value })
    await fetch(`/api/leads?id=${selected.id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ [field]: value }),
    })
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
    const body = `🔄 Status → ${statusCfg(newStatus).label}`
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
      body: JSON.stringify({ sfg_id: sfgId, ...formData }),
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

  // ── Filtered / sorted leads ───────────────────────────────────────────────────

  const displayLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = leads.filter(l => {
      if (l.lead_type === 'Recruiting' || l.category === 'recruiting') return false
      const matchQ = !q
        || l.name.toLowerCase().includes(q)
        || (l.phone || '').includes(q)
        || (l.state || '').toLowerCase() === q
        || (l.email || '').toLowerCase().includes(q)
      if (!matchQ) return false
      if (categoryFilter !== 'all' && l.category !== categoryFilter) return false
      if (typeFilter !== 'all') {
        const tf = TYPE_FILTERS.find(t => t.key === typeFilter)
        if (tf && !tf.types.includes(l.lead_type)) return false
      }
      if (statusFilter !== 'all') {
        const grp = STATUS_GROUP_FILTERS.find(g => g.key === statusFilter)
        if (grp && !grp.statuses.has(l.status)) return false
      }
      return true
    })
    // Leads with no timestamp yet (never attempted / never re-dispositioned) count as oldest:
    // last in "most recent first", first in "oldest first" — i.e. the ones still needing work.
    const ts = v => v ? new Date(v).getTime() : 0
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'last_attempt')   cmp = ts(b.last_attempt_at) - ts(a.last_attempt_at)
      if (sortKey === 'status_changed') cmp = ts(b.last_dispositioned_at) - ts(a.last_dispositioned_at)
      cmp = cmp || (b.added || '').localeCompare(a.added || '') || (b.id - a.id)
      return sortDesc ? cmp : -cmp
    })
    return list
  }, [leads, search, categoryFilter, typeFilter, statusFilter, sortKey, sortDesc])

  // The agent's own scripts, in the shape the pane lists after the built-ins
  const personalPaneScripts = useMemo(
    () => scripts.map(x => ({ id: String(x.id), tab: x.title, heading: x.title, subtitle: x.category, body: x.body })),
    [scripts],
  )

  const callbackLeads = useMemo(() => {
    return leads
      .filter(l => l.callback_at)
      .sort((a, b) => new Date(a.callback_at) - new Date(b.callback_at))
  }, [leads])

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!permissions.leads.read) return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  if (!activeSubject) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view leads.</p>
      </div>
    )
  }

  // Room kept for the lead pane so the header, tabs and list are never hidden under it
  const paneMr = selected && scriptsOpen ? 'lg:mr-[640px] xl:mr-[1040px] 2xl:mr-[1120px]' : selected ? 'lg:mr-[640px] xl:mr-[520px]' : ''

  return (
    <div className={`flex flex-col h-full transition-[margin] duration-300 ${paneMr}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex-1">Leads</h1>
        {compactList ? (
          <MoreMenu items={[
            { label: '⚙️ Setup',  onClick: () => setShowSetup(true) },
            { label: '↑ Import', onClick: () => setShowImport(true) },
          ]} />
        ) : (
          <>
            <button
              onClick={() => setShowSetup(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 touch:min-h-11 rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              ⚙️ Setup
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 touch:min-h-11 rounded-lg border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              ↑ Import
            </button>
          </>
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

        {/* List / content area */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Leads tab ───────────────────────────────────────────────── */}
          {tab === 'leads' && (
            <div className="px-4 sm:px-6 py-4">

              {/* Search + sort */}
              <div className="flex flex-wrap gap-2 mb-3">
                <div className={`flex items-center gap-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/15 px-3 ${compactList ? 'basis-full w-full min-w-0 h-12 rounded-xl' : 'flex-1 min-w-[12rem] py-1.5 rounded-lg touch:h-11'}`}>
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
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value)}
                  aria-label="Sort leads by"
                  className={`text-sm px-3 border border-gray-200 dark:border-white/15 bg-white dark:bg-white/5 text-gray-700 dark:text-white/70 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30 ${compactList ? 'flex-1 min-w-0 h-11 rounded-xl' : 'py-1.5 rounded-lg touch:h-11'}`}
                >
                  <option value="added">Sort: Date added</option>
                  <option value="last_attempt">Sort: Last attempt</option>
                  <option value="status_changed">Sort: Status changed</option>
                </select>
                <button
                  onClick={() => setSortDesc(d => !d)}
                  className={`text-sm px-3 border border-gray-200 dark:border-white/15 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors whitespace-nowrap ${compactList ? 'h-11 rounded-xl' : 'py-1.5 rounded-lg touch:h-11'}`}
                >
                  {sortDesc ? '↓ Most recent' : '↑ Oldest'}
                </button>
              </div>

              {/* Filters */}
              <div className={compactList
                ? 'flex flex-nowrap items-center gap-x-2 overflow-x-auto -mx-4 px-4 pb-1 mb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'flex flex-wrap items-center gap-x-3 gap-y-2 mb-4'}>

                {/* Category group */}
                <div className="flex gap-1 shrink-0">
                  {CATEGORY_FILTERS.map(f => (
                    <button key={f.key}
                      onClick={() => setCategoryFilter(v => v === f.key ? 'all' : f.key)}
                      className={`whitespace-nowrap shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors ${
                        categoryFilter === f.key
                          ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                          : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/20'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>

                <div className="w-px h-4 bg-gray-200 dark:bg-white/10 shrink-0 max-sm:hidden" />

                {/* Type group */}
                <div className="flex gap-1 shrink-0">
                  {TYPE_FILTERS.map(f => (
                    <button key={f.key}
                      onClick={() => setTypeFilter(v => v === f.key ? 'all' : f.key)}
                      className={`whitespace-nowrap shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors ${
                        typeFilter === f.key
                          ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                          : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/20'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>

                <div className="w-px h-4 bg-gray-200 dark:bg-white/10 shrink-0 max-sm:hidden" />

                {/* Status group filters */}
                <div className="flex gap-1 shrink-0">
                  {STATUS_GROUP_FILTERS.map(f => (
                    <button key={f.key}
                      onClick={() => setStatusFilter(v => v === f.key ? 'all' : f.key)}
                      className={`whitespace-nowrap shrink-0 text-sm font-semibold px-3.5 py-1.5 max-sm:min-h-10 touch:min-h-10 rounded-full border transition-colors ${
                        statusFilter === f.key
                          ? 'border-accent bg-accent/10 text-gray-900 dark:text-white dark:bg-accent/15'
                          : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/20'
                      }`}
                    >{f.label}</button>
                  ))}
                </div>

                {/* Show All — only visible when any filter is active */}
                {(categoryFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all') && (
                  <button
                    onClick={() => { setCategoryFilter('all'); setTypeFilter('all'); setStatusFilter('all') }}
                    className="whitespace-nowrap shrink-0 text-xs font-medium px-3 py-1 max-sm:min-h-10 touch:min-h-10 rounded-full border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:text-gray-800 dark:hover:text-white/80 hover:border-gray-300 dark:hover:border-white/20 transition-colors"
                  >
                    Show All ✕
                  </button>
                )}
              </div>

              {/* Lead count */}
              <p className="text-sm text-gray-600 dark:text-white/60 mb-3 font-medium">
                {displayLeads.length} lead{displayLeads.length !== 1 ? 's' : ''}
                {(categoryFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all' || search) ? ' (filtered)' : ''}
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
                  <p className="text-sm">No leads found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {displayLeads.map(l => (
                    <LeadListCard key={l.id} lead={l} onClick={openLead} selected={selected?.id === l.id} statuses={STATUSES} stacked={docked && !!selected} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Callbacks tab ───────────────────────────────────────────── */}
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
                    const cb  = new Date(l.callback_at)
                    const now = new Date()
                    const overdue  = cb < now
                    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59)
                    const isToday  = cb <= todayEnd && cb >= new Date().setHours(0, 0, 0, 0)
                    return (
                      <div
                        key={l.id}
                        onClick={() => openLead(l)}
                        className="flex items-center gap-3 bg-white dark:bg-primary/30 border border-primary/15 dark:border-white/10 rounded-xl px-4 py-3 cursor-pointer hover:border-accent/30 transition-colors"
                      >
                        <div className={`text-xs font-bold px-2 py-1 rounded-lg border ${
                          overdue ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                          : isToday ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20'
                          : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20'
                        }`}>
                          {overdue ? 'Overdue' : isToday ? 'Today' : 'Upcoming'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{l.name}</p>
                          <p className="text-xs text-gray-400 dark:text-white/40">{fmtDateTime(l.callback_at)}</p>
                        </div>
                        <StatusPill status={l.status} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Scripts tab ─────────────────────────────────────────────── */}
          {tab === 'scripts' && (
            <ScriptsTab
              scripts={scripts}
              defaultScripts={DEFAULT_SCRIPT_LINKS}
              addLabel="Add Your Own"
              onAdd={() => setShowAddScript(true)}
              onDelete={handleDeleteScript}
            />
          )}

          {/* ── Pipeline tab ─────────────────────────────────────────────── */}
          {tab === 'pipeline' && (
            <PipelineTab
              leads={leads.filter(l => l.lead_type !== 'Recruiting' && l.category !== 'recruiting')}
              onOpenLead={openLead}
              onStatusChange={patchLeadStatus}
            />
          )}

        </div>

        {/* ── Lead detail drawer ───────────────────────────────────────── */}
        {/* Backdrop (below 1024px, where the lead covers the list) */}
        {selected && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={closeDetail}
          />
        )}

        {/* Drawer — full width below 1024, a docked 640px pane at 1024–1279, 520px from 1280 */}
        <div className={`fixed top-[var(--header-h)] right-0 bottom-0 z-30 w-full lg:w-[640px] xl:w-[520px] max-lg:pb-[env(safe-area-inset-bottom)] bg-white dark:bg-secondary border-l border-gray-200 dark:border-white/10 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
          {selected && (
            <Suspense fallback={<div className="flex-1 animate-pulse bg-gray-50 dark:bg-black/20" />}>
              <LeadPanel
                lead={selected}
                activity={activity}
                actLoading={actLoading}
                statuses={STATUSES}
                statusSaving={statusSaving}
                attemptError={attemptError}
                onClose={closeDetail}
                onLogAttempt={logAttempt}
                onAttemptNote={saveAttemptNote}
                onStatusChange={updateStatus}
                onCallbackChange={saveCallback}
                onPatch={patchLeadField}
                onOpenCqf={() => setCqfOpen(true)}
                scriptsOpen={scriptsOpen}
                onToggleScripts={() => setScriptsOpen(o => !o)}
                hideClose={docked}
                tabsNode={docked ? <PaneTabs value={paneTab} onChange={setPaneTab} onClose={closeDetail} /> : null}
                overrideBody={docked && paneTab === 'scripts' ? (
                  <Suspense fallback={<div className="flex-1 animate-pulse bg-gray-50 dark:bg-black/20" />}>
                    <ScriptPane
                      pane
                      personalScripts={personalPaneScripts}
                      activeId={scriptId}
                      onSelect={setScriptId}
                      onClose={() => setPaneTab('lead')}
                      onManage={() => { closeDetail(); setTab('scripts') }}
                      context={selected.lead_type}
                    />
                  </Suspense>
                ) : docked && paneTab === 'cqf' ? (
                  <Suspense fallback={<div className="flex-1 animate-pulse bg-gray-50 dark:bg-black/20" />}>
                    <CqfView
                      pane
                      key={selected.id}
                      lead={selected}
                      onClose={() => setPaneTab('lead')}
                      onSave={saveLeadFields}
                    />
                  </Suspense>
                ) : null}
              />
            </Suspense>
          )}
        </div>

        {/* Script pane — to the left of the card, so both can be used at once (1280px and up,
            and as a full-width overlay below 1024) */}
        {selected && scriptsOpen && !cqfOpen && !docked && (
          <Suspense fallback={null}>
            <ScriptPane
              personalScripts={personalPaneScripts}
              activeId={scriptId}
              onSelect={setScriptId}
              onClose={() => setScriptsOpen(false)}
              onManage={() => { closeDetail(); setTab('scripts') }}
              context={selected.lead_type}
            />
          </Suspense>
        )}

        {/* CQF — full-screen over the page, with the script pane in its left column */}
        {selected && cqfOpen && !docked && (
          <Suspense fallback={<div className="fixed top-[var(--header-h)] right-0 bottom-0 left-0 lg:left-16 xl:left-56 z-40 bg-gray-50 dark:bg-secondary" />}>
            <CqfView
              key={selected.id}
              lead={selected}
              onClose={() => setCqfOpen(false)}
              onSave={saveLeadFields}
              scriptsOpen={scriptsOpen}
              onToggleScripts={() => setScriptsOpen(o => !o)}
              scriptsNode={(
                <Suspense fallback={null}>
                  <ScriptPane
                    embedded
                    personalScripts={personalPaneScripts}
                    activeId={scriptId}
                    onSelect={setScriptId}
                    onClose={() => setScriptsOpen(false)}
                    onManage={() => { closeDetail(); setTab('scripts') }}
                    context={selected.lead_type}
                  />
                </Suspense>
              )}
            />
          </Suspense>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showImport && (
        <BulkLeadImportModal
          onClose={() => setShowImport(false)}
          onImported={newLeads => setLeads(prev => [...newLeads, ...prev])}
          authHeaders={authHeaders}
        />
      )}
      {showAddLead && (
        <AddLeadModal onClose={() => setShowAddLead(false)} onSave={handleAddLead} />
      )}
      {showAddScript && (
        <AddScriptModal onClose={() => setShowAddScript(false)} onSave={handleAddScript} showFormatHint />
      )}
      {showSetup && (
        <LeadsSetupModal
          onClose={() => setShowSetup(false)}
          userId={activeSubject?.id}
          optName={subjectOptName}
          authHeaders={authHeaders}
        />
      )}
    </div>
  )
}

// ─── Lead Card ─────────────────────────────────────────────────────────────────

export function LeadCard({ lead: l, onClick, selected, statuses = STATUSES }) {
  const { userProfile } = useAuth()
  const calConnected = userProfile?.google_calendar_connected ?? false
  const [showCalModal, setShowCalModal] = useState(false)

  const sMap = Object.fromEntries(statuses.map(s => [s.key, s]))
  const s    = sMap[l.status] ?? statuses[0]
  const tc  = typeCfg(l.lead_type)
  const tz  = getLeadTZ(l.state)
  const now = new Date()
  const cb  = l.callback_at ? new Date(l.callback_at) : null
  const cbOverdue = cb && cb < now
  const cbToday   = cb && !cbOverdue && cb <= new Date(now.setHours(23, 59, 59))

  return (
    <>
      {showCalModal && (
        <CalendarEventModal lead={l} onClose={() => setShowCalModal(false)} />
      )}
      <div
        onClick={() => onClick(l)}
        className={`relative bg-white dark:bg-primary/30 border rounded-xl cursor-pointer transition-all overflow-hidden ${
          selected
            ? 'border-accent/50 shadow-sm shadow-accent/10'
            : 'border-primary/15 dark:border-white/10 hover:border-accent/30'
        }`}
      >
        {/* Left accent bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />

        <div className="pl-3 pr-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{l.name}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${tc.cls}`}>{tc.label}</span>
                {l.medical && <span className="text-xs font-bold text-orange-600 dark:text-orange-400">⚠️ Med Hx</span>}
                {l.smoker  && <span className="text-xs text-gray-400 dark:text-white/30">🚬</span>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {l.phone && <span className="text-xs text-gray-500 dark:text-white/50">{l.phone}</span>}
                {l.state && <span className="text-xs text-gray-500 dark:text-white/50">📍 {l.state}</span>}
                {l.age   && <span className="text-xs text-gray-500 dark:text-white/50">Age {l.age}</span>}
                {tz && (
                  <span className={`text-xs font-semibold ${tz.goodTime ? tz.color : 'text-red-500 dark:text-red-400'}`}>
                    {tz.label} {tz.timeStr}{!tz.goodTime ? ' ⛔' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Quick call / text / calendar */}
            <div className="flex gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
              {l.phone && (
                <a
                  href={`tel:+1${l.phone.replace(/[^0-9]/g, '')}`}
                  className="text-sm px-2 py-1 touch:min-h-11 touch:min-w-11 max-sm:min-h-11 max-sm:min-w-11 inline-flex items-center justify-center rounded-lg bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 font-bold hover:bg-green-100 dark:hover:bg-green-500/20 transition-colors"
                >📞</a>
              )}
              {l.phone && (
                <a
                  href={`sms:+1${l.phone.replace(/[^0-9]/g, '')}`}
                  className="text-sm px-2 py-1 touch:min-h-11 touch:min-w-11 max-sm:min-h-11 max-sm:min-w-11 inline-flex items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 font-bold hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                >💬</a>
              )}
              {calConnected && (
                <button
                  onClick={() => setShowCalModal(true)}
                  className="text-sm px-2 py-1 touch:min-h-11 touch:min-w-11 max-sm:min-h-11 max-sm:min-w-11 inline-flex items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 font-bold hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-colors"
                >📅</button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 gap-2">
            <StatusPill status={l.status} statuses={statuses} />
            {cb && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md border ${
                cbOverdue ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                : cbToday ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20'
                : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20'
              }`}>
                📅 {cbOverdue ? 'Overdue' : cbToday ? 'Today' : fmtDateTime(l.callback_at)}
              </span>
            )}
          </div>

          {/* Contracting status — shown on recruiting leads linked to a hire */}
          {l.hired_sfg_id && l.contracting && (
            <ContractingStatus contracting={l.contracting} isStub={l.is_stub} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── Contracting Status Card ────────────────────────────────────────────────────

function ContractingStatus({ contracting: c, isStub }) {
  const hasIssue    = !!c.profile_issues
  const isComplete  = !!c.contracting_complete
  const hasContracts = c.contract_count > 0
  const wasSent     = !!c.contracting_to_producer
  const eandoOk     = !c.no_eando  // no_eando=true means E&O is missing

  const { status, statusCls } = hasIssue
    ? { status: `⚠ ${c.profile_issues}`, statusCls: 'text-red-600 dark:text-red-400' }
    : isComplete
    ? { status: 'Contracting complete', statusCls: 'text-green-700 dark:text-green-400' }
    : hasContracts
    ? { status: `${c.contract_count} of ${c.total_carriers}`, statusCls: 'text-amber-700 dark:text-amber-400' }
    : wasSent
    ? { status: `Sent ${fmtDate(c.contracting_to_producer)}`, statusCls: 'text-orange-600 dark:text-orange-400' }
    : { status: 'Not started', statusCls: 'text-gray-400 dark:text-white/30' }

  const borderCls = hasIssue
    ? 'border-red-200 dark:border-red-500/20'
    : isComplete
    ? 'border-green-200 dark:border-green-500/20'
    : hasContracts || wasSent
    ? 'border-amber-200 dark:border-amber-500/20'
    : 'border-gray-200 dark:border-white/10'

  return (
    <div className={`mt-2 rounded-lg border text-xs overflow-hidden ${borderCls}`}>
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-white/60 dark:bg-primary/20">
        <span className="font-semibold uppercase tracking-widest text-gray-500 dark:text-white/40 shrink-0">Contracting</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 ${eandoOk ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
            {eandoOk ? '✓ E&O' : '✕ E&O'}
          </span>
          <span className={`font-semibold truncate ${statusCls}`}>{status}</span>
        </div>
      </div>
      {isStub && (
        <div className="px-2 py-0.5 text-gray-400 dark:text-white/25 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/5">
          Auto-generated record
        </div>
      )}
    </div>
  )
}

// ─── Lead Detail ───────────────────────────────────────────────────────────────

export function LeadDetail({
  lead: l, activity, actLoading,
  noteText, setNoteText, showNoteBox, setShowNoteBox,
  statusSaving, onClose, onCall, onText, onNote, onStatusChange, onCallbackChange, onPatch,
  statuses = STATUSES, isRecruiting = false,
  scriptsOpen = false, onToggleScripts,
}) {
  const { userProfile } = useAuth()
  const calConnected = userProfile?.google_calendar_connected ?? false
  const [showCalModal, setShowCalModal] = useState(false)
  const [form, setForm] = useState({})

  // Reset local form when a different lead is opened
  useEffect(() => {
    setForm({
      name:                   l.name                   || '',
      preferred_name:         l.preferred_name         || '',
      spouse_name:            l.spouse_name            || '',
      phone:                  l.phone                  || '',
      email:                  l.email                  || '',
      state:                  l.state                  || '',
      zip:                    l.zip                    || '',
      city:                   l.city                   || '',
      county:                 l.county                 || '',
      gender:                 l.gender                 || '',
      age:                    l.age                    ?? '',
      dob:                    l.dob                    || '',
      marital_status:         l.marital_status         || '',
      household_size:         l.household_size         || '',
      has_children:           l.has_children           || '',
      children_age_range:     l.children_age_range     || '',
      length_of_residence:    l.length_of_residence    || '',
      homeowner:              l.homeowner              || '',
      lead_type:              l.lead_type              || 'Life Insurance - Standard',
      coverage:               l.coverage               || '',
      employment:             l.employment             || '',
      income:                 l.income                 || '',
      beneficiary:            l.beneficiary            || '',
      smoker:                 l.smoker                 ?? false,
      medical:                l.medical                ?? false,
      motivation:             l.motivation             || '',
      hobby:                  l.hobby                  || '',
      source:                 l.source                 || '',
      notes:                  l.notes                  || '',
      vendor_lead_id:         l.vendor_lead_id         || '',
      reachability_score:     l.reachability_score     || '',
      phone_activity_score:   l.phone_activity_score   ?? '',
      known_litigator:        l.known_litigator        ?? false,
      phone_line_type:        l.phone_line_type        || '',
      phone_status:           l.phone_status           || '',
      assigned_date:          l.assigned_date          || '',
      parse_source:           l.parse_source           || '',
      raw_subject:            l.raw_subject            || '',
    })
  }, [l.id])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function save(k, transform) {
    const raw = form[k]
    const val = transform ? transform(raw) : (raw === '' ? null : raw)
    const orig = l[k] ?? null
    // Normalise for comparison
    const normVal  = val  === '' ? null : val
    const normOrig = orig === '' ? null : orig
    if (normVal !== normOrig) onPatch(k, normVal)
  }

  const tz    = getLeadTZ(form.state || l.state)
  const cbVal = l.callback_at ? new Date(l.callback_at).toISOString().slice(0, 16) : ''

  const ACT_ICON = { call: '📞', text: '💬', note: '📝', status: '🔄', callback: '📅' }

  const groupedActivity = useMemo(() => {
    const groups = {}
    for (const a of activity) {
      const day = new Date(a.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      if (!groups[day]) groups[day] = []
      groups[day].push(a)
    }
    return groups
  }, [activity])

  // Small shared input style for the detail pane
  const F = 'w-full text-xs rounded-md px-2 py-1 max-sm:py-2.5 touch:py-2 border bg-transparent hover:bg-gray-50 dark:hover:bg-white/5 text-gray-800 dark:text-white/80 border-transparent hover:border-gray-200 dark:hover:border-white/15 focus:bg-white dark:focus:bg-white/5 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors'
  const FL = 'text-xs text-gray-500 dark:text-white/50 mb-0.5'

  return (
    <>
      {showCalModal && (
        <CalendarEventModal lead={l} onClose={() => setShowCalModal(false)} />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-white/10 shrink-0">
        <button onClick={onClose} aria-label="Close" className="w-11 h-11 sm:w-9 sm:h-9 touch:sm:w-11 touch:sm:h-11 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-base">←</button>
        <div className="flex-1 min-w-0">
          <input
            value={form.name ?? ''}
            onChange={e => set('name', e.target.value)}
            onBlur={() => save('name')}
            className="text-sm font-bold text-gray-900 dark:text-white bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-white/20 focus:border-accent/50 focus:outline-none w-full truncate transition-colors"
          />
          <p className="text-xs text-gray-400 dark:text-white/40">{l.lead_type} · {l.state || '—'}
            {tz && <span className={` · ${tz.color} font-semibold`}> {tz.label} {tz.timeStr}{!tz.goodTime ? ' ⛔' : ' ✓'}</span>}
          </p>
        </div>
        <StatusPill status={l.status} statuses={statuses} />
      </div>

      {/* Action bar */}
      <div className="flex gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5 shrink-0">
        {[
          { label: 'Call', icon: '📞', cls: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',  onClick: onCall },
          { label: 'Text', icon: '💬', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',      onClick: () => onText('') },
          { label: 'Note', icon: '📝', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',  onClick: () => setShowNoteBox(n => !n) },
          ...(onToggleScripts ? [{
            label: 'Scripts', icon: '📜',
            cls: scriptsOpen
              ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
              : 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-white/70',
            onClick: onToggleScripts,
          }] : []),
        ].map(btn => (
          <button key={btn.label} onClick={btn.onClick}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-semibold ${btn.cls} transition-colors hover:opacity-80`}>
            <span className="text-base">{btn.icon}</span>{btn.label}
          </button>
        ))}
        <button
          onClick={() => calConnected ? setShowCalModal(true) : undefined}
          title={calConnected ? 'Schedule calendar event' : 'Connect Google Calendar in your profile to use this'}
          className={`flex flex-col items-center gap-1 py-2 px-2 rounded-xl text-xs font-semibold transition-colors ${
            calConnected
              ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 hover:opacity-80 cursor-pointer'
              : 'bg-gray-50 text-gray-300 dark:bg-white/[0.03] dark:text-white/20 cursor-not-allowed'
          }`}
        >
          <span className="text-base">📅</span>
          <span>Appt</span>
        </button>
        <select
          value={l.status}
          onChange={e => onStatusChange(e.target.value)}
          disabled={statusSaving}
          className="flex-1 text-xs font-semibold rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-white/70 px-2 py-1 min-h-11 touch:min-h-11 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        >
          {statuses.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* Inline note box */}
      {showNoteBox && (
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02] shrink-0">
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Add a note…"
            rows={3}
            className={INPUT_CLS + ' resize-none'}
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button onClick={onNote} disabled={!noteText.trim()} className="text-xs px-4 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors">Save</button>
            <button onClick={() => { setShowNoteBox(false); setNoteText('') }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Callback scheduler */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
          <label className="block text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wide mb-2">📅 Schedule Callback</label>
          <div className="flex gap-2 items-center">
            <input
              type="datetime-local"
              defaultValue={cbVal}
              key={cbVal}
              onBlur={e => onCallbackChange(e.target.value)}
              className={INPUT_CLS + ' flex-1 dark:[color-scheme:dark] text-xs'}
            />
            {l.callback_at && (
              <button onClick={() => onCallbackChange('')} className="text-xs px-3 py-1 min-h-11 touch:min-h-11 rounded-lg border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors whitespace-nowrap">Clear</button>
            )}
          </div>
        </div>

        {/* Contact info */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
          <SectionLabel>Contact Info</SectionLabel>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <p className={FL}>Phone</p>
              <input type="tel" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} onBlur={() => save('phone')} className={F} placeholder="—" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <div>
                <p className={FL}>State</p>
                <input value={form.state ?? ''} onChange={e => set('state', e.target.value.toUpperCase().slice(0,2))} onBlur={() => save('state')} className={F} placeholder="—" maxLength={2} />
              </div>
              <div>
                <p className={FL}>ZIP</p>
                <input value={form.zip ?? ''} onChange={e => set('zip', e.target.value)} onBlur={() => save('zip')} className={F} placeholder="—" />
              </div>
            </div>
            <div>
              <p className={FL}>City</p>
              <input value={form.city ?? ''} onChange={e => set('city', e.target.value)} onBlur={() => save('city')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>County</p>
              <input value={form.county ?? ''} onChange={e => set('county', e.target.value)} onBlur={() => save('county')} className={F} placeholder="—" />
            </div>
            <div className="col-span-2">
              <p className={FL}>Email</p>
              <input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} onBlur={() => save('email')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Preferred Name</p>
              <input value={form.preferred_name ?? ''} onChange={e => set('preferred_name', e.target.value)} onBlur={() => save('preferred_name')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Spouse Name</p>
              <input value={form.spouse_name ?? ''} onChange={e => set('spouse_name', e.target.value)} onBlur={() => save('spouse_name')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Source</p>
              <select value={form.source ?? ''} onChange={e => set('source', e.target.value)} onBlur={() => save('source')} className={F + ' cursor-pointer'}>
                <option value="">—</option>
                {Object.entries(SOURCE_DISPLAY).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={FL}>Assigned Date</p>
              <input type="date" value={form.assigned_date ?? ''} onChange={e => set('assigned_date', e.target.value)} onBlur={() => save('assigned_date')} className={F + ' dark:[color-scheme:dark]'} />
            </div>
            <div>
              <p className={FL}>Added</p>
              <p className="text-xs font-semibold text-gray-800 dark:text-white/80 px-2 py-1">{fmtDate(l.added)}</p>
            </div>
          </div>
        </div>

        {isRecruiting ? (
          /* ── Recruiting: Status section ── */
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
            <SectionLabel>Status</SectionLabel>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div className="col-span-2">
                <p className={FL}>Source</p>
                <select value={form.source ?? ''} onChange={e => { set('source', e.target.value); onPatch('source', e.target.value || null) }} className={F + ' cursor-pointer'}>
                  <option value="">—</option>
                  {Object.entries(SOURCE_DISPLAY).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className={FL}>Interview Date</p>
                <input type="date" value={form.assigned_date ?? ''} onChange={e => set('assigned_date', e.target.value)} onBlur={() => save('assigned_date')} className={F + ' dark:[color-scheme:dark]'} />
              </div>
              <div>
                <p className={FL}>Added</p>
                <p className="text-xs font-semibold text-gray-800 dark:text-white/80 px-2 py-1">{fmtDate(l.added)}</p>
              </div>
              <div className="col-span-2">
                <p className={FL}>Pre-Licensing Progress</p>
                <textarea
                  value={form.notes ?? ''}
                  onChange={e => set('notes', e.target.value)}
                  onBlur={() => save('notes')}
                  rows={3}
                  placeholder="e.g. Enrolled at Kaplan, chapter 5 of 15…"
                  className={F + ' resize-y w-full'}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Lead details */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
              <SectionLabel>Lead Details</SectionLabel>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div className="col-span-2">
                  <p className={FL}>Campaign</p>
                  <select value={form.lead_type ?? ''} onChange={e => { set('lead_type', e.target.value); onPatch('lead_type', e.target.value) }} className={F + ' cursor-pointer'}>
                    <option value="Life Insurance - Standard">Life Insurance - Standard</option>
                    <option value="Life Insurance - Premium">Life Insurance - Premium</option>
                    <option value="Mortgage Protection">Mortgage Protection</option>
                  </select>
                </div>
                <div>
                  <p className={FL}>Gender</p>
                  <select value={form.gender ?? ''} onChange={e => { set('gender', e.target.value); onPatch('gender', e.target.value || null) }} className={F + ' cursor-pointer'}>
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <p className={FL}>Age</p>
                  <input type="number" min="0" max="120" value={form.age ?? ''} onChange={e => set('age', e.target.value)} onBlur={() => save('age', v => v === '' ? null : parseInt(v) || null)} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Date of Birth</p>
                  <input type="date" value={form.dob ?? ''} onChange={e => set('dob', e.target.value)} onBlur={() => save('dob')} className={F + ' dark:[color-scheme:dark]'} />
                </div>
                <div>
                  <p className={FL}>Marital Status</p>
                  <select value={form.marital_status ?? ''} onChange={e => { set('marital_status', e.target.value); onPatch('marital_status', e.target.value || null) }} className={F + ' cursor-pointer'}>
                    <option value="">—</option>
                    <option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option><option>Separated</option>
                  </select>
                </div>
                <div>
                  <p className={FL}>Coverage</p>
                  <input value={form.coverage ?? ''} onChange={e => set('coverage', e.target.value)} onBlur={() => save('coverage')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Beneficiary</p>
                  <input value={form.beneficiary ?? ''} onChange={e => set('beneficiary', e.target.value)} onBlur={() => save('beneficiary')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Employment</p>
                  <input value={form.employment ?? ''} onChange={e => set('employment', e.target.value)} onBlur={() => save('employment')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Income</p>
                  <input value={form.income ?? ''} onChange={e => set('income', e.target.value)} onBlur={() => save('income')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Motivation</p>
                  <input value={form.motivation ?? ''} onChange={e => set('motivation', e.target.value)} onBlur={() => save('motivation')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Hobby / Security Word</p>
                  <input value={form.hobby ?? ''} onChange={e => set('hobby', e.target.value)} onBlur={() => save('hobby')} className={F} placeholder="—" />
                </div>
              </div>

              {/* Toggles */}
              <div className="flex gap-4 mt-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={!!form.smoker} onChange={e => { set('smoker', e.target.checked); onPatch('smoker', e.target.checked) }} className="w-3.5 h-3.5 rounded accent-accent" />
                  <span className="text-xs text-gray-600 dark:text-white/60">🚬 Smoker</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={!!form.medical} onChange={e => { set('medical', e.target.checked); onPatch('medical', e.target.checked) }} className="w-3.5 h-3.5 rounded accent-accent" />
                  <span className="text-xs text-gray-600 dark:text-white/60">⚠️ Major Med History</span>
                </label>
              </div>
            </div>

            {/* Household */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
              <SectionLabel>Household</SectionLabel>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <p className={FL}>Household Size</p>
                  <input value={form.household_size ?? ''} onChange={e => set('household_size', e.target.value)} onBlur={() => save('household_size')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Has Children</p>
                  <select value={form.has_children ?? ''} onChange={e => { set('has_children', e.target.value); onPatch('has_children', e.target.value || null) }} className={F + ' cursor-pointer'}>
                    <option value="">—</option>
                    <option>Yes</option><option>No</option>
                  </select>
                </div>
                <div>
                  <p className={FL}>Children Age Range</p>
                  <input value={form.children_age_range ?? ''} onChange={e => set('children_age_range', e.target.value)} onBlur={() => save('children_age_range')} className={F} placeholder="—" />
                </div>
                <div>
                  <p className={FL}>Homeowner</p>
                  <select value={form.homeowner ?? ''} onChange={e => { set('homeowner', e.target.value); onPatch('homeowner', e.target.value || null) }} className={F + ' cursor-pointer'}>
                    <option value="">—</option>
                    <option>Yes</option><option>No</option>
                  </select>
                </div>
                <div>
                  <p className={FL}>Length of Residence</p>
                  <input value={form.length_of_residence ?? ''} onChange={e => set('length_of_residence', e.target.value)} onBlur={() => save('length_of_residence')} className={F} placeholder="—" />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
              <SectionLabel>Notes</SectionLabel>
              <textarea
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)}
                onBlur={() => save('notes')}
                rows={3}
                placeholder="General notes about this lead…"
                className={F + ' resize-y w-full'}
              />
            </div>
          </>
        )}

        {/* Lead Metadata */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
          <SectionLabel>Lead Metadata</SectionLabel>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <p className={FL}>Vendor Lead ID</p>
              <input value={form.vendor_lead_id ?? ''} onChange={e => set('vendor_lead_id', e.target.value)} onBlur={() => save('vendor_lead_id')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Reachability Score</p>
              <input value={form.reachability_score ?? ''} onChange={e => set('reachability_score', e.target.value)} onBlur={() => save('reachability_score')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Phone Activity Score</p>
              <input type="number" value={form.phone_activity_score ?? ''} onChange={e => set('phone_activity_score', e.target.value)} onBlur={() => save('phone_activity_score', v => v === '' ? null : parseInt(v) || null)} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Phone Line Type</p>
              <input value={form.phone_line_type ?? ''} onChange={e => set('phone_line_type', e.target.value)} onBlur={() => save('phone_line_type')} className={F} placeholder="—" />
            </div>
            <div>
              <p className={FL}>Phone Status</p>
              <input value={form.phone_status ?? ''} onChange={e => set('phone_status', e.target.value)} onBlur={() => save('phone_status')} className={F} placeholder="—" />
            </div>
            <div className="flex items-center gap-2 pt-3">
              <input type="checkbox" checked={!!form.known_litigator} onChange={e => { set('known_litigator', e.target.checked); onPatch('known_litigator', e.target.checked) }} className="w-3.5 h-3.5 rounded accent-accent" />
              <span className="text-xs text-gray-600 dark:text-white/60">⚠️ Known Litigator</span>
            </div>
            <div className="col-span-2">
              <p className={FL}>Parse Source</p>
              <input value={form.parse_source ?? ''} onChange={e => set('parse_source', e.target.value)} onBlur={() => save('parse_source')} className={F} placeholder="—" />
            </div>
            <div className="col-span-2">
              <p className={FL}>Raw Subject</p>
              <input value={form.raw_subject ?? ''} onChange={e => set('raw_subject', e.target.value)} onBlur={() => save('raw_subject')} className={F} placeholder="—" />
            </div>
          </div>
        </div>

        {/* Activity history */}
        <div className="px-4 py-3">
          <SectionLabel>
            Contact History
            <span className="ml-2 text-gray-400 dark:text-white/30 font-normal lowercase tracking-normal">
              {activity.filter(a => a.activity_type === 'call' || a.activity_type === 'text').length} contacts
            </span>
          </SectionLabel>
          {actLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 dark:bg-white/5 rounded-lg" />)}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-white/30">No activity yet. Log a call, text, or note to get started.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedActivity).map(([day, entries]) => (
                <div key={day}>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-white/30 mb-2">{day}</p>
                  <div className="space-y-2">
                    {entries.map(a => (
                      <div key={a.id} className="flex gap-2.5">
                        <span className="text-sm mt-0.5 w-5 text-center shrink-0">{ACT_ICON[a.activity_type] || '📋'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-700 dark:text-white/70">{a.body}</p>
                          <p className="text-xs text-gray-400 dark:text-white/30">{fmtDateTime(a.created_at)}</p>
                          {a.note && (
                            <div className="mt-1.5 bg-amber-50 dark:bg-amber-500/5 border-l-2 border-amber-400/60 rounded-r-lg px-2.5 py-1.5">
                              <p className="text-xs text-gray-600 dark:text-white/60 whitespace-pre-wrap">{a.note}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-8" />
      </div>
    </>
  )
}

// ─── Scripts Tab ───────────────────────────────────────────────────────────────

// Downloadable built-ins listed on the Scripts tab. The formatted text of the same
// scripts (shown in the lead pane) lives in config/salesScripts.js.
const DEFAULT_SCRIPT_LINKS = [
  {
    id: 'default-best',
    title: 'BEST System Script (Dialing)',
    description: 'Multi-use phone script for every lead type: the reason for your call, qualifying questions, and booking the appointment.',
    href: '/sales-scripts/BEST-System-Script.pdf',
  },
  {
    id: 'default-real',
    title: 'REAL Sales Script (Appointments)',
    description: 'Full appointment presentation: Rapport, Emotion, Assumption, and Lock It Down.',
    href: '/sales-scripts/REAL-Sales-Script.pdf',
  },
]

export function ScriptsTab({ scripts, onAdd, onDelete, defaultScripts = [], addLabel = '+ Add Script' }) {
  const [copied,  setCopied]  = useState(null)
  const [confirm, setConfirm] = useState(null) // id to delete

  const byCategory = useMemo(() => {
    const groups = {}
    for (const s of scripts) {
      if (!groups[s.category]) groups[s.category] = []
      groups[s.category].push(s)
    }
    return groups
  }, [scripts])

  function copyScript(s) {
    navigator.clipboard.writeText(s.body).then(() => {
      setCopied(s.id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-gray-400 dark:text-white/30 font-medium">{scripts.length + defaultScripts.length} script{scripts.length + defaultScripts.length !== 1 ? 's' : ''}</p>
        <button onClick={onAdd} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors">{addLabel}</button>
      </div>

      {defaultScripts.length > 0 && (
        <div className={scripts.length > 0 ? 'mb-6' : ''}>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-2 pb-1 border-b border-gray-100 dark:border-white/10">Default Scripts</p>
          <div className="space-y-2">
            {defaultScripts.map(s => (
              <a
                key={s.id}
                href={s.href}
                download
                className="flex items-start justify-between gap-2 bg-white dark:bg-primary/30 border border-primary/15 dark:border-white/10 rounded-xl p-3 hover:border-accent/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{s.title}</p>
                  <p className="text-xs text-gray-500 dark:text-white/40 leading-relaxed">{s.description}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-lg font-semibold shrink-0 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40">Download PDF</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {scripts.length === 0 ? (
        defaultScripts.length > 0 ? null : <div className="text-center py-16 text-gray-400 dark:text-white/30">
          <p className="text-3xl mb-3">💬</p>
          <p className="text-sm">No scripts yet — add your call and text templates here</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-2 pb-1 border-b border-gray-100 dark:border-white/10">{cat}</p>
              <div className="space-y-2">
                {items.map(s => (
                  <div key={s.id} className="bg-white dark:bg-primary/30 border border-primary/15 dark:border-white/10 rounded-xl p-3 cursor-pointer hover:border-accent/30 transition-colors" onClick={() => copyScript(s)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.title}</p>
                          {s.tag && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent">{s.tag}</span>}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-white/40 line-clamp-2 leading-relaxed">{s.body}</p>
                      </div>
                      <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => copyScript(s)}
                          className={`text-xs px-2 py-1 rounded-lg font-semibold transition-colors ${copied === s.id ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' : 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40 hover:bg-gray-200 dark:hover:bg-white/10'}`}
                        >
                          {copied === s.id ? '✓ Copied' : 'Copy'}
                        </button>
                        {confirm === s.id ? (
                          <>
                            <button onClick={() => { onDelete(s.id); setConfirm(null) }} className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 font-semibold">Delete</button>
                            <button onClick={() => setConfirm(null)} className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-white/30">Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => setConfirm(s.id)} className="text-xs px-2 py-1 rounded-lg text-gray-300 dark:text-white/20 hover:text-red-500 transition-colors">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Pipeline Tab ──────────────────────────────────────────────────────────────

export function PipelineTab({ leads, statuses = STATUSES, onOpenLead, onStatusChange }) {
  const [draggingId, setDraggingId] = useState(null)
  const [dragOver,   setDragOver]   = useState(null)

  const byStatus = useMemo(() => {
    const g = Object.fromEntries(statuses.map(s => [s.key, []]))
    for (const l of leads) { if (g[l.status]) g[l.status].push(l) }
    return g
  }, [leads, statuses])

  function handleDragStart(e, leadId) {
    setDraggingId(leadId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, statusKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(statusKey)
  }

  function handleDrop(e, statusKey) {
    e.preventDefault()
    if (draggingId != null) {
      const lead = leads.find(l => l.id === draggingId)
      if (lead && lead.status !== statusKey) onStatusChange?.(draggingId, statusKey)
    }
    setDraggingId(null)
    setDragOver(null)
  }

  return (
    <div className="px-4 sm:px-6 py-4 space-y-5">

      {/* Kanban */}
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3" style={{ minWidth: `${statuses.length * 13}rem` }}>
          {statuses.map(s => {
            const colLeads = byStatus[s.key] ?? []
            const isOver   = dragOver === s.key
            return (
              <div
                key={s.key}
                className="flex flex-col w-52 shrink-0"
                onDragOver={e => handleDragOver(e, s.key)}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null) }}
                onDrop={e => handleDrop(e, s.key)}
              >
                {/* Column header */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border border-b-0 transition-colors ${
                  isOver
                    ? 'bg-accent/10 dark:bg-accent/15 border-accent/40 text-accent'
                    : 'bg-white dark:bg-primary/30 border-gray-200 dark:border-white/10 text-gray-700 dark:text-white/70'
                }`}>
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.bar}`} />
                  <span className="text-xs font-bold uppercase tracking-wider flex-1 truncate">{s.label}</span>
                  <span className="text-xs font-extrabold tabular-nums">{colLeads.length}</span>
                </div>

                {/* Drop zone */}
                <div className={`flex-1 border rounded-b-xl p-2 space-y-2 min-h-[160px] transition-colors ${
                  isOver
                    ? 'bg-accent/5 border-accent/30'
                    : 'bg-gray-50 dark:bg-white/[0.02] border-gray-200 dark:border-white/10'
                }`}>
                  {colLeads.length === 0 && !isOver && (
                    <p className="text-center text-xs text-gray-300 dark:text-white/15 pt-5 select-none">Drop here</p>
                  )}
                  {colLeads.map(l => (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={e => handleDragStart(e, l.id)}
                      onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                      onClick={() => onOpenLead?.(l)}
                      className={`bg-white dark:bg-primary/40 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing hover:border-accent/40 transition-colors select-none ${
                        draggingId === l.id ? 'opacity-40' : ''
                      }`}
                    >
                      <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{l.name}</p>
                      {l.state && (
                        <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">📍 {l.state}</p>
                      )}
                      {l.phone && (
                        <a
                          href={`tel:+1${l.phone.replace(/[^0-9]/g, '')}`}
                          onClick={e => e.stopPropagation()}
                          className="text-xs text-gray-400 dark:text-white/30 hover:text-green-600 dark:hover:text-green-400 block mt-0.5"
                        >
                          {l.phone}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ─── Leads Setup Modal ─────────────────────────────────────────────────────────

function LeadsSetupModal({ onClose, userId, optName, authHeaders }) {
  const [email,  setEmail]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [step,   setStep]   = useState(null)   // null = loading

  // Fetch leads_email for the viewed subject
  useEffect(() => {
    if (!userId) { setStep('capture'); return }
    supabase.from('users').select('leads_email').eq('id', userId).single()
      .then(({ data }) => {
        const e = data?.leads_email?.trim() || ''
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
        body: JSON.stringify({ id: userId, field: 'leads_email', value: email.trim() }),
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
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Leads Setup</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-5">

          {/* ── Loading ── */}
          {step === null && (
            <p className="text-sm text-gray-400 dark:text-white/30 text-center py-4">Loading…</p>
          )}

          {/* ── Step 1: capture email ── */}
          {step === 'capture' && (
            <>
              <p className="text-sm text-gray-700 dark:text-white/80">
                What email address will you be receiving your digital leads to?
              </p>
              <div>
                <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">Leads Inbox Email</label>
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
              <div className="flex justify-end">
                <button
                  onClick={handleSaveEmail}
                  disabled={saving}
                  className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Continue'}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: setup instructions ── */}
          {step === 'setup' && (
            <>
              {/* Editable email */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">Leads Inbox Email</label>
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

              <p className="text-xs text-gray-500 dark:text-white/45">
                Your Opt name:{' '}
                <span className="font-medium text-gray-700 dark:text-white/70">
                  {optName || <span className="italic text-gray-400 dark:text-white/30">not set</span>}
                </span>
              </p>

              <hr className="border-gray-100 dark:border-white/10" />

              {/* Instructions */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">
                  How to Set Up Automatic and Manual Lead Import
                </p>
                <div className="space-y-4 text-sm text-gray-600 dark:text-white/60 leading-relaxed">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white/80 mb-1">Step 1 — Forward leads to the import mailbox</p>
                    <p className="mb-2">Set up a rule for any digital leads you are receiving. You will need a separate rule for each lead type. For each one, set any incoming emails to forward automatically to <span className="font-medium text-gray-700 dark:text-white/70">leads@wattsfamilyagency.com</span>.</p>
                    <div className="space-y-1.5 pl-3 border-l-2 border-gray-200 dark:border-white/10">
                      <div>
                        <p className="font-medium text-gray-700 dark:text-white/70">Razor Ridge</p>
                        <p>Filter emails coming from <span className="font-mono text-xs">notifications@therazorridge.com</span></p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 dark:text-white/70">Lighthouse</p>
                        <p>Filter emails with a subject of <span className="italic">"New Leads Assigned to [your Opt name, shown above]"</span></p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 dark:text-white/70">Level Up</p>
                        <p>Filter emails coming from <span className="font-mono text-xs">info@levelup-crm.com</span></p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 dark:text-white/70">CABoom</p>
                        <p>Filter emails coming from <span className="font-mono text-xs">leads@caboomleads.com</span></p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-white/50 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2.5">
                    💡 It's recommended to turn on push notifications from the user menu in the top right so that you will get notified when new digital leads drop.
                  </p>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white/80 mb-1">Step 2 — Backfill old leads</p>
                    <p className="mb-1">If you have leads in Funnel, make sure they are synced to HQ by hitting the Sync button in Funnel. It may take a few minutes for the sync to complete.</p>
                    <p className="mb-1">In HQ, go to <span className="font-medium text-gray-700 dark:text-white/70">Leads &gt;&gt; My Leads</span>. Use the filters if you don't want to export all of your leads. Once you have the leads you want, hit the <span className="font-medium text-gray-700 dark:text-white/70">Export Results</span> button (above and to the right of the top lead). Once the file is done building, hit the <span className="font-medium text-gray-700 dark:text-white/70">Download</span> button inside the purple box at the bottom of the page and save the file.</p>
                    <p>Use the <span className="font-medium text-gray-700 dark:text-white/70">Import</span> button at the top of this page to import the file you just saved.</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white/80 mb-1">Step 3 — Add analog leads</p>
                    <p>Analog leads will come into your inbox, but the notification email doesn't have phone numbers associated with the leads. Any time you have a batch of analog leads drop, repeat Step 2 above to import them.</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3">
                    <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">💡 Note</p>
                    <p className="text-amber-700 dark:text-amber-300/80">If you change the address your digital leads are being sent to you will need to enter the new address above.</p>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end shrink-0">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Lead Modal ────────────────────────────────────────────────────────────

const LEAD_EMPTY = {
  name: '', preferred_name: '', spouse_name: '',
  phone: '', email: '', state: '', zip: '',
  gender: '', age: '', lead_type: 'Life Insurance - Standard',
  coverage: '', motivation: '', beneficiary: '', employment: '', income: '',
  smoker: false, medical: false, hobby: '', source: 'referral', notes: '',
}

export function AddLeadModal({ onClose, onSave }) {
  const [form,   setForm]   = useState(LEAD_EMPTY)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await onSave({
        ...form,
        age:    form.age    ? parseInt(form.age) : null,
        smoker: !!form.smoker,
        medical: !!form.medical,
        state:  form.state.toUpperCase().slice(0, 2),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Save failed')
      }
    } catch (err) {
      setError(err.message || 'Unexpected error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Add New Lead</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Contact */}
          <ModalSection label="Contact Info">
            <div className="grid grid-cols-2 gap-3">
              <LF label="First / Full Name *" span={2}><input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" className={INPUT_CLS} /></LF>
              <LF label="Preferred Name"><input type="text" value={form.preferred_name} onChange={e => set('preferred_name', e.target.value)} placeholder="Jane" className={INPUT_CLS} /></LF>
              <LF label="Spouse Name"><input type="text" value={form.spouse_name} onChange={e => set('spouse_name', e.target.value)} placeholder="John Smith" className={INPUT_CLS} /></LF>
              <LF label="Phone"><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="555-555-5555" className={INPUT_CLS} /></LF>
              <LF label="Email"><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={INPUT_CLS} /></LF>
              <LF label="State"><input type="text" value={form.state} onChange={e => set('state', e.target.value)} placeholder="IN" maxLength={2} className={INPUT_CLS + ' uppercase'} /></LF>
              <LF label="Zip"><input type="text" value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="46000" maxLength={5} className={INPUT_CLS} /></LF>
              <LF label="Gender">
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option>Male</option><option>Female</option><option>Other</option>
                </select>
              </LF>
              <LF label="Age"><input type="number" value={form.age} onChange={e => set('age', e.target.value)} placeholder="45" min={18} max={99} className={INPUT_CLS} /></LF>
            </div>
          </ModalSection>

          {/* Campaign */}
          <ModalSection label="Campaign & Coverage">
            <div className="grid grid-cols-2 gap-3">
              <LF label="Campaign" span={2}>
                <select value={form.lead_type} onChange={e => set('lead_type', e.target.value)} className={SELECT_CLS}>
                  <option>Life Insurance - Standard</option>
                  <option>Life Insurance - Premium</option>
                  <option>Mortgage Protection</option>
                </select>
              </LF>
              <LF label="Coverage Amount" span={2}>
                <select value={form.coverage} onChange={e => set('coverage', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option>Under $100,000</option><option>$100,001-$250,000</option>
                  <option>$250,001-$500,000</option><option>$500,001-$1,000,000</option>
                  <option>More Than $1,000,000</option>
                  <option>Under $1,500/mo</option><option>$1,500-$2,499/mo</option>
                  <option>$2,500-$3,499/mo</option><option>$3,500+/mo</option>
                </select>
              </LF>
              <LF label="Motivation" span={2}>
                <select value={form.motivation} onChange={e => set('motivation', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option>Burdening family financially</option><option>Unable to pay mortgage</option>
                  <option>Losing current lifestyle</option><option>Draining retirement savings</option>
                  <option>Losing the family home</option><option>Leaving partner with unpayable mortgage</option>
                </select>
              </LF>
              <LF label="Beneficiary" span={2}>
                <select value={form.beneficiary} onChange={e => set('beneficiary', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option>Husband or Wife</option><option>Children or Step-Children</option>
                  <option>Grandchildren</option><option>Other Relative or Friend</option>
                  <option>Church or Charity</option>
                </select>
              </LF>
            </div>
          </ModalSection>

          {/* Employment */}
          <ModalSection label="Employment & Income">
            <div className="grid grid-cols-2 gap-3">
              <LF label="Employment">
                <select value={form.employment} onChange={e => set('employment', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option>Employed Full-Time</option><option>Employed Part-Time</option>
                  <option>Self-Employed</option><option>Retired</option><option>Other</option>
                </select>
              </LF>
              <LF label="Income Source">
                <select value={form.income} onChange={e => set('income', e.target.value)} className={SELECT_CLS}>
                  <option value="">N/A</option>
                  <option value="SSI">SSI</option><option value="SSDI">SSDI</option>
                </select>
              </LF>
            </div>
          </ModalSection>

          {/* Health */}
          <ModalSection label="Health">
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={!!form.smoker} onChange={e => set('smoker', e.target.checked)} className="w-4 h-4 rounded accent-accent" />
                <span className="text-sm text-gray-700 dark:text-white/70">Smoker</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={!!form.medical} onChange={e => set('medical', e.target.checked)} className="w-4 h-4 rounded accent-accent" />
                <span className="text-sm text-gray-700 dark:text-white/70">Major Medical History</span>
              </label>
            </div>
          </ModalSection>

          {/* Other */}
          <ModalSection label="Other">
            <div className="grid grid-cols-2 gap-3">
              <LF label="Hobby / Security Word" span={2}><input type="text" value={form.hobby} onChange={e => set('hobby', e.target.value)} placeholder="e.g. Fishing…" className={INPUT_CLS} /></LF>
              <LF label="Lead Source">
                <select value={form.source} onChange={e => set('source', e.target.value)} className={SELECT_CLS}>
                  <option value="">—</option>
                  <option value="referral">Referral</option>
                  <option value="symmetry">Symmetry</option>
                  <option value="razor_ridge">Razor Ridge</option>
                  <option value="lighthouse">Lighthouse</option>
                  <option value="level_up">Level Up</option>
                  <option value="reset">FIF Reset</option>
                  <option value="external">External</option>
                  <option value="other">Other</option>
                </select>
              </LF>
            </div>
            <div className="mt-3">
              <LF label="Notes">
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Additional details…" className={INPUT_CLS + ' resize-y'} />
              </LF>
            </div>
          </ModalSection>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors">{saving ? 'Saving…' : 'Add Lead'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Script Modal ──────────────────────────────────────────────────────────

export function AddScriptModal({ onClose, onSave, showFormatHint = false }) {
  const [form,   setForm]   = useState({ category: 'General', title: '', body: '', tag: '' })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) { setError('Title and body are required'); return }
    setSaving(true)
    const res = await onSave(form)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Save failed') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Add Script / Template</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <LF label="Category"><input type="text" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. First Contact, Objections…" className={INPUT_CLS} /></LF>
          <div className="grid grid-cols-2 gap-3">
            <LF label="Title *"><input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Script name" className={INPUT_CLS} /></LF>
            <LF label="Tag (optional)"><input type="text" value={form.tag} onChange={e => set('tag', e.target.value)} placeholder="SMS / CALL / Day 1…" className={INPUT_CLS} /></LF>
          </div>
          <LF label="Body *">
            <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={7} placeholder="Script / template text…" className={INPUT_CLS + ' resize-y'} />
            {showFormatHint && (
              <p className="mt-1 text-xs text-gray-400 dark:text-white/30">
                Formatting for the script pane: <code># Heading</code>, <code>## Subheading</code>, <code>1. numbered</code>, <code>- bullet</code>, <code>&gt; tip</code>, and <code>[stage direction]</code> in italics.
              </p>
            )}
          </LF>
          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors">{saving ? 'Saving…' : 'Save Script'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared primitives ─────────────────────────────────────────────────────────

export function StatusPill({ status, statuses = STATUSES }) {
  const sMap = Object.fromEntries(statuses.map(s => [s.key, s]))
  const s    = sMap[status] ?? statuses[0]
  return <span className={`inline-flex text-xs font-bold px-2 py-0.5 rounded-full border ${s.pill}`}>{s.label}</span>
}

function SectionLabel({ children }) {
  return <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-white/30 mb-2">{children}</p>
}

function InfoItem({ label, value, small }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/30 mb-0.5">{label}</p>
      <p className={`font-semibold text-gray-800 dark:text-white/80 ${small ? 'text-xs break-all' : 'text-xs'}`}>{value || '—'}</p>
    </div>
  )
}

/** Form field label wrapper */
function LF({ label, span, children }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <label className={LABEL_CLS}>{label}</label>
      {children}
    </div>
  )
}

function ModalSection({ label, children }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-accent/70 mb-2">{label}</p>
      {children}
    </div>
  )
}
