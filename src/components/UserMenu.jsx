import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

// Sections available for delegation (maps to assistant_permissions.section values)
const SECTIONS = [
  { key: 'onboarding',        label: 'Onboarding & Agents' },
  { key: 'apps_and_policies', label: 'Policies & Apps'     },
  { key: 'metrics',           label: 'Metrics'             },
]

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
            <DropItem onClick={onSignOut} danger>
              <SignOutIcon /> Sign out
            </DropItem>
          </div>
        )}
      </div>

      {modal === 'profile'    && <ProfileModal    userProfile={userProfile} onClose={() => setModal(null)} />}
      {modal === 'delegation' && <DelegationModal userProfile={userProfile} onClose={() => setModal(null)} />}
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
    </Modal>
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
              <DelegationRow key={d.id} delegation={d} onRevoke={() => revoke(d.id)} />
            ))}
          </div>
        )}

        {/* Add form */}
        {showAdd ? (
          <AddDelegationForm
            agentSfgId={userProfile.sfg_id}
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

function DelegationRow({ delegation, onRevoke }) {
  const granted = delegation.assistant_permissions
    ?.filter(p => p.can_read)
    .map(p => SECTIONS.find(s => s.key === p.section)?.label)
    .filter(Boolean) ?? []

  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-primary/10 dark:border-white/10 bg-primary/[0.02] dark:bg-white/[0.02]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{delegation.assistantName}</p>
        <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
          {granted.length ? granted.join(' · ') : 'No sections granted'}
        </p>
      </div>
      <button
        onClick={onRevoke}
        className="flex-shrink-0 text-xs text-accent hover:text-accent-dark transition-colors"
      >
        Revoke
      </button>
    </div>
  )
}

function AddDelegationForm({ agentSfgId, onSaved, onCancel }) {
  const [tab, setTab]             = useState('sfg') // 'sfg' | 'email'
  const [sections, setSections]   = useState({ onboarding: false, apps_and_policies: false, metrics: false })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  function toggleSection(key) { setSections(s => ({ ...s, [key]: !s[key] })) }

  const selectedSections = Object.entries(sections).filter(([, v]) => v).map(([k]) => k)

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
          sections={sections}
          selectedSections={selectedSections}
          onToggleSection={toggleSection}
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
          sections={sections}
          selectedSections={selectedSections}
          onToggleSection={toggleSection}
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

function SfgLookupTab({ agentSfgId, sections, selectedSections, onToggleSection, saving, setSaving, error, setError, onSaved, onCancel }) {
  const [sfgId, setSfgId]         = useState('')
  const [lookupResult, setLookup] = useState(null)
  const [looking, setLooking]     = useState(false)

  async function handleLookup() {
    const id = sfgId.trim().toUpperCase()
    if (!id) return
    setLooking(true)
    setLookup(null)
    setError(null)

    const { data: person } = await supabase
      .from('personnel')
      .select('sfg_id, preferred_name, opt_name')
      .ilike('sfg_id', id)
      .maybeSingle()

    if (!person) { setLookup({ found: false }); setLooking(false); return }

    const { data: user } = await supabase
      .from('users')
      .select('sfg_id, full_name')
      .eq('sfg_id', person.sfg_id)
      .maybeSingle()

    setLookup({
      found:      true,
      sfgId:      person.sfg_id,
      name:       user?.full_name || person.preferred_name || person.opt_name || person.sfg_id,
      hasAccount: !!user,
    })
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
            : !lookupResult.hasAccount ? `${lookupResult.name} — not yet registered. Use Email Invite instead.`
            : lookupResult.name}
        </div>
      )}

      {lookupResult?.found && lookupResult?.hasAccount && (
        <SectionPicker sections={sections} onToggle={onToggleSection} />
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

function EmailInviteTab({ agentSfgId, sections, selectedSections, onToggleSection, saving, setSaving, error, setError, onSaved, onCancel }) {
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
      <SectionPicker sections={sections} onToggle={onToggleSection} />
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

function SectionPicker({ sections, onToggle }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-white/50">Grant read access to:</p>
      {SECTIONS.map(s => (
        <label key={s.key} className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={sections[s.key]}
            onChange={() => onToggle(s.key)}
            className="w-4 h-4 rounded accent-accent cursor-pointer"
          />
          <span className="text-sm text-gray-700 dark:text-white/70">{s.label}</span>
        </label>
      ))}
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
