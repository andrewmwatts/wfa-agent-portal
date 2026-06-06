import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

// ─── Shared styles ─────────────────────────────────────────────────────────────
const TH  = 'text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 pb-2 pr-4 whitespace-nowrap'
const TD  = 'py-2.5 pr-4 text-sm text-gray-700 dark:text-white/70 align-top'
const BTN = 'px-3 py-1 text-xs font-semibold rounded-lg transition-colors'
const INP = 'w-full text-sm rounded-lg px-3 py-2 border bg-white dark:bg-white/5 text-gray-800 dark:text-white border-gray-200 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60'
const LBL = 'block text-xs font-medium text-gray-500 dark:text-white/50 mb-1'

const TABS = [
  { key: 'users',    label: 'User Management'       },
  { key: 'bugs',     label: 'Bug Reports'           },
  { key: 'crosswalk',label: 'Policy Crosswalk'      },
  { key: 'agencies', label: 'Agency Settings'       },
  { key: 'errors',   label: 'Parse Errors'          },
  { key: 'messages', label: 'System Messages'       },
]

const PORTAL_PAGES = [
  'Dashboard','Policies','Lapse','Activity Tracking','Leads','Recruiting',
  'Monthly Metrics','Weekly Metrics','Carrier Metrics',
  'Monthly Agent Totals','Contracting','Accountability','Coaching','Snapshot','Agents',
  'Admin Tools','Other',
]

const SUBTYPES = [
  'Accidental','Health','Disability / Annuity','Children\'s','Instant Issue',
  'Instant/Simplified','IUL','Medical','Simplified','Simplified/Medical',
]

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateTime(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminToolsPage() {
  const { userProfile, session } = useAuth()
  const [tab, setTab] = useState('users')

  if (userProfile && userProfile.role !== 'super_admin') {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-500">Access denied — super_admin only.</p>
      </main>
    )
  }

  function ah() {
    const h = { 'Content-Type': 'application/json' }
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
    return h
  }

  async function adminFetch(action, method = 'GET', bodyObj, qs = '') {
    const opts = { method, headers: ah() }
    if (bodyObj) opts.body = JSON.stringify(bodyObj)
    const res = await fetch(`/api/admin?action=${action}${qs}`, opts)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `${res.status}`)
    return data
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-5">Admin Tools</h1>

      {/* Tab bar */}
      <div className="flex gap-0.5 mb-6 border-b border-gray-200 dark:border-white/10 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
              tab === t.key
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'users'     && <UserManagementTab     adminFetch={adminFetch} />}
      {tab === 'bugs'      && <BugReportsTab         adminFetch={adminFetch} />}
      {tab === 'crosswalk' && <PolicyCrosswalkTab    adminFetch={adminFetch} />}
      {tab === 'agencies'  && <AgencySettingsTab     adminFetch={adminFetch} />}
      {tab === 'errors'    && <ParseErrorsTab        adminFetch={adminFetch} />}
      {tab === 'messages'  && <SystemMessagesTab     adminFetch={adminFetch} />}
    </main>
  )
}

// ─── Card shell ────────────────────────────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

function Err({ msg }) {
  if (!msg) return null
  return <p className="text-xs text-red-500 mt-1">{msg}</p>
}

// ─── Tool 1: User Management ───────────────────────────────────────────────────

function UserManagementTab({ adminFetch }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [search,  setSearch]  = useState('')
  const [editing, setEditing] = useState(null)  // user id
  const [draft,   setDraft]   = useState({})
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [resetLink, setResetLink] = useState(null)
  const [confirm,   setConfirm]   = useState(null) // { type, id, payload }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const d = await adminFetch('users'); setUsers(d.users ?? []) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [adminFetch])

  useEffect(() => { load() }, [load])

  const filtered = users.filter(u =>
    !search || [u.preferred_name, u.sfg_id, u.email].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )

  function startEdit(u) {
    setEditing(u.id)
    setDraft({ email: u.email || '', leads_email: u.leads_email || '', role: u.role || 'agent', agency_owner: u.agency_owner || '' })
    setSaveErr('')
  }

  async function saveEdit(u) {
    if (draft.role === 'super_admin' && u.role !== 'super_admin' && !confirm) {
      setConfirm({ type: 'promote', id: u.id, payload: draft }); return
    }
    setSaving(true); setSaveErr('')
    try {
      await adminFetch('user', 'PATCH', { id: u.id, ...draft })
      setEditing(null); load()
    } catch (e) { setSaveErr(e.message) }
    finally { setSaving(false) }
  }

  async function resetPassword(u) {
    try {
      const d = await adminFetch('reset-password', 'POST', { email: u.email })
      setResetLink({ email: u.email, link: d.link })
    } catch (e) { alert(e.message) }
  }

  async function toggleActive(u) {
    try { await adminFetch('user', 'PATCH', { id: u.id, is_active: !u.is_active }); load() }
    catch (e) { alert(e.message) }
  }

  if (loading) return <p className="text-sm text-gray-400 dark:text-white/40">Loading…</p>
  if (error)   return <p className="text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, SFG ID, email…"
          className={INP + ' max-w-sm'} />
        <span className="text-xs text-gray-400 dark:text-white/40">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-100 dark:border-white/10">
              <tr className="px-4">
                {['Name','SFG ID','Email','Role','Agency Owner','Leads Email','Last Sign In',''].map(h => (
                  <th key={h} className={TH + ' first:pl-4 last:pr-4'}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {filtered.map(u => (
                <tr key={u.id} className={`${u.is_active === false ? 'opacity-50' : ''}`}>
                  {editing === u.id ? (
                    <>
                      <td className={TD + ' pl-4 font-medium'}>{u.preferred_name}</td>
                      <td className={TD}><span className="font-mono text-xs">{u.sfg_id}</span></td>
                      <td className={TD}>
                        <input value={draft.email} onChange={e => setDraft(d => ({...d, email: e.target.value}))}
                          className={INP + ' text-xs py-1 min-w-[160px]'} />
                      </td>
                      <td className={TD}>
                        <select value={draft.role} onChange={e => setDraft(d => ({...d, role: e.target.value}))}
                          className={INP + ' text-xs py-1'}>
                          {['agent','leader','owner','director','super_admin'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className={TD}>
                        <input value={draft.agency_owner} onChange={e => setDraft(d => ({...d, agency_owner: e.target.value}))}
                          className={INP + ' text-xs py-1 w-28'} placeholder="SFG ID" />
                      </td>
                      <td className={TD}>
                        <input value={draft.leads_email} onChange={e => setDraft(d => ({...d, leads_email: e.target.value}))}
                          className={INP + ' text-xs py-1 min-w-[140px]'} />
                      </td>
                      <td className={TD}>{fmtDateTime(u.last_sign_in_at)}</td>
                      <td className={TD + ' pr-4'}>
                        <div className="flex gap-1 items-center flex-wrap">
                          <button onClick={() => saveEdit(u)} disabled={saving}
                            className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>Save</button>
                          <button onClick={() => setEditing(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50'}>Cancel</button>
                          <Err msg={saveErr} />
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={TD + ' pl-4 font-medium'}>{u.preferred_name}</td>
                      <td className={TD}><span className="font-mono text-xs">{u.sfg_id}</span></td>
                      <td className={TD + ' text-xs'}>{u.email || '—'}</td>
                      <td className={TD}>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          u.role === 'super_admin' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' :
                          u.role === 'director'    ? 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' :
                          u.role === 'owner'       ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' :
                          'bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-white/50'
                        }`}>{u.role}</span>
                      </td>
                      <td className={TD + ' text-xs'}>{u.agency_owner_name || '—'}</td>
                      <td className={TD + ' text-xs'}>{u.leads_email || '—'}</td>
                      <td className={TD + ' text-xs'}>{fmtDateTime(u.last_sign_in_at)}</td>
                      <td className={TD + ' pr-4'}>
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => startEdit(u)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'}>Edit</button>
                          <button onClick={() => resetPassword(u)} className={BTN + ' border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'}>Reset PW</button>
                          <button onClick={() => toggleActive(u)} className={BTN + ` border text-xs ${u.is_active === false ? 'border-green-200 text-green-700 dark:border-green-500/30 dark:text-green-400 hover:bg-green-50' : 'border-red-200 text-red-600 dark:border-red-500/30 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'}`}>
                            {u.is_active === false ? 'Reactivate' : 'Deactivate'}
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Reset PW link dialog */}
      {resetLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h3 className="text-sm font-bold mb-3">Password Reset Link — {resetLink.email}</h3>
            <p className="text-xs text-gray-500 dark:text-white/50 mb-2">Share this link with the user. It expires after one use.</p>
            <textarea readOnly value={resetLink.link || 'No link returned — check Supabase email settings.'}
              rows={3} className={INP + ' text-xs font-mono resize-none'} onClick={e => e.target.select()} />
            <button onClick={() => setResetLink(null)} className={BTN + ' mt-3 bg-accent text-white hover:bg-accent/90'}>Done</button>
          </div>
        </div>
      )}

      {/* Super-admin promotion confirm */}
      {confirm?.type === 'promote' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-sm font-bold text-red-600 mb-2">Promote to super_admin?</h3>
            <p className="text-xs text-gray-500 dark:text-white/50 mb-4">This grants full admin access to all portal data and settings.</p>
            <div className="flex gap-2">
              <button onClick={async () => {
                const u = users.find(x => x.id === confirm.id)
                setConfirm(null)
                setSaving(true)
                try { await adminFetch('user', 'PATCH', { id: confirm.id, ...confirm.payload }); setEditing(null); load() }
                catch (e) { setSaveErr(e.message) }
                finally { setSaving(false) }
              }} className={BTN + ' bg-red-600 text-white hover:bg-red-700'}>Confirm</button>
              <button onClick={() => setConfirm(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tool 2: Bug Reports ───────────────────────────────────────────────────────

function BugReportsTab({ adminFetch }) {
  const [reports, setReports]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAll, setShowAll]   = useState(false)
  const [editNotes, setEditNotes] = useState({}) // id → notes draft
  const [saving,    setSaving]    = useState({})
  const intervalRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const d = await adminFetch('bug-reports', 'GET', null, showAll ? '&all=true' : '')
      setReports(d.reports ?? [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [adminFetch, showAll])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    intervalRef.current = setInterval(load, 60000)
    return () => clearInterval(intervalRef.current)
  }, [load])

  async function updateStatus(id, status) {
    setSaving(s => ({...s, [id]: true}))
    try { await adminFetch('bug-report', 'PATCH', { id, status }); load() }
    catch (e) { alert(e.message) }
    finally { setSaving(s => ({...s, [id]: false})) }
  }

  async function saveNotes(id) {
    setSaving(s => ({...s, [id]: true}))
    try { await adminFetch('bug-report', 'PATCH', { id, admin_notes: editNotes[id] }); load() }
    catch (e) { alert(e.message) }
    finally { setSaving(s => ({...s, [id]: false})) }
  }

  async function deleteReport(id) {
    if (!confirm('Delete this bug report?')) return
    try { await adminFetch('bug-report', 'DELETE', { id }); load() }
    catch (e) { alert(e.message) }
  }

  const STATUS_PILL = {
    'Open':        'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    'In Progress': 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    'Resolved':    'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-white/60 cursor-pointer select-none">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-accent" />
          Show resolved
        </label>
        <button onClick={load} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50'}>Refresh</button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : reports.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-white/40">No reports.</p>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[r.status] ?? STATUS_PILL['Open']}`}>{r.status}</span>
                  <span className="text-xs text-gray-400 dark:text-white/30">{fmtDateTime(r.created_at)}</span>
                  {r.preferred_name && <span className="text-xs font-medium text-gray-600 dark:text-white/60">{r.preferred_name}</span>}
                  {r.page && <span className="text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40 px-1.5 py-0.5 rounded">{r.page}</span>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {r.status !== 'In Progress' && <button onClick={() => updateStatus(r.id, 'In Progress')} disabled={saving[r.id]} className={BTN + ' border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs'}>In Progress</button>}
                  {r.status !== 'Resolved'    && <button onClick={() => updateStatus(r.id, 'Resolved')}    disabled={saving[r.id]} className={BTN + ' border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 text-xs'}>Resolve</button>}
                  <button onClick={() => deleteReport(r.id)} className={BTN + ' border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs'}>Delete</button>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-white/70 mb-3">{r.description}</p>
              <div>
                <label className={LBL}>Admin Notes</label>
                <div className="flex gap-2">
                  <input
                    value={editNotes[r.id] ?? (r.admin_notes || '')}
                    onChange={e => setEditNotes(n => ({...n, [r.id]: e.target.value}))}
                    className={INP + ' text-xs py-1.5'} placeholder="Internal notes…"
                  />
                  {(editNotes[r.id] !== undefined && editNotes[r.id] !== (r.admin_notes || '')) && (
                    <button onClick={() => saveNotes(r.id)} disabled={saving[r.id]} className={BTN + ' bg-accent text-white hover:bg-accent/90 whitespace-nowrap'}>Save</button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tool 3: Policy Crosswalk Editor ──────────────────────────────────────────

function PolicyCrosswalkTab({ adminFetch }) {
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('')
  const [newRow,   setNewRow]   = useState(null)   // null | { carrier, policy_name, subtype }
  const [editing,  setEditing]  = useState(null)   // key | null
  const [editDraft, setEditDraft] = useState({})
  const [saving,   setSaving]   = useState(false)

  const load = useCallback(async () => {
    try { const d = await adminFetch('crosswalk'); setRows(d.rows ?? []) }
    catch { /* silent */ } finally { setLoading(false) }
  }, [adminFetch])

  useEffect(() => { load() }, [load])

  const key = r => `${r.carrier}||${r.policy_name}`

  const carriers = [...new Set(rows.map(r => r.carrier))].sort()
  const filteredCarriers = filter ? carriers.filter(c => c.toLowerCase().includes(filter.toLowerCase())) : carriers

  async function saveNew() {
    if (!newRow?.carrier || !newRow?.policy_name || !newRow?.subtype) { alert('All fields required'); return }
    setSaving(true)
    try { await adminFetch('crosswalk', 'PUT', newRow); setNewRow(null); load() }
    catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function saveEdit(original) {
    setSaving(true)
    try {
      await adminFetch('crosswalk', 'PUT', {
        ...editDraft,
        old_carrier: original.carrier, old_policy_name: original.policy_name,
      })
      setEditing(null); load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  async function deleteRow(r) {
    const d = await adminFetch('crosswalk', 'DELETE', { carrier: r.carrier, policy_name: r.policy_name })
    if (d.usageCount > 0) {
      if (!confirm(`This combination exists in ${d.usageCount} active policies. Delete anyway?`)) return
    }
    load()
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by carrier…" className={INP + ' max-w-xs'} />
        <button onClick={() => setNewRow({ carrier: '', policy_name: '', subtype: SUBTYPES[0] })}
          className={BTN + ' bg-accent text-white hover:bg-accent/90'}>+ Add Row</button>
      </div>

      {newRow && (
        <Card className="p-4">
          <p className={LBL + ' mb-3 text-accent'}>New Row</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><label className={LBL}>Carrier</label>
              <input value={newRow.carrier} onChange={e => setNewRow(r => ({...r, carrier: e.target.value}))} className={INP} /></div>
            <div><label className={LBL}>Policy Name</label>
              <input value={newRow.policy_name} onChange={e => setNewRow(r => ({...r, policy_name: e.target.value}))} className={INP} /></div>
            <div><label className={LBL}>Subtype</label>
              <select value={newRow.subtype} onChange={e => setNewRow(r => ({...r, subtype: e.target.value}))} className={INP}>
                {SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveNew} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>Save</button>
            <button onClick={() => setNewRow(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
          </div>
        </Card>
      )}

      {filteredCarriers.map(carrier => (
        <Card key={carrier}>
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
            <p className="text-xs font-semibold text-gray-600 dark:text-white/60">{carrier}</p>
          </div>
          <table className="w-full">
            <thead className="border-b border-gray-100 dark:border-white/10">
              <tr><th className={TH + ' pl-4'}>Policy Name</th><th className={TH}>Subtype</th><th className={TH + ' pr-4'}></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {rows.filter(r => r.carrier === carrier).map(r => (
                <tr key={key(r)}>
                  {editing === key(r) ? (
                    <>
                      <td className={TD + ' pl-4'}>
                        <input value={editDraft.carrier} onChange={e => setEditDraft(d => ({...d, carrier: e.target.value}))} className={INP + ' text-xs py-1'} /></td>
                      <td className={TD}><input value={editDraft.policy_name} onChange={e => setEditDraft(d => ({...d, policy_name: e.target.value}))} className={INP + ' text-xs py-1'} /></td>
                      <td className={TD}>
                        <select value={editDraft.subtype} onChange={e => setEditDraft(d => ({...d, subtype: e.target.value}))} className={INP + ' text-xs py-1'}>
                          {SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select></td>
                      <td className={TD + ' pr-4'}>
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(r)} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90'}>Save</button>
                          <button onClick={() => setEditing(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={TD + ' pl-4'}>{r.policy_name}</td>
                      <td className={TD}>{r.subtype}</td>
                      <td className={TD + ' pr-4'}>
                        <div className="flex gap-1">
                          <button onClick={() => { setEditing(key(r)); setEditDraft({...r}) }} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'}>Edit</button>
                          <button onClick={() => deleteRow(r)} className={BTN + ' border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'}>Delete</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  )
}

// ─── Tool 4: Agency Display Settings ─────────────────────────────────────────

function AgencySettingsTab({ adminFetch }) {
  const [agencies, setAgencies] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(null)  // owner sfg_id
  const [draft,    setDraft]    = useState({})
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  const load = useCallback(async () => {
    try { const d = await adminFetch('agencies'); setAgencies(d.agencies ?? []) }
    catch { /* silent */ } finally { setLoading(false) }
  }, [adminFetch])

  useEffect(() => { load() }, [load])

  function startEdit(a) {
    setEditing(a.sfg_id)
    setDraft({
      name:            a.agency?.name            ?? '',
      primary_color:   a.agency?.primary_color   ?? '#1a3a4a',
      secondary_color: a.agency?.secondary_color ?? '#0f2535',
      accent_color:    a.agency?.accent_color    ?? '#4a9ebb',
      logo_url_light:  a.agency?.logo_url_light  ?? '',
      logo_url_dark:   a.agency?.logo_url_dark   ?? '',
    })
    setErr('')
  }

  async function saveAgency(sfgId) {
    setSaving(true); setErr('')
    try { await adminFetch('agency', 'PUT', { owner_sfg_id: sfgId, ...draft }); setEditing(null); load() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-3">
      {agencies.map(a => (
        <Card key={a.sfg_id} className="p-4">
          {editing === a.sfg_id ? (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-800 dark:text-white">{a.preferred_name} <span className="text-gray-400 dark:text-white/30 font-normal text-xs">{a.sfg_id}</span></p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className={LBL}>Agency Name</label>
                  <input value={draft.name} onChange={e => setDraft(d => ({...d, name: e.target.value}))} className={INP} placeholder="Watts Family Agency" /></div>
                <div><label className={LBL}>Logo URL (Light mode)</label>
                  <input value={draft.logo_url_light} onChange={e => setDraft(d => ({...d, logo_url_light: e.target.value}))} className={INP} placeholder="https://…" /></div>
                <div><label className={LBL}>Logo URL (Dark mode)</label>
                  <input value={draft.logo_url_dark} onChange={e => setDraft(d => ({...d, logo_url_dark: e.target.value}))} className={INP} placeholder="https://…" /></div>
                {[['primary_color','Primary'],['secondary_color','Secondary'],['accent_color','Accent']].map(([k, label]) => (
                  <div key={k} className="flex items-end gap-2">
                    <div className="flex-1"><label className={LBL}>{label} Color</label>
                      <input value={draft[k]} onChange={e => setDraft(d => ({...d, [k]: e.target.value}))} className={INP} placeholder="#1a3a4a" /></div>
                    <input type="color" value={draft[k]} onChange={e => setDraft(d => ({...d, [k]: e.target.value}))}
                      className="h-10 w-10 rounded-lg border border-gray-200 dark:border-white/20 cursor-pointer p-0.5 bg-transparent" />
                  </div>
                ))}
              </div>
              {/* Preview swatch */}
              <div className="rounded-xl p-4 border border-gray-200 dark:border-white/10" style={{ background: draft.secondary_color }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-24 h-6 rounded" style={{ background: draft.primary_color }} />
                  <div className="w-16 h-6 rounded" style={{ background: draft.accent_color }} />
                </div>
                <p className="text-xs font-medium" style={{ color: draft.accent_color }}>Preview — {draft.name || 'Agency Name'}</p>
              </div>
              <Err msg={err} />
              <div className="flex gap-2">
                <button onClick={() => saveAgency(a.sfg_id)} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>Save</button>
                <button onClick={() => setEditing(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {(a.agency?.logo_url_dark || a.agency?.logo_url_light) ? (
                  <img src={a.agency.logo_url_dark || a.agency.logo_url_light} alt="logo" className="h-8 w-auto object-contain max-w-[80px] rounded" />
                ) : (
                  <div className="h-8 w-16 rounded bg-gray-100 dark:bg-white/10 flex items-center justify-center text-[9px] text-gray-400">No logo</div>
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{a.preferred_name}</p>
                  <p className="text-xs text-gray-400 dark:text-white/30">{a.sfg_id} · {a.agency?.name || 'No agency name'}</p>
                </div>
                <div className="flex gap-1.5">
                  {[a.agency?.primary_color, a.agency?.secondary_color, a.agency?.accent_color].map((c, i) =>
                    c ? <div key={i} className="w-5 h-5 rounded-full border border-white/20" style={{ background: c }} title={c} /> : null
                  )}
                </div>
              </div>
              <button onClick={() => startEdit(a)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5'}>Edit</button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

// ─── Tool 5: Parse Error Review ───────────────────────────────────────────────

function ParseErrorsTab({ adminFetch }) {
  const [errors,   setErrors]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showAll,  setShowAll]  = useState(false)
  const [expanded, setExpanded] = useState({})
  const [inserting, setInserting] = useState(null) // error row being manually inserted
  const [leadForm,  setLeadForm]  = useState({})
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await adminFetch('parse-errors', 'GET', null, showAll ? '&all=true' : '')
      setErrors(d.errors ?? [])
    } catch { /* silent */ } finally { setLoading(false) }
  }, [adminFetch, showAll])

  useEffect(() => { setLoading(true); load() }, [load])

  async function dismiss(id) {
    try { await adminFetch('resolve-parse-error', 'POST', { id }); load() }
    catch (e) { alert(e.message) }
  }

  function openInsert(err) {
    // Best-effort parse from body_snippet
    const snippet = err.body_snippet || ''
    const emailMatch = snippet.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
    const phoneMatch = snippet.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
    setInserting(err)
    setLeadForm({
      name: '', phone: phoneMatch?.[0] ?? '', email: emailMatch?.[0] ?? '',
      state: '', city: '', zip: '', lead_type: 'Life Insurance - Standard',
      source: 'email', sfg_id: '',
    })
  }

  async function submitInsert() {
    if (!leadForm.sfg_id?.trim()) { alert('SFG ID required (agent to assign lead to)'); return }
    if (!leadForm.name?.trim())   { alert('Name required'); return }
    setSaving(true)
    try {
      const leadRes = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...leadForm, category: 'personal' }),
      })
      if (!leadRes.ok) { const d = await leadRes.json(); throw new Error(d.error || 'Failed to insert lead') }
      await adminFetch('resolve-parse-error', 'POST', { id: inserting.id })
      setInserting(null); load()
    } catch (e) { alert(e.message) } finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-white/60 cursor-pointer select-none">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-accent" />
          Show resolved
        </label>
        <button onClick={load} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50'}>Refresh</button>
      </div>

      {errors.length === 0 ? <p className="text-sm text-gray-400 dark:text-white/40">No parse errors.</p> : (
        <div className="space-y-3">
          {errors.map(e => (
            <Card key={e.id} className="p-4">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-white/70">{e.sender}</p>
                  <p className="text-xs text-gray-500 dark:text-white/40">{e.subject}</p>
                  <p className="text-xs text-red-500 mt-0.5">Reason: {e.reason}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openInsert(e)} className={BTN + ' bg-accent text-white hover:bg-accent/90 text-xs'}>Manual Insert</button>
                  <button onClick={() => dismiss(e.id)}  className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50 text-xs'}>Dismiss</button>
                  <button onClick={() => setExpanded(x => ({...x, [e.id]: !x[e.id]}))}
                    className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-400 text-xs'}>
                    {expanded[e.id] ? 'Collapse' : 'View Body'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-white/30">{new Date(e.created_at).toLocaleString()}</p>
              {expanded[e.id] && (
                <pre className="mt-2 text-xs text-gray-600 dark:text-white/60 bg-gray-50 dark:bg-white/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64">
                  {e.body_snippet}
                </pre>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Manual insert modal */}
      {inserting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Manual Lead Insert</h3>
              <button onClick={() => setInserting(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/70 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto p-5 space-y-3">
              <p className="text-xs text-gray-400 dark:text-white/40">From: {inserting.sender}</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['sfg_id','Agent SFG ID','text',true],
                  ['name','Lead Name','text',true],
                  ['phone','Phone','text',false],
                  ['email','Email','email',false],
                  ['state','State','text',false],
                  ['city','City','text',false],
                  ['zip','ZIP','text',false],
                ].map(([k, label, type, required]) => (
                  <div key={k} className={k === 'sfg_id' || k === 'name' ? 'col-span-2' : ''}>
                    <label className={LBL}>{label}{required && ' *'}</label>
                    <input type={type} value={leadForm[k] ?? ''} onChange={e => setLeadForm(f => ({...f, [k]: e.target.value}))} className={INP} />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className={LBL}>Campaign</label>
                  <select value={leadForm.lead_type} onChange={e => setLeadForm(f => ({...f, lead_type: e.target.value}))} className={INP}>
                    <option>Life Insurance - Standard</option>
                    <option>Life Insurance - Premium</option>
                    <option>Mortgage Protection</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 dark:border-white/10 flex gap-2 shrink-0">
              <button onClick={submitInsert} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>
                {saving ? 'Inserting…' : 'Insert Lead & Dismiss Error'}
              </button>
              <button onClick={() => setInserting(null)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tool 6: System Messages ──────────────────────────────────────────────────

function SystemMessagesTab({ adminFetch }) {
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [form, setForm] = useState({
    message: '', audience: 'all', priority: 'Info',
    display_from: new Date().toISOString().slice(0, 16),
    display_until: '',
  })
  const [saving,   setSaving]   = useState(false)
  const [preview,  setPreview]  = useState(false)
  const [err,      setErr]      = useState('')

  const load = useCallback(async () => {
    try { const d = await adminFetch('system-messages-all'); setMessages(d.messages ?? []) }
    catch { /* silent */ } finally { setLoading(false) }
  }, [adminFetch])

  useEffect(() => { load() }, [load])

  async function sendMessage() {
    if (!form.message.trim()) { setErr('Message required'); return }
    setSaving(true); setErr('')
    try {
      await adminFetch('system-message', 'POST', {
        ...form,
        display_from:  form.display_from  ? new Date(form.display_from).toISOString()  : null,
        display_until: form.display_until ? new Date(form.display_until).toISOString() : null,
      })
      setForm({ message: '', audience: 'all', priority: 'Info', display_from: new Date().toISOString().slice(0, 16), display_until: '' })
      load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  async function deactivate(id) {
    try { await adminFetch('system-message', 'PATCH', { id, is_active: false }); load() }
    catch (e) { alert(e.message) }
  }

  const PRIORITY_STYLE = {
    'Info':     'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
    'Warning':  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
    'Critical': 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
  }

  const previewCls = PRIORITY_STYLE[form.priority] ?? PRIORITY_STYLE['Info']

  return (
    <div className="space-y-6">
      {/* Create form */}
      <Card className="p-5">
        <p className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-4">New Message</p>
        <div className="space-y-3">
          <div>
            <label className={LBL}>Message</label>
            <textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))}
              rows={3} className={INP + ' resize-y'} placeholder="Scheduled maintenance Sunday 2–4am ET…" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={LBL}>Audience</label>
              <select value={form.audience} onChange={e => setForm(f => ({...f, audience: e.target.value}))} className={INP}>
                <option value="all">All Users</option>
                <option value="role:owner">Owners</option>
                <option value="role:agent">Agents</option>
                <option value="role:leader">Leaders</option>
              </select>
            </div>
            <div>
              <label className={LBL}>Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))} className={INP}>
                <option>Info</option><option>Warning</option><option>Critical</option>
              </select>
            </div>
            <div>
              <label className={LBL}>Display From</label>
              <input type="datetime-local" value={form.display_from} onChange={e => setForm(f => ({...f, display_from: e.target.value}))} className={INP + ' dark:[color-scheme:dark]'} />
            </div>
            <div>
              <label className={LBL}>Display Until</label>
              <input type="datetime-local" value={form.display_until} onChange={e => setForm(f => ({...f, display_until: e.target.value}))} className={INP + ' dark:[color-scheme:dark]'} placeholder="Never" />
            </div>
          </div>

          {preview && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${previewCls}`}>
              <span className="font-semibold mr-2">{form.priority}:</span>{form.message || '(empty)'}
            </div>
          )}

          <Err msg={err} />
          <div className="flex gap-2">
            <button onClick={sendMessage} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>
              {saving ? 'Sending…' : 'Send Message'}
            </button>
            <button onClick={() => setPreview(p => !p)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>
              {preview ? 'Hide Preview' : 'Preview'}
            </button>
          </div>
        </div>
      </Card>

      {/* Active messages */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-3">All Messages</p>
        {loading ? <p className="text-sm text-gray-400">Loading…</p> : messages.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40">No messages.</p>
        ) : (
          <div className="space-y-2">
            {messages.map(m => (
              <Card key={m.id} className={`p-4 ${!m.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${PRIORITY_STYLE[m.priority] ?? PRIORITY_STYLE['Info']}`}>{m.priority}</span>
                      <span className="text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40 px-2 py-0.5 rounded">{m.audience}</span>
                      {!m.is_active && <span className="text-xs text-gray-400 dark:text-white/30">Inactive</span>}
                      <span className="text-xs text-gray-400 dark:text-white/30">
                        {fmtDateTime(m.display_from)}{m.display_until ? ` → ${fmtDateTime(m.display_until)}` : ' (no expiry)'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-white/70">{m.message}</p>
                  </div>
                  {m.is_active && (
                    <button onClick={() => deactivate(m.id)} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50 whitespace-nowrap shrink-0'}>Deactivate</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bug Report Modal (exported for use in nav/UserMenu) ───────────────────────

export function BugReportModal({ onClose, session }) {
  const [page, setPage]        = useState('')
  const [desc, setDesc]        = useState('')
  const [saving, setSaving]    = useState(false)
  const [done,   setDone]      = useState(false)
  const [err,    setErr]       = useState('')

  async function submit() {
    if (!desc.trim()) { setErr('Please describe the issue'); return }
    setSaving(true); setErr('')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await fetch('/api/admin?action=submit-bug-report', {
        method: 'POST', headers, body: JSON.stringify({ page, description: desc }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed')
      setDone(true)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Report a Bug</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white/70 text-lg leading-none">✕</button>
        </div>
        {done ? (
          <div className="p-5 text-center space-y-3">
            <p className="text-2xl">✓</p>
            <p className="text-sm font-medium text-green-600 dark:text-green-400">Bug report submitted. Thank you!</p>
            <button onClick={onClose} className={BTN + ' bg-accent text-white hover:bg-accent/90'}>Close</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className={LBL}>Page</label>
              <select value={page} onChange={e => setPage(e.target.value)} className={INP}>
                <option value="">— Select page —</option>
                {PORTAL_PAGES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={LBL}>Description *</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
                placeholder="Describe what happened and what you expected…" className={INP + ' resize-y'} autoFocus />
            </div>
            <Err msg={err} />
            <div className="flex gap-2">
              <button onClick={submit} disabled={saving} className={BTN + ' bg-accent text-white hover:bg-accent/90 disabled:opacity-50'}>
                {saving ? 'Submitting…' : 'Submit Report'}
              </button>
              <button onClick={onClose} className={BTN + ' border border-gray-200 dark:border-white/20 text-gray-500'}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
