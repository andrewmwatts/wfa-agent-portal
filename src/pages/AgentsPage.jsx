import { useEffect, useMemo, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import BulkAgentImportModal from '../components/BulkAgentImportModal'
import AddAgentModal from '../components/AddAgentModal'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTruthy(val) {
  if (!val) return false
  return ['true', 'yes', 'y', 'x', '1'].includes(val.trim().toLowerCase())
}

function toInputDate(str) {
  if (!str) return ''
  const d = new Date(str)
  if (isNaN(d)) return str
  return d.toISOString().slice(0, 10)
}

// ─── Milestone helpers ────────────────────────────────────────────────────────

function isOwnerRecord(p) {
  const ao = p.named_milestones?.AO ?? []
  return !!(ao[0] && ao[1])
}

function allFilled(months) {
  return Array.isArray(months) && months.length > 0 && months.every(m => m?.trim())
}

// Highest numeric contract level where every month column is filled.
// Defaults to 80 if no level has been promoted yet.
function contractLevel(milestones = {}) {
  const levels = Object.keys(milestones)
    .map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
  let highest = null
  for (const lvl of levels) {
    if (allFilled(milestones[String(lvl)])) highest = lvl
  }
  return highest ?? 80
}

// Highest leadership level (TL < KL < AO) where every month column is filled
const LEADERSHIP_ORDER = ['TL', 'KL', 'AO']
function leadershipLevel(named = {}) {
  let highest = null
  for (const key of LEADERSHIP_ORDER) {
    if (allFilled(named[key])) highest = key
  }
  return highest
}

// TP / EP badge presence
function hasAchieved(named = {}, key) { return allFilled(named[key]) }

// Format a date string → "Jan 12, 2024"
function fmtDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d) ? str : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Format milestone date → "Jan 2024" (month + year only)
function fmtMo(str) {
  if (!str?.trim()) return null
  const d = new Date(str)
  return isNaN(d) ? str.trim() : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// Display string for a level's month array — "(SS)" if both dates match
function milestoneDates(months) {
  if (!months?.length) return null
  const d1 = fmtMo(months[0]) ?? months[0]?.trim() ?? null
  const d2 = months[1] != null ? (fmtMo(months[1]) ?? months[1]?.trim() ?? null) : undefined

  if (!d1) return null
  if (d2 == null) return d1           // only one month column
  if (!d2)        return d1           // second column empty
  if (d1 === d2)  return `${d1} (SS)` // simultaneous start
  return `${d1} / ${d2}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { activeSubject, permissions } = useViewing()
  const { userProfile }                = useAuth()
  const { theme }                      = useTheme()

  const isSuperAdmin = userProfile?.role === 'super_admin'

  const [personnel, setPersonnel]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [mode, setMode]             = useState('baseshop')
  const [isDirector, setIsDirector] = useState(false)
  const [search, setSearch]         = useState('')
  const [uplineFilter, setUplineFilter] = useState('')
  const [sort, setSort]             = useState({ col: 'name', dir: 1 })
  const [selected, setSelected]     = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showAdd,    setShowAdd]    = useState(false)
  const [addSuccess, setAddSuccess] = useState(null) // { uplineWarning } | null

  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}

  // ── Single init effect — fetches master, detects director, loads data once ──
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    initLoad(activeSubject.sfg_id)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId) {
    try {
      const masterRes = await fetch(`/api/personnel-data?root=${encodeURIComponent(sfgId)}&mode=master`)
      const masterPersonnel = masterRes.ok ? await masterRes.json() : []

      const root  = sfgId.toLowerCase()
      const isDir = masterPersonnel.some(p => p.sfg_id?.toLowerCase() !== root && isOwnerRecord(p))
      setIsDirector(isDir)
      setMode(isDir ? 'master' : 'baseshop')
      setPersonnel(masterPersonnel)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  // Called only when user explicitly toggles the mode dropdown
  async function handleModeChange(newMode) {
    if (!activeSubject?.sfg_id) return
    setMode(newMode)
    setLoading(true)
    try {
      const modeParam = newMode === 'master' ? '&mode=master' : ''
      const res = await fetch(`/api/personnel-data?root=${encodeURIComponent(activeSubject.sfg_id)}${modeParam}`)
      const data = res.ok ? await res.json() : []
      setPersonnel(data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  // Reload helper used after import/add-agent
  async function reloadPersonnel() {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    try {
      const modeParam = mode === 'master' ? '&mode=master' : ''
      const res = await fetch(`/api/personnel-data?root=${encodeURIComponent(activeSubject.sfg_id)}${modeParam}`)
      const data = res.ok ? await res.json() : []
      setPersonnel(data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  // ── Unique upline names for dropdown ─────────────────────────────────────
  const uplineOptions = useMemo(() => {
    const names = [...new Set(
      personnel.map(p => p.upline_name?.trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b))
    return names
  }, [personnel])

  // ── Derived rows ──────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return personnel
      .filter(p => !q || p.name?.toLowerCase().includes(q) || p.sfg_id?.toLowerCase().includes(q))
      .filter(p => !uplineFilter || p.upline_name === uplineFilter)
      .map(p => ({
        ...p,
        _contract:    contractLevel(p.milestones),
        _leadership:  leadershipLevel(p.named_milestones),
        _hasTP:       hasAchieved(p.named_milestones, 'TP'),
        _hasEP:       hasAchieved(p.named_milestones, 'EP'),
      }))
      .sort((a, b) => {
        let va, vb
        if (sort.col === 'name')        { va = a.name ?? ''; vb = b.name ?? '' }
        else if (sort.col === 'upline') { va = a.upline_name ?? ''; vb = b.upline_name ?? '' }
        else if (sort.col === 'contract')   { va = a._contract ?? -1; vb = b._contract ?? -1 }
        else if (sort.col === 'leadership') {
          const ord = { TL: 1, KL: 2, AO: 3 }
          va = ord[a._leadership] ?? 0; vb = ord[b._leadership] ?? 0
        }
        if (typeof va === 'string') return sort.dir * va.localeCompare(vb)
        return sort.dir * (va - vb)
      })
  }, [personnel, search, uplineFilter, sort])

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: -s.dir } : { col, dir: 1 })
  }

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view agents.</p>
    </div>
  )

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Agents</h1>
        {isDirector && (
          <select
            value={mode}
            onChange={e => handleModeChange(e.target.value)}
            className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="master"   style={optionStyle}>Master Agency</option>
            <option value="baseshop" style={optionStyle}>My Baseshop</option>
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {!loading && (
            <span className="text-xs text-gray-400 dark:text-white/30">{rows.length} agent{rows.length !== 1 ? 's' : ''}</span>
          )}
          <select
            value={uplineFilter}
            onChange={e => setUplineFilter(e.target.value)}
            className="text-sm bg-gray-100 border border-gray-200 text-gray-900 dark:bg-white/10 dark:border-white/15 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60 cursor-pointer"
          >
            <option value="" style={optionStyle}>All uplines</option>
            {uplineOptions.map(u => (
              <option key={u} value={u} style={optionStyle}>{u}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search name or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-sm bg-gray-100 border border-gray-200 text-gray-900 placeholder:text-gray-400 dark:bg-white/10 dark:border-white/15 dark:text-white dark:placeholder:text-white/30 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60"
          />
          {isSuperAdmin && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdd(true)}
                className="text-sm px-3 py-1.5 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10 transition-colors whitespace-nowrap"
              >
                + Add Agent
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="text-sm px-3 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors whitespace-nowrap"
              >
                Import CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk Agent Import Modal ─────────────────────────────────────────── */}
      {showImport && (
        <BulkAgentImportModal
          existingPersonnel={personnel}
          onClose={() => setShowImport(false)}
          onImportDone={() => reloadPersonnel()}
        />
      )}

      {/* ── Add Agent Modal ────────────────────────────────────────────────── */}
      {showAdd && (
        <AddAgentModal
          existingPersonnel={personnel}
          onClose={() => setShowAdd(false)}
          onAgentAdded={({ uplineWarning }) => {
            setShowAdd(false)
            setAddSuccess({ uplineWarning })
            setTimeout(() => setAddSuccess(null), 5000)
            reloadPersonnel()
          }}
        />
      )}

      {/* ── Add success toast ───────────────────────────────────────────────── */}
      {addSuccess && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all
          ${addSuccess.uplineWarning ? 'bg-amber-500' : 'bg-green-600'}`}>
          {addSuccess.uplineWarning
            ? 'Agent added — upline SFG ID not found in personnel'
            : 'Agent added successfully'}
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden animate-pulse">
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded" />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 dark:bg-primary/30 dark:border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10">
                  {[
                    { col: 'name',       label: 'Name' },
                    { col: 'upline',     label: 'Upline' },
                    { col: 'contract',   label: 'Contract Level' },
                    { col: 'leadership', label: 'Leadership Level' },
                  ].map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 px-5 py-3 first:pl-6 cursor-pointer select-none hover:text-gray-600 dark:hover:text-white/60 transition-colors whitespace-nowrap"
                    >
                      {h.label}
                      {sort.col === h.col && (
                        <span className="ml-1 text-accent">{sort.dir === 1 ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-400 dark:text-white/30">
                      {search ? 'No agents match your search.' : 'No agents found.'}
                    </td>
                  </tr>
                ) : rows.map(p => (
                  <tr
                    key={p.sfg_id}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    {/* Name */}
                    <td className="px-5 pl-6 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-white">{p.name || '—'}</span>
                        {p._hasEP && <Badge label="EP" color="purple" />}
                        {p._hasTP && !p._hasEP && <Badge label="TP" color="blue" />}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">{p.sfg_id}</p>
                    </td>
                    {/* Upline */}
                    <td className="px-5 py-3 text-sm text-gray-600 dark:text-white/70">
                      {p.upline_name || '—'}
                    </td>
                    {/* Contract Level */}
                    <td className="px-5 py-3">
                      {p._contract != null
                        ? <LevelPill value={p._contract} />
                        : <span className="text-gray-400 dark:text-white/30 text-sm">—</span>}
                    </td>
                    {/* Leadership Level */}
                    <td className="px-5 py-3">
                      {p._leadership
                        ? <LeaderPill level={p._leadership} />
                        : <span className="text-gray-400 dark:text-white/30 text-sm">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {selected && (
        <AgentModal
          agent={selected}
          onClose={() => setSelected(null)}
          canWrite={permissions?.myInfo?.write ?? false}
          onUpdate={updated => {
            setSelected(updated)
            setPersonnel(prev => prev.map(p => p.sfg_id === updated.sfg_id ? updated : p))
          }}
        />
      )}
    </main>
  )
}

// ─── Agent Detail Modal ───────────────────────────────────────────────────────

const AGENT_INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

function AgentModal({ agent: p, onClose, canWrite, onUpdate }) {
  const [editing,   setEditing]   = useState(false)
  const [draft,     setDraft]     = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)

  const contractLvl   = contractLevel(p.milestones)
  const leadershipLvl = leadershipLevel(p.named_milestones)
  const hasTP = hasAchieved(p.named_milestones, 'TP')
  const hasEP = hasAchieved(p.named_milestones, 'EP')

  // All numeric contract levels that have any data at all
  const contractEntries = Object.keys(p.milestones ?? {})
    .map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
    .map(lvl => ({ lvl: String(lvl), months: p.milestones[String(lvl)] ?? [], complete: allFilled(p.milestones[String(lvl)]) }))
    .filter(e => e.months.some(m => m?.trim()))

  // Leadership + TP/EP entries with any data
  const leaderEntries = [...LEADERSHIP_ORDER, 'TP', 'EP']
    .map(key => ({ key, months: p.named_milestones?.[key] ?? [], complete: allFilled(p.named_milestones?.[key]) }))
    .filter(e => e.months.some(m => m?.trim()))

  function startEdit() {
    // Deep copy including milestones
    setDraft({
      ...p,
      milestones:       JSON.parse(JSON.stringify(p.milestones ?? {})),
      named_milestones: JSON.parse(JSON.stringify(p.named_milestones ?? {})),
    })
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  function setField(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function setMilestoneMonth(isNamed, level, monthIdx, value) {
    setDraft(d => {
      const field = isNamed ? 'named_milestones' : 'milestones'
      const updated = JSON.parse(JSON.stringify(d[field] ?? {}))
      if (!updated[level]) updated[level] = []
      updated[level][monthIdx] = value
      return { ...d, [field]: updated }
    })
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      // Only send changed fields
      const updates = {}

      // Standard fields
      const standardKeys = ['name', 'upline_name', 'hire_date', 'birth_date', 'email', 'npn', 'opt_name', 'no_eando', 'profile_issues', 'surelc_profile_date', 'contracting_to_producer', 'contracting_complete']
      for (const key of standardKeys) {
        if (String(draft[key] ?? '') !== String(p[key] ?? '')) {
          updates[key] = String(draft[key] ?? '')
        }
      }

      // Numeric milestones
      for (const [level, months] of Object.entries(draft.milestones ?? {})) {
        if (isNaN(Number(level))) continue
        const orig = p.milestones?.[level] ?? []
        months.forEach((val, idx) => {
          if (String(val ?? '') !== String(orig[idx] ?? '')) {
            updates[`mil_${level}_${idx}`] = String(val ?? '')
          }
        })
      }

      // Named milestones
      for (const [level, months] of Object.entries(draft.named_milestones ?? {})) {
        const orig = p.named_milestones?.[level] ?? []
        months.forEach((val, idx) => {
          if (String(val ?? '') !== String(orig[idx] ?? '')) {
            updates[`namedmil_${level}_${idx}`] = String(val ?? '')
          }
        })
      }

      if (Object.keys(updates).length === 0) {
        cancelEdit()
        return
      }

      const res = await fetch('/api/update-personnel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sfg_id: p.sfg_id, updates }),
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white dark:bg-secondary rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{p.name || '—'}</h2>
              {hasEP && <Badge label="EP" color="purple" />}
              {hasTP && !hasEP && <Badge label="TP" color="blue" />}
              {leadershipLvl && <LeaderPill level={leadershipLvl} />}
            </div>
            <p className="text-sm text-gray-400 dark:text-white/40 mt-0.5">{p.sfg_id}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {canWrite && !editing && (
              <button
                onClick={startEdit}
                className="text-xs font-medium text-accent hover:text-accent/80 transition-colors px-2 py-1 rounded-lg hover:bg-accent/10"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={cancelEdit}
                  className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {saving && (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white transition-colors p-1 -mt-1 -mr-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300">
            {saveError}
          </div>
        )}

        <div className="px-6 py-5 space-y-6">

          {/* Personal Info */}
          <section>
            <SectionLabel>Personal &amp; Contact</SectionLabel>
            {editing ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                <AgentEditField label="Name"        value={draft.name}         onChange={v => setField('name', v)} />
                <AgentEditField label="Upline"      value={draft.upline_name}  onChange={v => setField('upline_name', v)} />
                <AgentEditField label="Email"       value={draft.email}        onChange={v => setField('email', v)} />
                <AgentEditField label="NPN"         value={draft.npn}          onChange={v => setField('npn', v)} />
                <AgentEditField label="Hire Date"   value={toInputDate(draft.hire_date)}  onChange={v => setField('hire_date', v)}  type="date" />
                <AgentEditField label="Birth Date"  value={toInputDate(draft.birth_date)} onChange={v => setField('birth_date', v)} type="date" />
                <AgentEditField label="Opt Name"    value={draft.opt_name}     onChange={v => setField('opt_name', v)} />
                <AgentEditField label="Profile Issues" value={draft.profile_issues} onChange={v => setField('profile_issues', v)} />
                <div>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">No E&amp;O</p>
                  <label className="flex items-center gap-2 cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={!!draft.no_eando}
                      onChange={e => setField('no_eando', e.target.checked ? 'TRUE' : '')}
                      className="w-4 h-4 accent-accent rounded cursor-pointer"
                    />
                    <span className="text-sm text-gray-700 dark:text-white/80">No E&amp;O</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                <InfoField label="Upline"     value={p.upline_name} />
                <InfoField label="Email"      value={p.email} />
                <InfoField label="NPN"        value={p.npn} />
                <InfoField label="Hire Date"  value={fmtDate(p.hire_date)} />
                <InfoField label="Birth Date" value={fmtDate(p.birth_date)} />
                <InfoField label="Opt Name"   value={p.opt_name} />
              </div>
            )}
          </section>

          {/* Contract Progression */}
          {contractEntries.length > 0 && (
            <section>
              <SectionLabel>Contract Progression</SectionLabel>
              {editing ? (
                <div className="space-y-3">
                  {contractEntries.map(({ lvl, months }) => (
                    <div key={lvl}>
                      <p className="text-xs font-semibold text-gray-500 dark:text-white/50 mb-1.5">{lvl}%</p>
                      <div className="grid grid-cols-2 gap-2">
                        {months.map((m, idx) => (
                          <AgentEditField
                            key={idx}
                            label={`Month ${idx + 1}`}
                            value={m ?? ''}
                            onChange={v => setMilestoneMonth(false, lvl, idx, v)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {contractEntries.map(({ lvl, months, complete }) => (
                    <MilestoneCard
                      key={lvl}
                      label={`${lvl}%`}
                      dates={milestoneDates(months)}
                      complete={complete}
                      active={contractLvl === Number(lvl)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Leadership Progression */}
          {leaderEntries.length > 0 && (
            <section>
              <SectionLabel>Leadership Progression</SectionLabel>
              {editing ? (
                <div className="space-y-3">
                  {leaderEntries.map(({ key, months }) => (
                    <div key={key}>
                      <p className="text-xs font-semibold text-gray-500 dark:text-white/50 mb-1.5">{LEADER_LABELS[key] ?? key}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {months.map((m, idx) => (
                          <AgentEditField
                            key={idx}
                            label={`Month ${idx + 1}`}
                            value={m ?? ''}
                            onChange={v => setMilestoneMonth(true, key, idx, v)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {leaderEntries.map(({ key, months, complete }) => (
                    <MilestoneCard
                      key={key}
                      label={LEADER_LABELS[key] ?? key}
                      dates={milestoneDates(months)}
                      complete={complete}
                      active={leadershipLvl === key}
                      accent={key === 'TP' ? 'blue' : key === 'EP' ? 'purple' : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

function AgentEditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={AGENT_INPUT_CLS + (type === 'date' ? ' dark:[color-scheme:dark]' : '')}
      />
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

const LEADER_LABELS = { TL: 'Team Leader', KL: 'Key Leader', AO: 'Agency Owner', TP: 'Top Producer', EP: 'Elite Producer' }

function Badge({ label, color }) {
  const cls = color === 'purple'
    ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300'
    : color === 'blue'
    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
    : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/60'
  return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
}

function LevelPill({ value }) {
  return (
    <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{value}%</span>
  )
}

function LeaderPill({ level }) {
  const colors = {
    AO: 'text-accent font-semibold',
    KL: 'text-blue-600 dark:text-blue-300 font-medium',
    TL: 'text-gray-600 dark:text-white/70 font-medium',
  }
  return (
    <span className={`text-sm ${colors[level] ?? 'text-gray-600 dark:text-white/70'}`}>
      {level}
    </span>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">
      {children}
    </p>
  )
}

function InfoField({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className="text-sm text-gray-800 dark:text-white/90 break-all">{value || '—'}</p>
    </div>
  )
}

function MilestoneCard({ label, dates, complete, active, accent }) {
  const border = active
    ? 'border-accent/50 bg-accent/5'
    : complete
    ? 'border-green-200 dark:border-green-500/20 bg-green-500/5'
    : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03]'

  const accentCls = accent === 'purple'
    ? 'text-purple-600 dark:text-purple-300'
    : accent === 'blue'
    ? 'text-blue-600 dark:text-blue-300'
    : active
    ? 'text-accent'
    : complete
    ? 'text-green-700 dark:text-green-400'
    : 'text-gray-500 dark:text-white/50'

  return (
    <div className={`border rounded-xl px-3 py-2.5 ${border}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${accentCls}`}>{label}</p>
      <p className="text-sm text-gray-700 dark:text-white/80">{dates ?? '—'}</p>
    </div>
  )
}

