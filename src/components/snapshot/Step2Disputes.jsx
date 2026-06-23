import { useEffect, useMemo, useRef, useState } from 'react'
import PolicyModal, { PolicyModalErrorBoundary } from '../PolicyEditModal'
import { fmtDate, fmtCurrency as fmtAmt } from '../../utils/format'

// ── CopyBlock ─────────────────────────────────────────────────────────────────

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
          <div key={i}><span className="select-all">{line}</span></div>
        ))}
      </div>
    </div>
  )
}

// ── Jotform line builder ───────────────────────────────────────────────────────

function buildJotformLines(agentName, dispute, policy) {
  const carrier   = policy?.carrier ?? dispute.carrier ?? ''
  const policyNo  = policy?.policy_no ?? policy?.policy_number ?? ''
  const rawApv    = policy?.issued_apv ?? dispute.disputed_amount
  // Always show positive amount in Jotform copy regardless of direction sign
  const apv       = rawApv != null
    ? `$${Math.abs(Number(rawApv)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : ''
  const issueDate = policy?.issue_date
    ? new Date(policy.issue_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : ''
  return [carrier, agentName, policyNo, apv, issueDate].filter(Boolean)
}

// ── HierarchyChain ────────────────────────────────────────────────────────────
// Shows APV + promotion targets for the writing agent and all uplines.

function HierarchyChain({ sfgId, disputes, includedOverride, agentMonthApv, personnelMap, disputeNameMap, qualifications }) {
  // Walk up the hierarchy — trim everywhere to survive trailing spaces in DB values
  const chain = []
  let current = sfgId?.trim().toUpperCase()
  const visited = new Set()
  while (current && !visited.has(current)) {
    visited.add(current)
    chain.push(current)
    const p = personnelMap[current]
    if (!p?.upline_sfg_id) break
    current = p.upline_sfg_id.trim().toUpperCase()
  }

  // Sorted thresholds: [ { level, regular, slingshot, writers }, ... ]
  const thresholds = useMemo(() => {
    return Object.entries(qualifications)
      .map(([level, q]) => ({
        level,
        regular:   Number(q.regular)   || 0,
        slingshot: q.slingshot != null ? Number(q.slingshot) : null,
        writers:   q.writers   ?? null,
      }))
      .filter(t => t.regular > 0)
      .sort((a, b) => a.regular - b.regular)
  }, [qualifications])

  if (chain.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 overflow-hidden text-xs">
      <div className="px-3 py-1.5 bg-gray-50 dark:bg-white/5 border-b border-gray-100 dark:border-white/10">
        <span className="font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Hierarchy</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-white/5">
        {chain.map((id, idx) => {
          const p      = personnelMap[id]
          const name   = p?.opt_name || p?.preferred_name || disputeNameMap[id] || id

          // Net APV: base already reflects issued - actual chargebacks (server-computed).
          // Included disputes adjust the total by their signed disputed_amount:
          //   positive = we're contesting a deduction (adds back credit)
          //   negative = we're flagging an overcount (reduces total)
          const base = agentMonthApv[id] ?? 0
          let adjustment = 0
          for (const d of disputes) {
            const inc = includedOverride[d.id] !== undefined ? includedOverride[d.id] : d.included !== false
            if (!inc) continue
            let cur = d.sfg_id?.trim().toUpperCase()
            const seen = new Set()
            while (cur && !seen.has(cur)) {
              if (cur === id) { adjustment += Number(d.disputed_amount) || 0; break }
              seen.add(cur)
              const up = personnelMap[cur]
              if (!up?.upline_sfg_id) break
              cur = up.upline_sfg_id.trim().toUpperCase()
            }
          }
          const net = base + adjustment

          // Next unmet promote threshold
          const nextT = thresholds.find(t => t.regular > net)

          return (
            <div key={id} className="px-3 py-2.5 flex flex-wrap gap-x-4 gap-y-1 items-baseline">
              {/* Name + role */}
              <div className="min-w-[150px]">
                <span className={`font-medium ${idx === 0 ? 'text-gray-800 dark:text-white/90' : 'text-gray-600 dark:text-white/60'}`}>{name}</span>
                {p?.role && <span className="ml-1 text-gray-400 dark:text-white/30">({p.role})</span>}
              </div>

              {/* Net APV */}
              <span className={`font-bold tabular-nums ${adjustment > 0 ? 'text-amber-600 dark:text-amber-300' : adjustment < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-white/80'}`}>
                {fmtAmt(net)}
                {adjustment !== 0 && (
                  <span className="font-normal text-gray-400 dark:text-white/30 ml-1">
                    {adjustment > 0 ? '+' : '−'}{fmtAmt(Math.abs(adjustment))} disputed
                  </span>
                )}
              </span>

              {/* Promote target */}
              {nextT ? (
                <span className="text-red-500 dark:text-red-400">
                  Promote {nextT.level}: {fmtAmt(nextT.regular)} (need {fmtAmt(nextT.regular - net)})
                </span>
              ) : thresholds.length > 0 ? (
                <span className="text-green-600 dark:text-green-400">All targets met</span>
              ) : null}

              {/* Slingshot target */}
              {nextT?.slingshot != null && nextT.slingshot > 0 && (
                net >= nextT.slingshot
                  ? <span className="text-green-600 dark:text-green-400">Slingshot ✓ ({fmtAmt(nextT.slingshot)})</span>
                  : <span className="text-amber-600 dark:text-amber-300">Slingshot {nextT.level}: {fmtAmt(nextT.slingshot)} (need {fmtAmt(nextT.slingshot - net)})</span>
              )}

              {/* Writers / leadership threshold */}
              {nextT?.writers && (
                <span className="text-purple-600 dark:text-purple-300">Writers: {nextT.writers} req.</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Step2Disputes({ cycle, disputes, personnel, policies, agentMonthApv = {}, canWrite, onStepComplete, onRefresh }) {
  const [qualifications,   setQualifications]   = useState({})
  const [notes,            setNotes]            = useState({})
  const [includedOverride, setIncludedOverride] = useState({})
  const [savingId,         setSavingId]         = useState(null)
  const [editPolicy,       setEditPolicy]       = useState(null)

  const readOnly = !!cycle?.completed_at || !canWrite

  // Clear include overrides when the disputes list itself changes (set membership)
  const prevDisputeIds = useRef(null)
  useEffect(() => {
    const ids = disputes.map(d => d.id).join(',')
    if (prevDisputeIds.current !== null && prevDisputeIds.current !== ids) {
      setIncludedOverride({})
    }
    prevDisputeIds.current = ids
  }, [disputes])

  function isIncluded(d) {
    return includedOverride[d.id] !== undefined ? includedOverride[d.id] : d.included !== false
  }

  // Personnel lookup
  const personnelMap = useMemo(() => {
    const m = {}
    for (const p of personnel) if (p.sfg_id) m[p.sfg_id.trim().toUpperCase()] = p
    return m
  }, [personnel])

  // Server-resolved names from dispute rows (reliable even when personnelMap is sparse)
  const disputeNameMap = useMemo(() => {
    const m = {}
    for (const d of disputes) {
      if (d.sfg_id && d.agent_name) m[d.sfg_id.trim().toUpperCase()] = d.agent_name
    }
    return m
  }, [disputes])

  function resolveName(sfgId) {
    const upper = sfgId?.trim().toUpperCase()
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

  // Qualifications from activity endpoint
  useEffect(() => {
    fetch('/api/activity?type=qualifications')
      .then(r => r.json())
      .then(d => setQualifications(d.qualifications ?? {}))
      .catch(() => {})
  }, [])

  // Include/exclude: optimistic local update, fire-and-forget (no page refresh)
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

  // Stable sort by creation order so refreshes don't reorder cards
  const sortedDisputes = [...disputes].sort((a, b) => {
    if (a.created_at && b.created_at) return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    return 0
  })

  const allHaveOutcome = disputes.length > 0 && disputes.every(d => !isIncluded(d) || d.outcome)

  const INPUT = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'

  return (
    <div className="space-y-5">

      {disputes.length === 0 && (
        <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-400 dark:text-white/40">No disputes yet. Disputes are created from Step 1 discrepancy cards.</p>
        </div>
      )}

      {sortedDisputes.map(d => {
        const policy    = policyMap[d.policy_id]
        const agentName = resolveName(d.sfg_id)
        const included  = isIncluded(d)
        const jotLines  = buildJotformLines(agentName, d, policy)
        const noteVal   = notes[d.id] !== undefined ? notes[d.id] : (d.notes ?? '')
        const isReduce  = (d.disputed_amount ?? 0) < 0

        return (
          <div key={d.id} className={`bg-white dark:bg-primary/30 border rounded-2xl overflow-hidden transition-colors ${included ? 'border-gray-200 dark:border-white/15' : 'border-red-200 dark:border-red-500/20 opacity-80'}`}>

            {/* ── Card header ──────────────────────────────────────────────── */}
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
                {/* Amount + direction badge (read-only; set in Step 1) */}
                {d.disputed_amount != null && (
                  <>
                    <span className={`text-sm font-bold ${isReduce ? 'text-red-500 dark:text-red-400' : 'text-accent'}`}>
                      {isReduce ? '−' : ''}{fmtAmt(Math.abs(d.disputed_amount))}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isReduce ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-green-500/15 text-green-700 dark:text-green-400'}`}>
                      {isReduce ? 'Reduces total' : 'Adds to total'}
                    </span>
                  </>
                )}
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

            {/* ── Card body ────────────────────────────────────────────────── */}
            <div className="px-6 py-4 space-y-4">

              {/* Saved note reference */}
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

              {policy && canWrite && (
                <button onClick={() => setEditPolicy(policy)} className="text-xs text-accent hover:underline">Edit policy record</button>
              )}

              {jotLines.length > 0 && <CopyBlock lines={jotLines} notes={noteVal || null} />}

              {/* ── Hierarchy chain ──────────────────────────────────────── */}
              <HierarchyChain
                sfgId={d.sfg_id}
                disputes={disputes}
                includedOverride={includedOverride}
                agentMonthApv={agentMonthApv}
                personnelMap={personnelMap}
                disputeNameMap={disputeNameMap}
                qualifications={qualifications}
              />

              {/* ── Status workflow ──────────────────────────────────────── */}
              {!readOnly && (
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100 dark:border-white/10">
                  <span className="text-xs text-gray-400 dark:text-white/40">Status:</span>
                  {!d.submitted_at ? (
                    <button
                      onClick={() => updateDispute(d.id, { submitted_at: new Date().toISOString() })}
                      disabled={savingId === d.id || !included}
                      title={!included ? 'Cannot submit an excluded dispute' : undefined}
                      className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors disabled:opacity-60 ${
                        included
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25'
                          : 'bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-white/25 cursor-not-allowed'
                      }`}
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

      {/* Completion gate */}
      {allHaveOutcome && !cycle?.completed_at && canWrite && (
        <div className="flex justify-end">
          <button onClick={onStepComplete} className="text-sm font-semibold bg-accent text-white px-6 py-2 rounded-xl hover:bg-accent/90 transition-colors">
            Proceed to Promotions →
          </button>
        </div>
      )}

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
