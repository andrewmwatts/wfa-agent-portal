import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { BugReportModal } from '../pages/AdminToolsPage'
import { registerPushSubscription, unregisterPushSubscription } from '../utils/pushNotifications'

// Sections available for delegation (maps to assistant_permissions.section values)
const SECTIONS = [
  { key: 'onboarding',        label: 'Contracting & Agents' },
  { key: 'apps_and_policies', label: 'Apps & Policies'      },
  { key: 'metrics',           label: 'Metrics'              },
  { key: 'leads',             label: 'Leads'                },
  { key: 'recruiting',        label: 'Recruiting'           },
  { key: 'activity',          label: 'Activity'             },
  { key: 'income',            label: 'Income / Expenses'    },
  { key: 'accountability',    label: 'Accountability'       },
  { key: 'snapshot',          label: 'Promotions'           },
]

// Sections where write access can always be delegated (no admin grant needed)
const ALWAYS_WRITABLE = new Set(['leads', 'recruiting', 'income'])

// ── Main UserMenu ──────────────────────────────────────────────────────────────

export default function UserMenu({ userProfile, onSignOut }) {
  const { session, fetchAndSetProfile } = useAuth()
  const [open,           setOpen]           = useState(false)
  const [modal,          setModal]          = useState(null) // null | 'profile' | 'delegation'
  const [calToast,       setCalToast]       = useState(null) // null | 'connected' | 'error' | string
  const [calConnecting,  setCalConnecting]  = useState(false)
  const ref = useRef(null)

  // Handle post-OAuth redirect params (?calendar=connected or ?calendar=error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cal    = params.get('calendar')
    if (!cal) return

    // Clean the URL
    params.delete('calendar')
    params.delete('reason')
    const newSearch = params.toString()
    const newUrl    = window.location.pathname + (newSearch ? `?${newSearch}` : '')
    window.history.replaceState({}, '', newUrl)

    if (cal === 'connected') {
      setCalToast('connected')
      // Refresh profile so google_calendar_connected flips to true
      if (session?.user?.id) fetchAndSetProfile(session.user.id)
      setTimeout(() => setCalToast(null), 5000)
    } else if (cal === 'error') {
      setCalToast('error')
      setTimeout(() => setCalToast(null), 6000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    function handler(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function openModal(m) { setOpen(false); setModal(m) }

  async function connectCalendar() {
    if (!session?.access_token) return
    setCalConnecting(true)
    setOpen(false)
    try {
      const res  = await fetch('/api/google-auth', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error || 'Failed to get auth URL')
      window.location.href = data.url
    } catch (err) {
      setCalToast('error')
      setTimeout(() => setCalToast(null), 6000)
      setCalConnecting(false)
    }
  }

  async function disconnectCalendar() {
    if (!session?.access_token) return
    setOpen(false)
    try {
      await fetch('/api/google-calendar', {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (session?.user?.id) fetchAndSetProfile(session.user.id)
    } catch { /* ignore */ }
  }

  const calConnected = userProfile?.google_calendar_connected ?? false

  return (
    <>
      {/* Calendar toast */}
      {calToast && (
        <div className={`fixed bottom-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border ${
          calToast === 'connected'
            ? 'bg-green-50 text-green-800 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20'
            : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20'
        }`}>
          <span>{calToast === 'connected' ? '✅' : '❌'}</span>
          <span>
            {calToast === 'connected'
              ? 'Google Calendar connected!'
              : 'Google Calendar connection failed. Please try again.'}
          </span>
          <button onClick={() => setCalToast(null)} className="ml-1 opacity-60 hover:opacity-100 text-lg leading-none">✕</button>
        </div>
      )}

      <div className="relative" ref={ref}>
        {/* Trigger */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-primary/10 dark:hover:bg-white/10 transition-colors"
        >
          <span className="hidden sm:block text-sm text-gray-600 dark:text-white/70 truncate max-w-[160px]">
            {userProfile?.full_name ?? userProfile?.email}
          </span>
          <RoleBadge role={userProfile?.role} isAssistant={userProfile?.is_assistant} />
          <svg className="w-3 h-3 text-gray-400 dark:text-white/40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute right-0 mt-1.5 w-56 bg-white dark:bg-primary border border-primary/15 dark:border-white/10 rounded-xl shadow-xl py-1.5 z-50">
            <DropItem onClick={() => openModal('profile')}>
              <PersonIcon /> Profile
            </DropItem>
            <DropItem onClick={() => openModal('delegation')}>
              <DelegateIcon /> Access Delegation
            </DropItem>
            <div className="my-1 border-t border-gray-100 dark:border-white/10" />
            {calConnected ? (
              <DropItem onClick={disconnectCalendar}>
                <CalendarIcon />
                <span className="flex-1">Google Calendar</span>
                <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full border border-green-200 dark:border-green-500/20">Connected</span>
              </DropItem>
            ) : (
              <DropItem onClick={connectCalendar} disabled={calConnecting}>
                <CalendarIcon />
                {calConnecting ? 'Connecting…' : 'Connect Google Calendar'}
              </DropItem>
            )}
            <div className="my-1 border-t border-gray-100 dark:border-white/10" />
            <DropItem onClick={() => { setOpen(false); openModal('bug') }}>
              <BugIcon /> Report a Bug
            </DropItem>
            <div className="my-1 border-t border-gray-100 dark:border-white/10" />
            <DropItem onClick={onSignOut} danger>
              <SignOutIcon /> Sign out
            </DropItem>
          </div>
        )}
      </div>

      {modal === 'profile'    && <ProfileModal    userProfile={userProfile} onClose={() => setModal(null)} />}
      {modal === 'delegation' && <DelegationModal userProfile={userProfile} onClose={() => setModal(null)} />}
      {modal === 'bug'        && <BugReportModal  session={session} onClose={() => setModal(null)} />}
    </>
  )
}

// ── Dropdown item ──────────────────────────────────────────────────────────────

function DropItem({ onClick, danger, disabled, children }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors disabled:opacity-50
        ${danger
          ? 'text-accent hover:bg-accent/10'
          : 'text-gray-700 dark:text-white/70 hover:bg-primary/[0.06] dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white'
        }`}
    >
      {children}
    </button>
  )
}

// ── Modal shell ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white dark:bg-primary border border-primary/15 dark:border-white/10 rounded-2xl shadow-2xl w-full flex flex-col ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 dark:border-white/10 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[75vh]">{children}</div>
      </div>
    </div>
  )
}

// ── Profile modal ──────────────────────────────────────────────────────────────

function ProfileModal({ userProfile, onClose }) {
  const [fullName, setFullName] = useState(userProfile?.full_name ?? '')
  const [email, setEmail]       = useState(userProfile?.email ?? '')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [success, setSuccess]   = useState(false)

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updates = { full_name: fullName.trim() }
      const emailChanged = email.trim().toLowerCase() !== userProfile.email

      if (emailChanged) {
        const { error: authErr } = await supabase.auth.updateUser({ email: email.trim() })
        if (authErr) throw authErr
        updates.email = email.trim().toLowerCase()
      }

      const { error: dbErr } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userProfile.id)
      if (dbErr) throw dbErr

      setSuccess(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Profile" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4">
        <FormField label="Full Name">
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            className={inputCls}
            required
          />
        </FormField>
        <FormField label="Email">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={inputCls}
            required
          />
          {email.trim().toLowerCase() !== userProfile?.email && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              A confirmation link will be sent to the new address.
            </p>
          )}
        </FormField>
        <FormField label="SFG ID">
          <input value={userProfile?.sfg_id ?? '—'} disabled className={`${inputCls} opacity-50 cursor-not-allowed`} />
        </FormField>
        {error   && <p className="text-xs text-accent">{error}</p>}
        {success && <p className="text-xs text-green-600 dark:text-green-400">Saved!</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <div className="mt-5 pt-5 border-t border-gray-200 dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">Push Notifications</p>
        <NotificationsSection userProfile={userProfile} />
      </div>
    </Modal>
  )
}

// ── Notifications section (inside Profile modal) ───────────────────────────────

function NotificationsSection({ userProfile }) {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [registering, setRegistering] = useState(false)
  const [regError,    setRegError]    = useState(null)

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone
  const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window

  // Browser-level permission can be 'granted' even if our server-side save
  // previously failed (e.g. a transient DB error). Re-sync silently whenever
  // we render in the "granted" state so a past failure gets retried without
  // the user having to revoke and re-grant browser permission.
  useEffect(() => {
    if (permission !== 'granted' || !supported || (isIOS && !isPWA)) return
    registerPushSubscription(userProfile?.id, userProfile?.sfg_id).catch(e => {
      console.error('[push] re-sync failed:', e.message)
    })
  }, [permission]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEnable() {
    setRegistering(true)
    setRegError(null)
    try {
      const sub = await registerPushSubscription(userProfile?.id, userProfile?.sfg_id)
      if (sub) {
        setPermission('granted')
      } else {
        // Permission was denied or not granted
        setPermission(Notification.permission)
      }
    } catch (e) {
      setRegError(e.message)
    } finally {
      setRegistering(false)
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-gray-400 dark:text-white/40">
        Push notifications are not supported in this browser.
      </p>
    )
  }

  if (isIOS && !isPWA) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-gray-500 dark:text-white/50">
          To receive push notifications on iOS, add this app to your Home Screen first, then re-open it from there.
        </p>
      </div>
    )
  }

  if (permission === 'granted') {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <p className="text-xs text-green-700 dark:text-green-400">Push notifications enabled</p>
      </div>
    )
  }

  if (permission === 'denied') {
    return (
      <p className="text-xs text-gray-400 dark:text-white/40">
        Notifications blocked. Enable them in your browser settings to receive lead alerts.
      </p>
    )
  }

  // default — not yet asked
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-white/50">
        Get notified when a new lead is assigned to you.
      </p>
      {regError && <p className="text-xs text-accent">{regError}</p>}
      <button
        type="button"
        onClick={handleEnable}
        disabled={registering}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {registering ? 'Enabling…' : 'Enable Push Notifications'}
      </button>
    </div>
  )
}

// ── Delegation modal ───────────────────────────────────────────────────────────

function DelegationModal({ userProfile, onClose }) {
  const [delegations, setDelegations] = useState([])
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('agent_assistants')
      .select('id, assistant_sfg_id, assistant_permissions(section, can_read, can_write)')
      .eq('agent_sfg_id', userProfile.sfg_id)
      .eq('is_active', true)

    if (!data?.length) { setDelegations([]); setLoading(false); return }

    // Look up assistant names from users table
    const sfgIds = data.map(d => d.assistant_sfg_id).filter(Boolean)
    const { data: users } = await supabase
      .from('users')
      .select('sfg_id, full_name, email')
      .in('sfg_id', sfgIds)

    const nameMap = {}
    for (const u of (users ?? [])) nameMap[u.sfg_id] = u.full_name || u.email

    setDelegations(data.map(d => ({
      ...d,
      assistantName: nameMap[d.assistant_sfg_id] ?? d.assistant_sfg_id,
    })))
    setLoading(false)
  }, [userProfile.sfg_id])

  useEffect(() => { load() }, [load])

  async function revoke(id) {
    await fetch('/api/users?action=delegate', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDelegations(d => d.filter(x => x.id !== id))
  }

  return (
    <Modal title="Access Delegation" onClose={onClose} wide>
      <div className="space-y-5">
        <p className="text-sm text-gray-500 dark:text-white/50">
          Grant portal users read access to sections of your account. Delegates can view your data but cannot make changes.
        </p>

        {/* Existing delegations */}
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1,2].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-white/10 rounded-lg" />)}
          </div>
        ) : delegations.length === 0 && !showAdd ? (
          <p className="text-sm text-gray-400 dark:text-white/30 text-center py-4">No delegations set up yet.</p>
        ) : (
          <div className="space-y-2">
            {delegations.map(d => (
              <DelegationRow key={d.id} delegation={d} userProfile={userProfile} onRevoke={() => revoke(d.id)} onUpdated={load} />
            ))}
          </div>
        )}

        {/* Add form */}
        {showAdd ? (
          <AddDelegationForm
            agentSfgId={userProfile.sfg_id}
            userProfile={userProfile}
            onSaved={() => { setShowAdd(false); load() }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button onClick={() => setShowAdd(true)} className={btnPrimary}>
            + Add Delegation
          </button>
        )}
      </div>
    </Modal>
  )
}

function DelegationRow({ delegation, userProfile, onRevoke, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({})
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')

  const canWriteSections = new Set([
    ...ALWAYS_WRITABLE,
    ...(userProfile?.write_sections ?? []),
  ])

  function initDraft() {
    const base = Object.fromEntries(SECTIONS.map(s => [s.key, { read: false, write: false }]))
    for (const p of (delegation.assistant_permissions ?? [])) {
      if (base[p.section] !== undefined) base[p.section] = { read: !!p.can_read, write: !!p.can_write }
    }
    return base
  }

  function startEdit() { setDraft(initDraft()); setErr(''); setEditing(true) }

  async function saveEdit() {
    const sections = SECTIONS
      .filter(s => draft[s.key]?.read || draft[s.key]?.write)
      .map(s => ({ section: s.key, can_read: !!draft[s.key]?.read, can_write: !!draft[s.key]?.write }))
    setSaving(true); setErr('')
    const res = await fetch('/api/users?action=delegate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: delegation.id, sections }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? 'Save failed'); return }
    setEditing(false); onUpdated()
  }

  const granted = delegation.assistant_permissions
    ?.filter(p => p.can_read || p.can_write)
    .map(p => {
      const s = SECTIONS.find(x => x.key === p.section)
      if (!s) return null
      return p.can_write ? `${s.label} (R/W)` : s.label
    })
    .filter(Boolean) ?? []

  if (editing) {
    return (
      <div className="p-3 rounded-lg border border-accent/30 dark:border-accent/20 bg-accent/[0.03] space-y-3">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{delegation.assistantName}</p>
        <SectionPicker sectionPerms={draft} onToggle={(key, type) => setDraft(prev => {
          const curr = prev[key] ?? { read: false, write: false }
          if (type === 'read') {
            const newRead = !curr.read
            return { ...prev, [key]: { read: newRead, write: newRead ? curr.write : false } }
          }
          const newWrite = !curr.write
          return { ...prev, [key]: { read: newWrite ? true : curr.read, write: newWrite } }
        })} canWriteSections={canWriteSections} />
        {err && <p className="text-xs text-accent">{err}</p>}
        <div className="flex gap-2">
          <button onClick={saveEdit} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-primary/10 dark:border-white/10 bg-primary/[0.02] dark:bg-white/[0.02]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{delegation.assistantName}</p>
        <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
          {granted.length ? granted.join(' · ') : 'No sections granted'}
        </p>
      </div>
      <div className="flex gap-3 flex-shrink-0">
        <button onClick={startEdit} className="text-xs text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white transition-colors">Edit</button>
        <button onClick={onRevoke} className="text-xs text-accent hover:text-accent-dark transition-colors">Revoke</button>
      </div>
    </div>
  )
}

function AddDelegationForm({ agentSfgId, userProfile, onSaved, onCancel }) {
  const [tab,          setTab]         = useState('sfg')
  const [sectionPerms, setSectionPerms] = useState(
    Object.fromEntries(SECTIONS.map(s => [s.key, { read: false, write: false }]))
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const canWriteSections = new Set([...ALWAYS_WRITABLE, ...(userProfile?.write_sections ?? [])])

  function toggleSection(key, type) {
    setSectionPerms(prev => {
      const curr = prev[key]
      if (type === 'read') {
        const newRead = !curr.read
        return { ...prev, [key]: { read: newRead, write: newRead ? curr.write : false } }
      }
      const newWrite = !curr.write
      return { ...prev, [key]: { read: newWrite ? true : curr.read, write: newWrite } }
    })
  }

  const selectedSections = SECTIONS
    .filter(s => sectionPerms[s.key].read || sectionPerms[s.key].write)
    .map(s => ({ section: s.key, can_read: sectionPerms[s.key].read, can_write: sectionPerms[s.key].write }))

  return (
    <div className="border border-primary/15 dark:border-white/10 rounded-xl p-4 space-y-4 bg-primary/[0.02] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">New Delegation</p>
        {/* Tab toggle */}
        <div className="flex rounded-lg border border-primary/15 dark:border-white/10 overflow-hidden text-xs">
          {[['sfg', 'SFG ID'], ['email', 'Email Invite']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setError(null) }}
              className={`px-3 py-1 transition-colors ${
                tab === key
                  ? 'bg-accent text-white font-semibold'
                  : 'text-gray-500 dark:text-white/50 hover:bg-primary/[0.06] dark:hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'sfg' ? (
        <SfgLookupTab
          agentSfgId={agentSfgId}
          sectionPerms={sectionPerms}
          selectedSections={selectedSections}
          onToggleSection={toggleSection}
          canWriteSections={canWriteSections}
          saving={saving}
          setSaving={setSaving}
          error={error}
          setError={setError}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      ) : (
        <EmailInviteTab
          agentSfgId={agentSfgId}
          sectionPerms={sectionPerms}
          selectedSections={selectedSections}
          onToggleSection={toggleSection}
          canWriteSections={canWriteSections}
          saving={saving}
          setSaving={setSaving}
          error={error}
          setError={setError}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

function SfgLookupTab({ agentSfgId, sectionPerms, selectedSections, onToggleSection, canWriteSections, saving, setSaving, error, setError, onSaved, onCancel }) {
  const [sfgId, setSfgId]         = useState('')
  const [lookupResult, setLookup] = useState(null)
  const [looking, setLooking]     = useState(false)

  async function handleLookup() {
    const id = sfgId.trim().toUpperCase()
    if (!id) return
    setLooking(true)
    setLookup(null)
    setError(null)

    try {
      const res  = await fetch(`/api/users?action=lookup-delegate&sfg_id=${encodeURIComponent(id)}`)
      const data = await res.json()
      setLookup(data.found ? data : { found: false })
    } catch {
      setError('Lookup failed. Please try again.')
    }
    setLooking(false)
  }

  async function handleGrant() {
    if (!lookupResult?.found || !lookupResult?.hasAccount) return
    if (!selectedSections.length) { setError('Select at least one section.'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/users?action=delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_sfg_id: agentSfgId, assistant_sfg_id: lookupResult.sfgId, sections: selectedSections }),
    })
    if (!res.ok) {
      const { error: e } = await res.json().catch(() => ({}))
      setError(e ?? 'Failed to create delegation.')
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={sfgId}
          onChange={e => { setSfgId(e.target.value); setLookup(null) }}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleLookup())}
          placeholder="SFG ID"
          className={`${inputCls} flex-1`}
        />
        <button type="button" onClick={handleLookup} disabled={looking || !sfgId.trim()} className={`${btnSecondary} flex-shrink-0`}>
          {looking ? '…' : 'Look up'}
        </button>
      </div>

      {lookupResult && (
        <div className={`text-sm rounded-lg px-3 py-2 ${
          !lookupResult.found ? 'bg-accent/10 text-accent'
          : !lookupResult.hasAccount ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'bg-green-500/10 text-green-700 dark:text-green-300'
        }`}>
          {!lookupResult.found ? 'SFG ID not found.'
            : !lookupResult.hasAccount ? `${lookupResult.name} — user must be registered for portal first.`
            : lookupResult.name}
        </div>
      )}

      {lookupResult?.found && lookupResult?.hasAccount && (
        <SectionPicker sectionPerms={sectionPerms} onToggle={onToggleSection} canWriteSections={canWriteSections} />
      )}

      {error && <p className="text-xs text-accent">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
        {lookupResult?.found && lookupResult?.hasAccount && (
          <button type="button" onClick={handleGrant} disabled={saving} className={btnPrimary}>
            {saving ? 'Granting…' : 'Grant Access'}
          </button>
        )}
      </div>
    </div>
  )
}

function EmailInviteTab({ agentSfgId, sectionPerms, selectedSections, onToggleSection, canWriteSections, saving, setSaving, error, setError, onSaved, onCancel }) {
  const [email, setEmail]   = useState('')
  const [sent, setSent]     = useState(false)

  async function handleInvite() {
    if (!email.trim()) return
    if (!selectedSections.length) { setError('Select at least one section.'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/users?action=invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_sfg_id: agentSfgId, email: email.trim(), sections: selectedSections }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data.error === 'already_registered') {
        setError(`${data.name ?? email} already has a portal account. Use SFG ID delegation instead (${data.sfg_id}).`)
      } else {
        setError(data.error ?? 'Failed to send invite.')
      }
      setSaving(false)
      return
    }
    setSent(true)
    setSaving(false)
  }

  if (sent) {
    return (
      <div className="text-center py-4 space-y-3">
        <p className="text-sm text-green-700 dark:text-green-300">Invite sent to <strong>{email}</strong>.</p>
        <p className="text-xs text-gray-400 dark:text-white/40">They'll receive an email with a link to create their account.</p>
        <button type="button" onClick={onSaved} className={btnPrimary}>Done</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="name@example.com"
        className={inputCls}
      />
      <SectionPicker sectionPerms={sectionPerms} onToggle={onToggleSection} canWriteSections={canWriteSections} />
      {error && <p className="text-xs text-accent">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
        <button type="button" onClick={handleInvite} disabled={saving || !email.trim()} className={btnPrimary}>
          {saving ? 'Sending…' : 'Send Invite'}
        </button>
      </div>
    </div>
  )
}

function SectionPicker({ sectionPerms, onToggle, canWriteSections }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 mb-1.5 px-1">
        <span className="text-xs text-gray-400 dark:text-white/40">Section</span>
        <span className="text-xs text-gray-400 dark:text-white/40 w-8 text-center">Read</span>
        <span className="text-xs text-gray-400 dark:text-white/40 w-8 text-center">Write</span>
      </div>
      {SECTIONS.map(s => {
        const perms    = sectionPerms[s.key] ?? { read: false, write: false }
        const canWrite = canWriteSections.has(s.key)
        return (
          <div key={s.key} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-1 px-1">
            <span className="text-sm text-gray-700 dark:text-white/70">{s.label}</span>
            <div className="flex justify-center w-8">
              <input type="checkbox" checked={perms.read}
                onChange={() => onToggle(s.key, 'read')}
                className="w-4 h-4 accent-accent cursor-pointer" />
            </div>
            <div className="flex justify-center w-8">
              <input type="checkbox" checked={perms.write}
                onChange={() => onToggle(s.key, 'write')}
                disabled={!canWrite}
                title={canWrite ? '' : 'Write access not granted for this section'}
                className="w-4 h-4 accent-accent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Shared form helpers ────────────────────────────────────────────────────────

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls = [
  'w-full bg-gray-50 border border-primary/15 rounded-lg px-3 py-2 text-sm text-gray-900',
  'placeholder:text-gray-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50',
  'transition-colors',
].join(' ')

const btnPrimary = [
  'px-4 py-2 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-dark',
  'text-white transition-colors disabled:opacity-50',
].join(' ')

const btnSecondary = [
  'px-4 py-2 rounded-lg text-sm font-medium',
  'text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white',
  'border border-primary/15 dark:border-white/10 hover:border-primary/30 dark:hover:border-white/20',
  'transition-colors disabled:opacity-50',
].join(' ')

// ── Role badge (mirrors AppLayout version) ─────────────────────────────────────

function RoleBadge({ role, isAssistant }) {
  if (!role) return null
  const label = isAssistant ? 'Assistant' : {
    super_admin: 'Admin',
    director:    'Director',
    owner:       'Owner',
    leader:      'Leader',
    agent:       'Agent',
  }[role] ?? role
  return (
    <span className="hidden sm:inline-block text-xs bg-accent/20 text-accent font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
      {label}
    </span>
  )
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  )
}

function DelegateIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}
function BugIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  )
}
