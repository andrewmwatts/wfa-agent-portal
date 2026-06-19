import { useEffect, useMemo, useState } from 'react'
import PolicyModal, { PolicyModalErrorBoundary } from '../PolicyEditModal'
import { fmtDate, fmtCurrency as fmtAmt } from '../../utils/format'

const DISPUTE_TYPES = [
  'Missing policy', 'APV mismatch', 'Chargeback', 'Timing difference',
  'Split/Reset', 'Prior month carryover', 'Other',
]

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

function buildJotformLines(dispute, policy) {
  // Format: Carrier / Agent opt_name / Policy # / APV / Issue Date
  const carrier   = policy?.carrier ?? ''
  const agent     = dispute.agent_name ?? dispute.sfg_id
  const policyNo  = policy?.policy_no ?? policy?.policy_number ?? ''
  const apv       = policy?.issued_apv != null ? `$${Number(policy.issued_apv).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
  const issueDate = policy?.issue_date
    ? new Date(policy.issue_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : ''
  return [carrier, agent, policyNo, apv, issueDate].filter(Boolean)
}

// Build hierarchy chain for an sfg_id from personnel list
function getHierarchyChain(sfgId, personnelMap) {
  const chain = []
  let current = sfgId?.toUpperCase()
  const visited = new Set()
  while (current && !visited.has(current)) {
    visited.add(current)
    const p = personnelMap[current]
    if (!p) break
    chain.push(p)
    current = p.upline_sfg_id?.toUpperCase()
  }
  return chain
}

export default function Step2Disputes({ cycle, disputes, personnel, policies, monthPolicies = [], canWrite, onStepComplete, onRefresh }) {
  const [qualifications, setQualifications] = useState({})
  const [notes,          setNotes]          = useState({})   // dispute id → local note draft
  const [savingId,       setSavingId]       = useState(null)
  const [editPolicy,     setEditPolicy]     = useState(null)
  const [outcomePrompt,  setOutcomePrompt]  = useState(null) // dispute being approved

  const readOnly = !!cycle?.completed_at || !canWrite

  // Personnel lookup map
  const personnelMap = useMemo(() => {
    const m = {}
    for (const p of personnel) m[p.sfg_id?.toUpperCase()] = p
    return m
  }, [personnel])

  // Policy lookup by id
  const policyMap = useMemo(() => {
    const m = {}
    for (const p of policies) m[p.id] = p
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
  // Collect all unique agents affected by disputes + their full hierarchy
  const { affectedAgents, baseApvByAgent } = useMemo(() => {
    const affected = new Set()
    for (const d of disputes) if (d.sfg_id) affected.add(d.sfg_id.toUpperCase())

    // Also include uplines
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

    // Base APV = sum of issued policies for the month for each agent
    const base = {}
    for (const sfgId of withUplines) {
      base[sfgId] = monthPolicies
        .filter(p => p.sfg_id?.toUpperCase() === sfgId && p.status?.toLowerCase() === 'issued')
        .reduce((s, p) => s + (Number(p.issued_apv) || 0), 0)
    }

    return { affectedAgents: [...withUplines], baseApvByAgent: base }
  }, [disputes, personnelMap, policies])

  // Compute net APV (base minus excluded disputes affecting this agent)
  function getNetApv(sfgId) {
    const upper = sfgId.toUpperCase()
    let deduction = 0
    for (const d of disputes) {
      if (!d.included && d.sfg_id?.toUpperCase() === upper) {
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
    const thresholds = getThresholds(sfgId)
    for (const t of thresholds) {
      if (base >= t && net < t) return 'red'   // crosses below
      if (base < t && net >= t) return 'green'  // crosses above
    }
    return null
  }

  async function updateDispute(id, patch) {
    setSavingId(id)
    try {
      await fetch('/api/snapshot?type=dispute', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
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
              const p     = personnelMap[sfgId]
              if (!p) return null
              const base  = baseApvByAgent[sfgId] ?? 0
              const net   = getNetApv(sfgId)
              const color = thresholdColor(sfgId)
              return (
                <div key={sfgId} className="flex items-center gap-4 flex-wrap text-sm">
                  <span className="font-medium text-gray-800 dark:text-white/90 min-w-[160px]">
                    {p.opt_name ?? p.preferred_name ?? sfgId}
                    {p.role && <span className="ml-1.5 text-xs text-gray-400 dark:text-white/40">({p.role})</span>}
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
        const upper     = d.sfg_id?.toUpperCase()
        const pEntry    = personnelMap[upper]
        const agentName = pEntry?.opt_name || pEntry?.preferred_name || d.sfg_id
        const jotLines  = buildJotformLines({ ...d, agent_name: agentName }, policy)
        const isIncluded = d.included !== false
        const noteVal   = notes[d.id] !== undefined ? notes[d.id] : (d.notes ?? '')

        return (
          <div key={d.id} className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/15 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/10 flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{agentName}</span>
                {policy && (
                  <>
                    <span className="text-xs text-gray-400 dark:text-white/40">{policy.policy_no ?? policy.policy_number ?? '—'}</span>
                    <span className="text-xs text-gray-500 dark:text-white/50">{policy.applicant}</span>
                    <span className="text-xs text-gray-500 dark:text-white/50">{policy.carrier}</span>
                  </>
                )}
                {d.disputed_amount && <span className="text-sm font-bold text-accent">{fmtAmt(d.disputed_amount)}</span>}
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateDispute(d.id, { included: true })}
                    className={`text-xs px-3 py-1 rounded-l-lg border transition-colors ${isIncluded ? 'bg-green-500/20 border-green-500/40 text-green-700 dark:text-green-300 font-medium' : 'border-gray-200 dark:border-white/15 text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >Include</button>
                  <button
                    onClick={() => updateDispute(d.id, { included: false })}
                    className={`text-xs px-3 py-1 rounded-r-lg border border-l-0 transition-colors ${!isIncluded ? 'bg-red-500/20 border-red-500/40 text-red-600 dark:text-red-400 font-medium' : 'border-gray-200 dark:border-white/15 text-gray-400 dark:text-white/40 hover:bg-gray-50 dark:hover:bg-white/5'}`}
                  >Exclude</button>
                </div>
              )}
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Notes */}
              {d.notes && !readOnly && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-300 mb-0.5">Reference note (shown above Jotform — paste manually if needed):</p>
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
                      disabled={savingId === d.id}
                      className="text-xs px-3 py-1 rounded-lg bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25 transition-colors font-medium disabled:opacity-60"
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
