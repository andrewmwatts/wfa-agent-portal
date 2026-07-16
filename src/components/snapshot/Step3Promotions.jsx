import { useMemo, useState } from 'react'
import { fmtCurrency as fmtAmt } from '../../utils/format'
import { nextContractLevel, nextLeadershipLevel } from '../../../shared/commissionLevel'

const INPUT_CLS = 'w-full rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/50'

function fmtApv(n) {
  if (n == null && n !== 0) return '—'
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtMonth(isoMonth) {
  if (!isoMonth) return '—'
  const [y, m] = isoMonth.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Thin fetch wrapper that surfaces non-2xx responses instead of failing silently.
async function apiRequest(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch { /* non-JSON error body */ }
    throw new Error(message)
  }
  return res.status === 204 ? null : res.json()
}

function CopyBlock({ lines }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/15 overflow-hidden mt-2">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <span className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider">Jotform Copy Block</span>
        <button onClick={copy} className="text-xs text-accent hover:text-accent/80 font-medium">
          {copied ? '✓ Copied' : 'Copy All'}
        </button>
      </div>
      <div className="px-3 py-3 font-mono text-xs text-gray-700 dark:text-white/70 space-y-0.5">
        {lines.map((l, i) => <div key={i} className="select-all whitespace-pre">{l}</div>)}
      </div>
    </div>
  )
}

function buildJotformLines(person, apv, writers, monthNum, promoType, cycleMonth, existing) {
  const fmt$ = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const name  = person?.opt_name ?? ''
  const sfgId = person?.sfg_id ?? ''
  const level = person?.commission_level ?? ''

  const base = [name, sfgId, level]

  if (promoType === 'Slingshot') {
    return [...base, 'Slingshot Qualification', fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
  }
  if (promoType === 'TL-KL') {
    const lines = [...base, `TL-KL Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
    if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
    if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
    return lines
  }
  if (promoType === 'AO') {
    const lines = [name, sfgId, 'Agency Owner', `AO Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
    if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
    if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
    return lines
  }
  // Standard
  const lines = [...base, `Standard Qualification Month ${monthNum}`, fmtMonth(cycleMonth), fmt$(apv), `${writers} writers`]
  if (existing?.month_1) lines.push(`Month 1: ${fmtMonth(existing.month_1)}`)
  if (existing?.month_2) lines.push(`Month 2: ${fmtMonth(existing.month_2)}`)
  return lines
}

// ── Manual Promotion Modal ─────────────────────────────────────────────────────
function ManualPromoModal({ personnel, cycleId, onClose, onSaved }) {
  const [sfgId,  setSfgId]  = useState('')
  const [type,   setType]   = useState('manual_promotion')
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = personnel
    .filter(p => !search || (p.opt_name ?? '').toLowerCase().includes(search.toLowerCase()) || (p.sfg_id ?? '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)
  const selected = personnel.find(p => p.sfg_id === sfgId)

  async function save() {
    if (!sfgId) return
    setSaving(true)
    try {
      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id: cycleId, sfg_id: sfgId, action_type: type, is_manual: true, notes: notes || null,
      })
      onSaved()
      onClose()
    } catch (err) {
      alert(err.message || 'Failed to save promotion.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Log Manual Promotion</h2>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Agent</label>
          {selected ? (
            <div className="flex items-center justify-between rounded-lg border border-gray-300 dark:border-white/20 px-3 py-2">
              <span className="text-sm text-gray-900 dark:text-white">{selected.opt_name} <span className="text-gray-400 text-xs">{selected.sfg_id}</span></span>
              <button onClick={() => setSfgId('')} className="text-xs text-gray-400 hover:text-red-500 ml-2">×</button>
            </div>
          ) : (
            <div className="space-y-1">
              <input value={search} onChange={e => setSearch(e.target.value)} className={INPUT_CLS} placeholder="Search by name or ID…" autoFocus />
              {search && (
                <div className="rounded-lg border border-gray-200 dark:border-white/15 overflow-hidden">
                  {filtered.map(p => (
                    <button key={p.sfg_id} onClick={() => { setSfgId(p.sfg_id); setSearch('') }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/5 text-gray-900 dark:text-white border-b border-gray-100 dark:border-white/10 last:border-0">
                      {p.opt_name} <span className="text-gray-400 text-xs">{p.sfg_id}</span>
                    </button>
                  ))}
                  {!filtered.length && <div className="px-3 py-2 text-xs text-gray-400">No results</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Action Type</label>
          <select value={type} onChange={e => setType(e.target.value)} className={INPUT_CLS}>
            <option value="manual_promotion">Manual Promotion</option>
            <option value="promotion">Promotion</option>
            <option value="streak_reset">Streak Reset</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-white/50 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className={INPUT_CLS} rows={3} placeholder="Optional notes…" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">Cancel</button>
          <button onClick={save} disabled={!sfgId || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Step3Promotions({ cycle, promotions, context, canWrite, onCycleClose, onRefresh }) {
  const {
    personnel    = [],
    qualifications = [],
    promotions: agentPromos = [],
    monthPolicies = [],
  } = context ?? {}

  const [saving,       setSaving]       = useState(null)
  const [manualModal,  setManualModal]  = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [jotformOpen,  setJotformOpen]  = useState(new Set())

  const readOnly   = !!cycle?.completed_at || !canWrite
  const cycleMonth = cycle?.month

  // ── Lookup maps ──────────────────────────────────────────────────────────────
  const personnelMap = useMemo(() => {
    const m = {}
    for (const p of personnel) m[p.sfg_id?.toUpperCase()] = p
    return m
  }, [personnel])

  // Keyed by "SFGID||LEVEL" so an agent can have separate in-progress rows per track
  const agentPromoMap = useMemo(() => {
    const m = {}
    for (const ap of agentPromos) {
      const id = ap.sfg_id?.toUpperCase()
      if (id && ap.level) m[`${id}||${ap.level}`] = ap
    }
    return m
  }, [agentPromos])

  // Persisted skips for this cycle, keyed by "SFGID||LEVEL"
  const skippedSet = useMemo(() => {
    const s = new Set()
    for (const a of promotions) {
      const id = a.sfg_id?.toUpperCase()
      if (a.action_type === 'skipped' && id && a.level) s.add(`${id}||${a.level}`)
    }
    return s
  }, [promotions])

  const qualByLevel = useMemo(() => {
    const m = {}
    for (const q of qualifications) if (q.level) m[q.level.toLowerCase()] = q
    return m
  }, [qualifications])

  const apvByAgent = useMemo(() => {
    const m = {}
    for (const p of monthPolicies) {
      const id = p.sfg_id?.toUpperCase()
      if (id) m[id] = (m[id] ?? 0) + (Number(p.issued_apv) || 0)
    }
    return m
  }, [monthPolicies])

  // Direct downlines with issued policies this month = writers
  const writersCount = useMemo(() => {
    const m = {}
    for (const p of personnel) {
      const upline = p.upline_sfg_id?.toUpperCase()
      if (!upline) continue
      if ((apvByAgent[p.sfg_id?.toUpperCase()] ?? 0) > 0) m[upline] = (m[upline] ?? 0) + 1
    }
    return m
  }, [personnel, apvByAgent])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function getThresholds(level) {
    // qualifications rows use string keys matching the level values exactly
    return qualByLevel[String(level).toLowerCase()] ?? qualByLevel[String(level)] ?? null
  }

  function meetsThreshold(q, apv, writers) {
    if (!q) return false
    return apv >= (Number(q.regular) || 0) && writers >= (Number(q.writers) || 0)
  }

  function isSlingshot(q, apv) {
    return !!(q?.slingshot && apv >= Number(q.slingshot))
  }

  // Condition A: agent has writing downlines this month (structural impact on promotion)
  // Condition B: agent's contract level equals their upline's contract level (hierarchy parity)
  function hierarchyFlags(sfgId) {
    const id     = sfgId?.toUpperCase()
    const person = personnelMap[id]
    const condA  = personnel.some(p => p.upline_sfg_id?.toUpperCase() === id && (apvByAgent[p.sfg_id?.toUpperCase()] ?? 0) > 0)
    const upline = personnelMap[person?.upline_sfg_id?.toUpperCase()]
    const condB  = !!(upline && upline.commission_contract?.level && upline.commission_contract.level === person?.commission_contract?.level)
    return { condA, condB, any: condA || condB }
  }

  // ── Qualifying agents ────────────────────────────────────────────────────────
  // Each entry represents one qualifying opportunity (contract OR leadership track).
  // A single agent may appear twice if they're qualifying on both tracks simultaneously.
  const qualifyingAgents = useMemo(() => {
    const result = []

    for (const person of personnel) {
      const sfgId = person.sfg_id?.toUpperCase()
      if (!sfgId) continue

      const apv     = apvByAgent[sfgId] ?? 0
      const writers = writersCount[sfgId] ?? 0
      const flags   = hierarchyFlags(sfgId)

      // ── Contract track ────────────────────────────────────────────────────
      const nextContract = nextContractLevel(person.commission_contract?.level ?? '80')
      if (nextContract && !skippedSet.has(sfgId + '||' + nextContract)) {
        const q = getThresholds(nextContract)
        if (meetsThreshold(q, apv, writers)) {
          const existing = agentPromoMap[`${sfgId}||${nextContract}`] ?? null
          if (!existing?.is_qualified) {
            const months = Number(q?.months) || 2
            let monthNum = 1
            if (existing?.month_1 && existing.month_1.slice(0, 7) !== cycleMonth && !existing?.month_2) monthNum = 2
            if (existing?.month_1 && existing?.month_2 && existing.month_2.slice(0, 7) !== cycleMonth && months === 3) monthNum = 3

            const key = `${sfgId}||contract||${nextContract}||${monthNum}`
            const alreadyLogged = promotions.some(
              a => a.sfg_id?.toUpperCase() === sfgId && a.month_number === monthNum &&
                   a.level === nextContract && ['promotion', 'qualifying_month'].includes(a.action_type)
            )
            if (!alreadyLogged) {
              result.push({
                key, person, sfgId, apv, writers, monthNum,
                track: 'contract',
                targetLevel: nextContract,
                promoType:   isSlingshot(q, apv) ? 'Slingshot' : 'Standard',
                existing,
                flags,
                totalMonths: months,
              })
            }
          }
        }
      }

      // ── Leadership track ──────────────────────────────────────────────────
      const nextLeadership = nextLeadershipLevel(person.commission_leadership?.level ?? null)
      if (nextLeadership && !skippedSet.has(sfgId + '||' + nextLeadership)) {
        const q = getThresholds(nextLeadership)
        if (meetsThreshold(q, apv, writers)) {
          const existing = agentPromoMap[`${sfgId}||${nextLeadership}`] ?? null
          if (!existing?.is_qualified) {
            const months = Number(q?.months) || 2
            let monthNum = 1
            if (existing?.month_1 && existing.month_1.slice(0, 7) !== cycleMonth && !existing?.month_2) monthNum = 2
            if (existing?.month_1 && existing?.month_2 && existing.month_2.slice(0, 7) !== cycleMonth && months === 3) monthNum = 3

            const key = `${sfgId}||leadership||${nextLeadership}||${monthNum}`
            const alreadyLogged = promotions.some(
              a => a.sfg_id?.toUpperCase() === sfgId && a.month_number === monthNum &&
                   a.level === nextLeadership && ['promotion', 'qualifying_month'].includes(a.action_type)
            )
            if (!alreadyLogged) {
              result.push({
                key, person, sfgId, apv, writers, monthNum,
                track: 'leadership',
                targetLevel: nextLeadership,
                promoType:   nextLeadership,
                existing,
                flags,
                totalMonths: months,
              })
            }
          }
        }
      }
    }

    return result.sort((a, b) => (a.person.opt_name ?? '').localeCompare(b.person.opt_name ?? ''))
  }, [personnel, apvByAgent, writersCount, agentPromoMap, qualByLevel, promotions, skippedSet])

  // ── Broken streaks ───────────────────────────────────────────────────────────
  const brokenStreaks = useMemo(() => {
    const qualifyingIds = new Set(qualifyingAgents.map(q => q.sfgId))
    return agentPromos
      .filter(ap => {
        if (ap.is_qualified || ap.month_3) return false
        if (!ap.month_1) return false
        if (ap.month_1?.slice(0, 7) === cycleMonth) return false  // started this cycle
        if (ap.month_2?.slice(0, 7) === cycleMonth) return false  // completed this cycle
        return !qualifyingIds.has(ap.sfg_id?.toUpperCase())
      })
      .map(ap => ({ ...ap, person: personnelMap[ap.sfg_id?.toUpperCase()], apv: apvByAgent[ap.sfg_id?.toUpperCase()] ?? 0 }))
      .sort((a, b) => (a.person?.opt_name ?? '').localeCompare(b.person?.opt_name ?? ''))
  }, [agentPromos, qualifyingAgents, cycleMonth, personnelMap, apvByAgent])

  const finalizedActions = promotions.filter(
    a => a.action_type === 'promotion' || a.action_type === 'manual_promotion'
  )

  const unresolvedFlags = finalizedActions.filter(a => hierarchyFlags(a.sfg_id).any && !a.hierarchy_flag_noted)

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function logMonth(sfgId, monthNum, promoType, targetLevel, existing, totalMonths) {
    setSaving(sfgId + '-' + targetLevel + '-month')
    try {
      const isFinal = monthNum >= totalMonths

      await apiRequest('/api/snapshot?type=agent_promotion', 'POST', {
        sfg_id:         sfgId,
        promotion_type: promoType,
        level:          targetLevel,
        month_1:        monthNum === 1 ? cycleMonth : (existing?.month_1 ?? null),
        month_2:        monthNum === 2 ? cycleMonth : (existing?.month_2 ?? null),
        month_3:        (isFinal && totalMonths === 3) ? cycleMonth : (existing?.month_3 ?? null),
        is_slingshot:   promoType === 'Slingshot',
        is_qualified:   isFinal,
        qualified_date: isFinal ? new Date().toISOString().slice(0, 10) : null,
      })

      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id:     cycle.id,
        sfg_id:       sfgId,
        action_type:  isFinal ? 'promotion' : 'qualifying_month',
        month_number: monthNum,
        level:        targetLevel,
      })

      if (isFinal) setJotformOpen(prev => new Set([...prev, sfgId + '||' + targetLevel]))
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to log promotion month.')
    } finally {
      setSaving(null)
    }
  }

  async function skipAgent(sfgId, targetLevel) {
    setSaving(sfgId + '-' + targetLevel + '-skip')
    try {
      await apiRequest('/api/snapshot?type=promotions', 'POST', {
        cycle_id: cycle.id, sfg_id: sfgId, action_type: 'skipped', level: targetLevel,
      })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to skip.')
    } finally {
      setSaving(null)
    }
  }

  async function resetStreak(ap) {
    if (!ap.id) { alert('Cannot reset: no record ID.'); return }
    if (!confirm(`Reset ${ap.person?.opt_name ?? ap.sfg_id}'s qualifying streak?`)) return
    setSaving(ap.sfg_id + '-reset')
    try {
      await Promise.all([
        apiRequest('/api/snapshot?type=agent_promotion', 'DELETE', { id: ap.id }),
        apiRequest('/api/snapshot?type=promotions', 'POST', { cycle_id: cycle.id, sfg_id: ap.sfg_id, action_type: 'streak_reset' }),
      ])
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to reset streak.')
    } finally {
      setSaving(null)
    }
  }

  async function noteFlag(actionId) {
    setSaving(actionId)
    try {
      await apiRequest('/api/snapshot?type=promotion', 'PUT', { id: actionId, hierarchy_flag_noted: true })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to note flag.')
    } finally {
      setSaving(null)
    }
  }

  async function submitJotform(actionId) {
    setSaving(actionId + '-jf')
    try {
      await apiRequest('/api/snapshot?type=promotion', 'PUT', { id: actionId, jotform_submitted_at: new Date().toISOString() })
      await onRefresh()
    } catch (err) {
      alert(err.message || 'Failed to mark jotform submitted.')
    } finally {
      setSaving(null)
    }
  }

  async function closeCycle() {
    setSaving('close')
    try {
      await apiRequest('/api/snapshot?type=cycle', 'PUT', { id: cycle.id, completed_at: new Date().toISOString() })
      onCycleClose()
    } catch (err) {
      alert(err.message || 'Failed to close cycle.')
    } finally {
      setSaving(null)
      setConfirmClose(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!context) {
    return <div className="flex items-center justify-center py-16 text-sm text-gray-400 dark:text-white/40">Loading context…</div>
  }

  return (
    <div className="space-y-8">
      {/* Manual promotion button */}
      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={() => setManualModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
            + Log Manual Promotion
          </button>
        </div>
      )}

      {/* ── A: Broken Streaks ──────────────────────────────────────────────────── */}
      {brokenStreaks.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
            Broken Streaks <span className="ml-1 text-xs font-normal text-red-500">{brokenStreaks.length} agent{brokenStreaks.length !== 1 ? 's' : ''}</span>
          </h2>
          <div className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                <tr>
                  {['Agent', 'Level', 'Month 1', 'Month 2', 'This Month APV', 'APV Target', 'Writers Target', ''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {brokenStreaks.map(ap => {
                  const q = getThresholds(ap.level)
                  return (
                    <tr key={ap.sfg_id} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{ap.person?.opt_name ?? ap.sfg_id}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{ap.level}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{fmtMonth(ap.month_1)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{ap.month_2 ? fmtMonth(ap.month_2) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{fmtApv(ap.apv)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{q?.regular != null ? fmtApv(q.regular) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{q?.writers ?? '—'}</td>
                      <td className="px-4 py-3">
                        {!readOnly && (
                          <button onClick={() => resetStreak(ap)} disabled={saving === ap.sfg_id + '-reset'}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
                            {saving === ap.sfg_id + '-reset' ? 'Resetting…' : 'Reset Streak'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── B: Qualifying Months ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
          Qualifying Months
          {qualifyingAgents.length > 0 && <span className="ml-1 text-xs font-normal text-gray-400">{qualifyingAgents.length} detected</span>}
        </h2>
        {qualifyingAgents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-white/15 px-6 py-8 text-center text-sm text-gray-400 dark:text-white/40">
            No agents detected as qualifying this month.
          </div>
        ) : (
          <div className="space-y-3">
            {qualifyingAgents.map(({ key, person, sfgId, apv, writers, monthNum, promoType, targetLevel, track, existing, flags, totalMonths }) => {
              const isFinal     = monthNum >= totalMonths
              const jotformKey  = sfgId + '||' + targetLevel
              const savingKey   = sfgId + '-' + targetLevel + '-month'
              const showJotform = isFinal || jotformOpen.has(jotformKey)
              const jotformLines = buildJotformLines(person, apv, writers, monthNum, promoType, cycleMonth, existing)
              const currentLevelLabel = track === 'contract'
                ? `${person.commission_contract?.level ?? '80'}%`
                : (person.commission_leadership?.level ?? 'None')
              const q = getThresholds(targetLevel)

              return (
                <div key={key} className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">{person.opt_name}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">
                      {currentLevelLabel} → {track === 'contract' ? `${targetLevel}%` : targetLevel}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isFinal
                        ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400'
                    }`}>
                      {isFinal ? `FINAL — ${promoType}` : `Month ${monthNum}/${totalMonths} — ${promoType}`}
                    </span>
                    {flags.condA && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400">Condition A</span>
                    )}
                    {flags.condB && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400">Condition B</span>
                    )}
                    <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 dark:text-white/50">
                      <span>{fmtApv(apv)}{q?.regular != null ? ` / ${fmtApv(q.regular)} target` : ''}</span>
                      <span>{writers} / {q?.writers ?? '—'} writer{Number(q?.writers) !== 1 ? 's' : ''}</span>
                      {q?.slingshot != null && (
                        <span className="text-purple-500 dark:text-purple-400">Slingshot: {fmtApv(q.slingshot)}</span>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  <div className="px-4 py-3 space-y-2">
                    {existing?.month_1 && (
                      <div className="text-xs text-gray-500 dark:text-white/50">
                        Month 1: {fmtMonth(existing.month_1)}
                        {existing.month_2 && ` · Month 2: ${fmtMonth(existing.month_2)}`}
                      </div>
                    )}

                    {showJotform && <CopyBlock lines={jotformLines} />}

                    {!readOnly && (
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <button
                          onClick={() => logMonth(sfgId, monthNum, promoType, targetLevel, existing, totalMonths)}
                          disabled={!!saving}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                            isFinal
                              ? 'bg-green-600 text-white hover:bg-green-700'
                              : 'bg-accent text-white hover:bg-accent/90'
                          }`}>
                          {saving === savingKey ? 'Logging…' : isFinal ? 'Log & Submit Promotion' : `Log Month ${monthNum}`}
                        </button>

                        {!isFinal && (
                          <button
                            onClick={() => setJotformOpen(prev => {
                              const s = new Set(prev)
                              s.has(jotformKey) ? s.delete(jotformKey) : s.add(jotformKey)
                              return s
                            })}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 dark:text-white/50 border border-gray-200 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/5">
                            {jotformOpen.has(jotformKey) ? 'Hide Jotform' : 'Show Jotform'}
                          </button>
                        )}

                        <button
                          onClick={() => skipAgent(sfgId, targetLevel)}
                          disabled={!!saving}
                          className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-50">
                          {saving === sfgId + '-' + targetLevel + '-skip' ? 'Skipping…' : 'Skip'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── C: Promotions Finalized ────────────────────────────────────────────── */}
      {finalizedActions.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
            Promotions Finalized <span className="ml-1 text-xs font-normal text-gray-400">({finalizedActions.length})</span>
          </h2>
          <div className="rounded-2xl border border-gray-200 dark:border-white/15 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
                <tr>
                  {['Agent', 'Type', 'Level', 'Jotform', 'Flags', 'Notes'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {finalizedActions.map(a => {
                  const person = personnelMap[a.sfg_id?.toUpperCase()]
                  const flags  = hierarchyFlags(a.sfg_id)
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{person?.opt_name ?? a.sfg_id}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50 capitalize">{(a.action_type ?? '').replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-white/50">{person?.commission_level ?? '—'}</td>
                      <td className="px-4 py-3">
                        {a.jotform_submitted_at
                          ? <span className="text-xs text-green-600 dark:text-green-400">✓ Submitted</span>
                          : !readOnly
                            ? <button onClick={() => submitJotform(a.id)} disabled={saving === a.id + '-jf'}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                                {saving === a.id + '-jf' ? 'Saving…' : 'Mark Submitted'}
                              </button>
                            : <span className="text-xs text-gray-400">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        {flags.any
                          ? a.hierarchy_flag_noted
                            ? <span className="text-xs text-green-600 dark:text-green-400">✓ Noted</span>
                            : !readOnly
                              ? <button onClick={() => noteFlag(a.id)} disabled={saving === a.id}
                                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30 hover:bg-orange-50 dark:hover:bg-orange-500/10 disabled:opacity-50">
                                  {saving === a.id ? 'Saving…' : 'Note Flags'}
                                </button>
                              : <span className="text-xs text-orange-500">⚠ Unresolved</span>
                          : <span className="text-xs text-gray-300 dark:text-white/20">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-white/40">{a.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Close Cycle ────────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className="pt-4 border-t border-gray-200 dark:border-white/15 flex items-center justify-between">
          <p className="text-xs text-gray-400 dark:text-white/40">
            {unresolvedFlags.length > 0
              ? `${unresolvedFlags.length} unresolved hierarchy flag${unresolvedFlags.length !== 1 ? 's' : ''}`
              : 'All flags resolved.'}
          </p>
          <button
            onClick={() => unresolvedFlags.length > 0 ? setConfirmClose(true) : closeCycle()}
            disabled={saving === 'close'}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-100 disabled:opacity-50">
            {saving === 'close' ? 'Closing…' : 'Close Cycle'}
          </button>
        </div>
      )}

      {/* Confirm close with unresolved flags */}
      {confirmClose && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Unresolved Hierarchy Flags</h2>
            <p className="text-sm text-gray-500 dark:text-white/50">The following promotions have unresolved flags:</p>
            <ul className="space-y-1 text-sm text-orange-600 dark:text-orange-400">
              {unresolvedFlags.map(a => (
                <li key={a.id}>• {personnelMap[a.sfg_id?.toUpperCase()]?.opt_name ?? a.sfg_id}</li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 dark:text-white/40">Close cycle anyway?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClose(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10">
                Go Back
              </button>
              <button onClick={closeCycle} disabled={saving === 'close'}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {saving === 'close' ? 'Closing…' : 'Close Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual promotion modal */}
      {manualModal && (
        <ManualPromoModal
          personnel={personnel}
          cycleId={cycle.id}
          onClose={() => setManualModal(false)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}
