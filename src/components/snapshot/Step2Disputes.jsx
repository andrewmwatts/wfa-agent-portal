import { useEffect, useMemo, useRef, useState } from 'react'
import PolicyModal, { PolicyModalErrorBoundary } from '../PolicyEditModal'
import { fmtDate, fmtCurrency as fmtAmt } from '../../utils/format'

function CopyBlock({ lines, notes, className = '' }) {
  const [copied,          setCopied]          = useState(false)
  const [copiedWithNotes, setCopiedWithNotes] = useState(false)

  function copy() {
    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyWithNotes() {
    const all = notes ? [...lines, notes] : lines
    navigator.clipboard.writeText(all.join('\n'))
    setCopiedWithNotes(true)
    setTimeout(() => setCopiedWithNotes(false), 2000)
  }

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-white/15 overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <span className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider">Jotform Copy Block</span>
        <div className="flex items-center gap-3">
          <button onClick={copy} className="text-xs text-accent hover:text-accent/80 transition-colors font-medium">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          {notes && (
            <button onClick={copyWithNotes} className="text-xs text-accent hover:text-accent/80 transition-colors font-medium">
              {copiedWithNotes ? '✓ Copied' : 'Copy with Notes'}
            </button>
          )}
        </div>
      </div>
      <div className="px-3 py-3 space-y-0.5 font-mono text-xs text-gray-700 dark:text-white/70">
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="select-all">{line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildJotformLines(agentName, dispute, policy) {
  const carrier   = policy?.carrier ?? dispute.carrier ?? ''
  const policyNo  = policy?.policy_no ?? policy?.policy_number ?? ''
  const apv       = (policy?.issued_apv ?? dispute.disputed_amount) != null
    ? `$${Number(policy?.issued_apv ?? dispute.disputed_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : ''
  const issueDate = policy?.issue_date
    ? new Date(policy.issue_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : ''
  return [carrier, agentName, policyNo, apv, issueDate].filter(Boolean)
}

export default function Step2Disputes({ cycle, disputes, personnel, policies, monthPolicies = [], canWrite, onStepComplete, onRefresh }) {
  const [qualifications,   setQualifications]   = useState({})
  const [notes,            setNotes]            = useState({})         // id → local draft
  const [includedOverride, setIncludedOverride] = useState({})         // id → bool (optimistic)
  const [savingId,         setSavingId]         = useState(null)
  const [editPolicy,       setEditPolicy]       = useState(null)

  const readOnly = !!cycle?.completed_at || !canWrite

  // Clear include overrides when disputes prop updates (after a real refresh)
  const prevDisputeIds = useRef(null)
  useEffect(() => {
    const ids = disputes.map(d => d.id).join(',')
    if (prevDisputeIds.current !== null && prevDisputeIds.current !== ids) {
      setIncludedOverride({})
    }
    prevDisputeIds.current = ids
  }, [disputes])

  // Determine effective included state (local override > prop)
  function isIncluded(d) {
    return includedOverride[d.id] !== undefined ? includedOverride[d.id] : d.included !== false
  }

  // Personnel lookup map
  const personnelMap = useMemo(() => {
    const m = {}
    for (const p of personnel) if (p.sfg_id) m[p.sfg_id.toUpperCase()] = p
    return m
  }, [personnel])

  // Name map from dispute rows (server-resolved, reliable even if context failed)
  const disputeNameMap = useMemo(() => {
    const m = {}
    for (const d of disputes) {
      if (d.sfg_id && d.agent_name) m[d.sfg_id.toUpperCase()] = d.agent_name
    }
    return m
  }, [disputes])

  // Resolve display name: prefer server-resolved agent_name on the dispute/reconciliation row,
  // fall back to personnelMap, then raw sfg_id
  function resolveName(sfgId) {
    const upper = sfgId?.toUpperCase()
    if (!upper) return sfgId
    const p = personnelMap[upper]
    return disputeNameMap[upper] || p?.opt_name || p?.preferred_name || sfgId
  }

  // Policy lookup by id
  const policyMap = useMemo(() => {
    const m = {}
    for (const p of policies) if (p.id) m[p.id] = p
    return m
  }, [policies])

  // Load qualifications
  useEffect(() => {
    fetch('/api/activity?type=qualifications')
      .then(r => r.json())
      .then(d => setQualifications(d.qualifications ?? {}))
      .catch(() => {})
  }, [])

  // ── Hierarchy Totalizer ──────────────────────────────────────────────────────
  const { affectedAgents, baseApvByAgent } = useMemo(() => {
    const affected = new Set()
    for (const d of disputes) if (d.sfg_id) affected.add(d.sfg_id.toUpperCase())

    const withUplines = new Set(affected)
    for (const sfgId of affected) {
      let cur = personnelMap[sfgId]?.upline_sfg_id?.toUpperCase()
      const visited = new Set()
      while (cur && !visited.has(cur)) {
        visited.add(cur)
        withUplines.add(cur)
        cur = personnelMap[cur]?.upline_sfg_id?.toUpperCase()
      }
    }

    const base = {}
    for (const sfgId of withUplines) {
      base[sfgId] = monthPolicies
        .filter(p => p.sfg_id?.toUpperCase() === sfgId && p.status?.toLowerCase() === 'issued')
        .reduce((s, p) => s + (Number(p.issued_apv) || 0), 0)
    }

    return { affectedAgents: [...withUplines], baseApvByAgent: base }
  }, [disputes, personnelMap, monthPolicies])

  // Net APV respects local include overrides for real-time feedback
  function getNetApv(sfgId) {
    const upper = sfgId.toUpperCase()
    let deduction = 0
    for (const d of disputes) {
      if (!isIncluded(d) && d.sfg_id?.toUpperCase() === upper) {
        deduction += Number(d.disputed_amount) || 0
      }
    }
    return (baseApvByAgent[upper] ?? 0) - deduction
  }

  function getThresholds(sfgId) {
    const p = personnelMap[sfgId?.toUpperCase()]
    if (!p) return []
    return Object.values(qualifications).map(q => Number(q.regular)).filter(Boolean).sort((a, b) => a - b)
  }

  function thresholdColor(sfgId) {
    const base = baseApvByAgent[sfgId] ?? 0
    const net  = getNetApv(sfgId)
    for (const t of getThresholds(sfgId)) {
      if (base >= t && net < t) return 'red'
      if (base < t && net >= t) return 'green'
    }
    return null
  }

  // Include/exclude: optimistic local update, fire-and-forget to server (no page refresh)
  function toggleIncluded(id, value) {
    setIncludedOverride(s => ({ ...s, [id]: value }))
    fetch('/api/snapshot?type=dispute', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, included: value }),
    }).catch(err => console.error('include toggle error', err))
  }

  async function updateDispute(id, patch) {
    setSavingId(id)
    try {
      await fetch('/api/snapshot?type=dispute', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, ...patch }),
      })
      await onRefresh()
    } catch (err) {
      console.error('dispute update error', err)
    } finally {
      setSavingId(null)
    }
  }

  async function saveNotes(id) {
    if (notes[id] === undefined) return
    await updateDispute(id, { notes: notes[id] })
  }

  const allHaveOutcome = disputes.length > 0 && disputes.every(d => d.outcome)

  const INPUT = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

  return (
    <div className="space-y-5">

      {/* ── Hierarchy Totalizer ──────────────────────────────────────────────── */}
      {affectedAgents.length > 0 && (
        <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-6 sticky top-4 z-10">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3">Hierarchy Totalizer</h4>
          <div className="space-y-2">
            {affectedAgents.map(sfgId => {
              const base  = baseApvByAgent[sfgId] ?? 0
              const net   = getNetApv(sfgId)
              const color = thresholdColor(sfgId)
              const p     = personnelMap[sfgId]
              const name  = p?.opt_name || p?.preferred_name || disputeNameMap[sfgId] || sfgId
              return (
                <div key={sfgId} className="flex items-center gap-4 flex-wrap text-sm">
                  <span className="font-medium text-gray-800 dark:text-white/90 min-w-[160px]">
                    {name}
                    {p?.role && <span className="ml-1.5 text-xs text-gray-400 dark:text-white/40">({p.role})</span>}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-white/50">Base: <strong>{fmtAmt(base)}</strong></span>
                  <span className={`text-xs font-medium ${color === 'red' ? 'text-red-500' : color === 'green' ? 'text-green-500' : 'text-gray-600 dark:text-white/60'}`}>
                    Net: {fmtAmt(net)}
                    {color === 'red'   && ' 🔴'}
                    {color === 'green' && ' 🟢'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Dispute Cards ────────────────────────────────────────────────────── */}
      {disputes.length === 0 && (
        <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No disputes yet. Disputes are created from Step 1 discrepancy cards.</p>
        </div>
      )}

      {disputes.map(d => {
        const policy    = policyMap[d.policy_id]
        const agentName = resolveName(d.sfg_id)
        const included  = isIncluded(d)
        const jotLines  = buildJotformLines(agentName, d, policy)
        const noteVal   = notes[d.id] !== undefined ? notes[d.id] : (d.notes ?? '')

        return (
          <div key={d.id} className={`bg-white dark:bg-primary/30 border rounded-2xl overflow-hidden transition-colors ${included ? 'border-gray-200 dark:border-white/15' : 'border-red-200 dark:border-red-500/20 opacity-80'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{agentName}</span>
                {policy ? (
                  <>
                    <span className="text-xs text-gray-400 dark:text-white/40">{policy.policy_no ?? policy.policy_number ?? '—'}</span>
                    <span className="text-xs text-gray-500 dark:text-white/50">{policy.applicant}</span>
                    <span className="text-xs text-gray-500 dark:text-white/50">{policy.carrier}</span>
                  </>
                ) : d.dispute_type ? (
                  <span className="text-xs text-gray-400 dark:text-white/40">{d.dispute_type}</span>
                ) : null}
                {d.disputed_amount && <span className="text-sm font-bold text-accent">{fmtAmt(d.disputed_amount)}</span>}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleIncluded(d.id, true)}
                    className={`text-xs px-3 py-1 rounded-l-lg border transition-colors ${included ? 'bg-green-500/20 border-green-500/40 text-green-700 dark:text-green-300 font-medium' : 'border-gray-200 dark:border-white/15 text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >Include</button>
                  <button
                    onClick={() => toggleIncluded(d.id, false)}
                    className={`text-xs px-3 py-1 rounded-r-lg border border-l-0 transition-colors ${!included ? 'bg-red-500/20 border-red-500/40 text-red-600 dark:text-red-400 font-medium' : 'border-gray-200 dark:border-white/15 text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >Exclude</button>
                </div>
              )}
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Saved note reference block */}
              {d.notes && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-300 mb-0.5">Note (paste above Jotform if needed):</p>
                  <p className="text-xs text-gray-700 dark:text-white/70">{d.notes}</p>
                </div>
              )}

              {!readOnly && (
                <div>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Notes</p>
                  <textarea
                    rows={2}
                    value={noteVal}
                    onChange={e => setNotes(n => ({ ...n, [d.id]: e.target.value }))}
                    onBlur={() => saveNotes(d.id)}
                    className={INPUT + ' resize-none text-xs'}
                    placeholder="Add a note…"
                  />
                </div>
              )}

              {/* Policy edit trigger */}
              {policy && canWrite && (
                <button onClick={() => setEditPolicy(policy)} className="text-xs text-accent hover:underline">Edit policy record</button>
              )}

              {/* Jotform copy block */}
              {jotLines.length > 0 && <CopyBlock lines={jotLines} notes={noteVal || null} />}

              {/* Status workflow */}
              {!readOnly && (
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100 dark:border-white/10">
                  <span className="text-xs text-gray-400 dark:text-white/40">Status:</span>
                  {!d.submitted_at ? (
                    <button
                      onClick={() => updateDispute(d.id, { submitted_at: new Date().toISOString() })}
                      disabled={savingId === d.id || !included}
                      title={!included ? 'Cannot submit an excluded dispute' : undefined}
                      className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${included ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25' : 'bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-white/25 cursor-not-allowed'} disabled:opacity-60`}
                    >Mark Submitted</button>
                  ) : !d.outcome ? (
                    <>
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Submitted {fmtDate(d.submitted_at)}</span>
                      <button onClick={() => updateDispute(d.id, { outcome: 'approved', outcome_date: new Date().toISOString().slice(0, 10) })} className="text-xs px-3 py-1 rounded-lg bg-green-500/15 text-green-700 dark:text-green-300 hover:bg-green-500/25 font-medium transition-colors">Approved</button>
                      <button onClick={() => updateDispute(d.id, { outcome: 'denied',   outcome_date: new Date().toISOString().slice(0, 10) })} className="text-xs px-3 py-1 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 font-medium transition-colors">Denied</button>
                    </>
                  ) : (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d.outcome === 'approved' ? 'bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
                      {d.outcome === 'approved' ? 'Approved' : 'Denied'} {fmtDate(d.outcome_date)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* ── Completion gate ─────────────────────────────────────────────────── */}
      {allHaveOutcome && !cycle?.completed_at && canWrite && (
        <div className="flex justify-end">
          <button onClick={onStepComplete} className="text-sm font-semibold bg-accent text-white px-6 py-2 rounded-xl hover:bg-accent/90 transition-colors">
            Proceed to Promotions →
          </button>
        </div>
      )}

      {/* Policy edit modal */}
      {editPolicy && (
        <PolicyModalErrorBoundary onClose={() => setEditPolicy(null)}>
          <PolicyModal
            policy={editPolicy}
            personnel={personnel}
            onClose={() => setEditPolicy(null)}
            canWrite={canWrite}
            onUpdate={() => { setEditPolicy(null); onRefresh() }}
            onDelete={() => { setEditPolicy(null); onRefresh() }}
          />
        </PolicyModalErrorBoundary>
      )}
    </div>
  )
}
