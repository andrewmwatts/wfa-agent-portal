import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'

// ─── Bucket config ─────────────────────────────────────────────────────────────

const BUCKETS = [
  {
    key:       'gold',
    label:     'Gold',
    subtitle:  'Your core; work first',
    life_fit:  'high',
    relationship: 'high',
    headerCls: 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20',
    labelCls:  'text-yellow-700 dark:text-yellow-300',
    countCls:  'text-yellow-600 dark:text-yellow-400',
    chipCls:   'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/20',
    dot:       'bg-yellow-400',
  },
  {
    key:       'referral',
    label:     'Referral Pipeline',
    subtitle:  'Ask for referrals',
    life_fit:  'low',
    relationship: 'high',
    headerCls: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',
    labelCls:  'text-blue-700 dark:text-blue-300',
    countCls:  'text-blue-600 dark:text-blue-400',
    chipCls:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
    dot:       'bg-blue-400',
  },
  {
    key:       'earnin',
    label:     'Earn-In',
    subtitle:  'Build rapport first',
    life_fit:  'high',
    relationship: 'low',
    headerCls: 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20',
    labelCls:  'text-orange-700 dark:text-orange-300',
    countCls:  'text-orange-600 dark:text-orange-400',
    chipCls:   'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/20',
    dot:       'bg-orange-400',
  },
  {
    key:       'park',
    label:     'Park',
    subtitle:  'Not now',
    life_fit:  'low',
    relationship: 'low',
    headerCls: 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10',
    labelCls:  'text-gray-500 dark:text-white/50',
    countCls:  'text-gray-400 dark:text-white/30',
    chipCls:   'bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/5 dark:text-white/40 dark:border-white/10',
    dot:       'bg-gray-400',
  },
]

const BUCKET_ORDER = ['gold', 'referral', 'earnin', 'park']

function getBucket(entry) {
  return BUCKETS.find(b => b.life_fit === entry.life_fit && b.relationship === entry.relationship)
    ?? BUCKETS[0]
}

// ─── Shared input style ────────────────────────────────────────────────────────

const INPUT = 'text-sm rounded-lg px-2.5 py-1.5 border bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors'
const SELECT = INPUT + ' cursor-pointer'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Project100Page() {
  const { session } = useAuth()
  const { activeSubject, permissions } = useViewing()

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' }
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
    return h
  }

  const [entries,  setEntries]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [filter,   setFilter]   = useState(null) // bucket key or null = all
  const [editId,   setEditId]   = useState(null) // id of row being edited

  // Quick-add form state
  const [addForm, setAddForm] = useState({ name: '', phone: '', email: '', social_handle: '', life_fit: 'high', relationship: 'high' })
  const [adding,  setAdding]  = useState(false)
  const [addErr,  setAddErr]  = useState('')
  const nameRef = useRef(null)

  // Edit form state (keyed by field, set when editId changes)
  const [editForm, setEditForm] = useState({})

  const sfgId = activeSubject?.sfg_id

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!sfgId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/project-100?sfg_id=${encodeURIComponent(sfgId)}`, { headers: authHeaders() })
      if (res.ok) { const { entries: d } = await res.json(); setEntries(d ?? []) }
    } finally { setLoading(false) }
  }, [sfgId])

  useEffect(() => { load() }, [load])

  // ── Add ────────────────────────────────────────────────────────────────────

  async function handleAdd(e) {
    e.preventDefault()
    if (!addForm.name.trim()) { setAddErr('Name is required'); return }
    setAdding(true)
    setAddErr('')
    try {
      const res = await fetch('/api/project-100', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sfg_id: sfgId, ...addForm }),
      })
      if (res.ok) {
        const { entry } = await res.json()
        setEntries(prev => [...prev, entry])
        setAddForm({ name: '', phone: '', email: '', social_handle: '', life_fit: 'high', relationship: 'high' })
        nameRef.current?.focus()
      } else {
        const d = await res.json().catch(() => ({}))
        setAddErr(d.error || 'Failed to add')
      }
    } finally { setAdding(false) }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  function startEdit(entry) {
    setEditId(entry.id)
    setEditForm({
      name:          entry.name          || '',
      phone:         entry.phone         || '',
      email:         entry.email         || '',
      social_handle: entry.social_handle || '',
      life_fit:      entry.life_fit      || 'high',
      relationship:  entry.relationship  || 'high',
    })
  }

  async function saveEdit(id) {
    const res = await fetch(`/api/project-100?id=${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      const { entry } = await res.json()
      setEntries(prev => prev.map(e => e.id === id ? entry : e))
      setEditId(null)
    }
  }

  async function handleDelete(id) {
    await fetch(`/api/project-100?id=${id}`, { method: 'DELETE', headers: authHeaders() })
    setEntries(prev => prev.filter(e => e.id !== id))
    if (editId === id) setEditId(null)
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const total = entries.length
  const pct   = Math.min((total / 100) * 100, 100)

  const bucketCounts = useMemo(() => {
    const c = Object.fromEntries(BUCKETS.map(b => [b.key, 0]))
    for (const e of entries) c[getBucket(e).key]++
    return c
  }, [entries])

  const displayEntries = useMemo(() => {
    const list = filter ? entries.filter(e => getBucket(e).key === filter) : entries
    return [...list].sort((a, b) => {
      const ai = BUCKET_ORDER.indexOf(getBucket(a).key)
      const bi = BUCKET_ORDER.indexOf(getBucket(b).key)
      if (ai !== bi) return ai - bi
      return a.name.localeCompare(b.name)
    })
  }, [entries, filter])

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!permissions.project100?.read) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-red-500">You don't have access to this section.</p>
      </main>
    )
  }
  if (!activeSubject) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view Project 100.</p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-7">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Project 100</h1>
        <p className="text-sm text-gray-500 dark:text-white/50 mt-1">
          Warm market working list: build your list out to 100, then work the buckets
        </p>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400 dark:text-white/40 font-medium">Progress to 100</span>
          <span className="font-bold tabular-nums text-gray-700 dark:text-white/80">
            {total}<span className="text-gray-400 dark:text-white/30 font-normal">/100</span>
          </span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: pct >= 100 ? '#22c55e' : pct >= 50 ? 'var(--color-accent, #6366f1)' : '#f59e0b',
            }}
          />
        </div>
      </div>

      {/* Bucket matrix */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-3">
          Bucket matrix
          <span className="normal-case font-normal tracking-normal ml-2 text-gray-400 dark:text-white/30">
            · Relationship strength and life fit. Click a quadrant to filter.
          </span>
        </p>

        {/* Axis labels */}
        <div className="grid grid-cols-[1fr_1fr] gap-0 mb-1">
          <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">Life fit: High</div>
          <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">Life fit: Low</div>
        </div>

        <div className="grid grid-cols-2 gap-2 relative">
          {/* Row labels */}
          <div className="absolute -left-14 top-0 bottom-0 flex flex-col pointer-events-none select-none">
            <div className="flex-1 flex items-center justify-end pr-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30 -rotate-90 whitespace-nowrap">Relationship: High</span>
            </div>
            <div className="flex-1 flex items-center justify-end pr-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30 -rotate-90 whitespace-nowrap">Relationship: Low</span>
            </div>
          </div>

          {/* Gold — top-left */}
          {[BUCKETS[0], BUCKETS[1], BUCKETS[2], BUCKETS[3]].map(b => (
            <button
              key={b.key}
              onClick={() => setFilter(f => f === b.key ? null : b.key)}
              className={`rounded-xl border p-4 text-left transition-all ${b.headerCls} ${
                filter === b.key ? 'ring-2 ring-accent shadow-md' : 'hover:shadow-sm hover:opacity-90'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-sm font-bold ${b.labelCls}`}>{b.label}</p>
                  <p className="text-[11px] text-gray-500 dark:text-white/40 mt-0.5">{b.subtitle}</p>
                </div>
                <span className={`text-2xl font-extrabold tabular-nums ${b.countCls}`}>
                  {bucketCounts[b.key]}
                </span>
              </div>
            </button>
          ))}
        </div>

        {filter && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-white/30">
              Showing: <span className="font-semibold text-accent">{BUCKETS.find(b => b.key === filter)?.label}</span>
            </span>
            <button
              onClick={() => setFilter(null)}
              className="text-[10px] text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 border border-gray-200 dark:border-white/10 rounded-full px-2 py-0.5 transition-colors"
            >
              Show all ✕
            </button>
          </div>
        )}
      </div>

      {/* Warm market list */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40 mb-3">
          Warm market list
          <span className="normal-case font-normal tracking-normal ml-2 text-gray-400 dark:text-white/30">
            · {displayEntries.length}{filter ? ` of ${total}` : ''} {total === 1 ? 'person' : 'people'}
          </span>
        </p>

        {/* Quick-add row */}
        <form onSubmit={handleAdd} className="mb-3">
          <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex flex-col gap-1 min-w-[140px] flex-1">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Name *</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  className={INPUT + ' w-full'}
                />
              </div>
              <div className="flex flex-col gap-1 min-w-[120px]">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Phone</label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="555-555-5555"
                  className={INPUT}
                />
              </div>
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  className={INPUT}
                />
              </div>
              <div className="flex flex-col gap-1 min-w-[110px]">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Social</label>
                <input
                  type="text"
                  value={addForm.social_handle}
                  onChange={e => setAddForm(f => ({ ...f, social_handle: e.target.value }))}
                  placeholder="@handle"
                  className={INPUT}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Life Fit</label>
                <select
                  value={addForm.life_fit}
                  onChange={e => setAddForm(f => ({ ...f, life_fit: e.target.value }))}
                  className={SELECT}
                >
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Relationship</label>
                <select
                  value={addForm.relationship}
                  onChange={e => setAddForm(f => ({ ...f, relationship: e.target.value }))}
                  className={SELECT}
                >
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={adding || !addForm.name.trim()}
                className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors whitespace-nowrap self-end"
              >
                {adding ? 'Adding…' : '+ Add'}
              </button>
            </div>
            {addErr && <p className="text-xs text-red-500 dark:text-red-400 mt-2">{addErr}</p>}
          </div>
        </form>

        {/* List */}
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-100 dark:bg-white/5 rounded-xl" />)}
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-white/30">
            <p className="text-2xl mb-2">📋</p>
            <p className="text-sm">{filter ? 'No one in this bucket yet' : 'Add your first warm market contact above'}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {displayEntries.map(entry => {
              const bucket = getBucket(entry)
              const isEditing = editId === entry.id

              if (isEditing) {
                return (
                  <div key={entry.id} className="bg-white dark:bg-primary/30 border border-accent/40 rounded-xl px-4 py-3 space-y-3">
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex flex-col gap-1 min-w-[140px] flex-1">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Name *</label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          className={INPUT + ' w-full'}
                          autoFocus
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-[120px]">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Phone</label>
                        <input
                          type="tel"
                          value={editForm.phone}
                          onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                          className={INPUT}
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-[140px]">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Email</label>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                          className={INPUT}
                        />
                      </div>
                      <div className="flex flex-col gap-1 min-w-[110px]">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Social</label>
                        <input
                          type="text"
                          value={editForm.social_handle}
                          onChange={e => setEditForm(f => ({ ...f, social_handle: e.target.value }))}
                          className={INPUT}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Life Fit</label>
                        <select
                          value={editForm.life_fit}
                          onChange={e => setEditForm(f => ({ ...f, life_fit: e.target.value }))}
                          className={SELECT}
                        >
                          <option value="high">High</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-gray-400 dark:text-white/30 font-medium uppercase tracking-wide">Relationship</label>
                        <select
                          value={editForm.relationship}
                          onChange={e => setEditForm(f => ({ ...f, relationship: e.target.value }))}
                          className={SELECT}
                        >
                          <option value="high">High</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveEdit(entry.id)}
                        disabled={!editForm.name.trim()}
                        className="text-xs px-4 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/20 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { if (confirm('Delete this person?')) handleDelete(entry.id) }}
                        className="text-xs px-3 py-1.5 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-transparent hover:border-red-200 dark:hover:border-red-500/20 transition-colors ml-auto"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={entry.id}
                  className="group bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 flex items-center gap-3 hover:border-gray-300 dark:hover:border-white/20 transition-colors"
                >
                  {/* Bucket chip */}
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${bucket.chipCls}`}>
                    {bucket.label}
                  </span>

                  {/* Name */}
                  <span className="text-sm font-semibold text-gray-900 dark:text-white w-40 truncate shrink-0">
                    {entry.name}
                  </span>

                  {/* Contact details */}
                  <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 min-w-0">
                    {entry.phone ? (
                      <span className="flex items-center gap-1.5">
                        <a
                          href={`tel:+1${entry.phone.replace(/[^0-9]/g, '')}`}
                          className="text-xs text-gray-500 dark:text-white/50 hover:text-green-600 dark:hover:text-green-400 transition-colors whitespace-nowrap"
                          onClick={e => e.stopPropagation()}
                        >
                          📞 {entry.phone}
                        </a>
                        <a
                          href={`sms:+1${entry.phone.replace(/[^0-9]/g, '')}`}
                          className="text-xs text-gray-400 dark:text-white/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
                          onClick={e => e.stopPropagation()}
                        >
                          💬
                        </a>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-white/20">No phone</span>
                    )}
                    {entry.email && (
                      <span className="text-xs text-gray-400 dark:text-white/40 truncate">✉ {entry.email}</span>
                    )}
                    {entry.social_handle && (
                      <span className="text-xs text-gray-400 dark:text-white/40">@ {entry.social_handle}</span>
                    )}
                  </div>

                  {/* Fit indicators */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      entry.life_fit === 'high'
                        ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                        : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-white/30'
                    }`}>
                      Life {entry.life_fit === 'high' ? '▲' : '▼'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      entry.relationship === 'high'
                        ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                        : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-white/30'
                    }`}>
                      Rel {entry.relationship === 'high' ? '▲' : '▼'}
                    </span>
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => startEdit(entry)}
                    className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 text-gray-400 dark:text-white/30 hover:text-gray-700 dark:hover:text-white hover:border-gray-300 dark:hover:border-white/30 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
