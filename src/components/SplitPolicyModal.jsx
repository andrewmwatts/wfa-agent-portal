import { useState } from 'react'
import AgentLookup from './AgentLookup'
import { INPUT_CLS, STATUS_OPTIONS } from './PolicyEditModal'
import { validateIssuedDateConsistency } from '../../shared/policyValidation'

// ─── Split Policy workflow ─────────────────────────────────────────────────────
//
// Two variants, chosen up front:
//
//   Split Agents  — the same policy number got merged in Opt across two agents
//                   (e.g. sibling policies combined). Creates a sibling policy
//                   row for a second agent, same client/policy identity.
//   Split Clients — one agent's submission covered two different clients that
//                   got merged into a single Opt row. Creates a sibling policy
//                   row for a second client under the same agent.
//
// Nothing is written until Save — the new row is created (POST) then the
// original is updated (PUT) as two sequential calls.

export default function SplitPolicyModal({ policy, personnel, onClose, onSplitComplete }) {
  const [splitType, setSplitType] = useState(null) // null | 'agents' | 'clients'

  if (!splitType) {
    return <SplitChoiceDialog onChoose={setSplitType} onClose={onClose} />
  }

  return (
    <SplitWorkflow
      policy={policy}
      personnel={personnel}
      splitType={splitType}
      onBack={() => setSplitType(null)}
      onClose={onClose}
      onSplitComplete={onSplitComplete}
    />
  )
}

// ─── Step 1: choose split type ─────────────────────────────────────────────────

function SplitChoiceDialog({ onChoose, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Split Policy</h2>
          <p className="text-sm text-gray-500 dark:text-white/50 mt-1">
            Choose how this policy record needs to be split.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onChoose('agents')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/15 hover:border-accent hover:bg-accent/5 transition-colors"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Split Agents</p>
            <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">
              Same client/policy got credited to two different agents (e.g. siblings' apps merged into one Opt record).
            </p>
          </button>

          <button
            onClick={() => onChoose('clients')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/15 hover:border-accent hover:bg-accent/5 transition-colors"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Split Clients</p>
            <p className="text-xs text-gray-500 dark:text-white/50 mt-0.5">
              One agent's submission covered two different clients merged into a single Opt record.
            </p>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="text-xs font-medium text-gray-400 dark:text-white/40 hover:text-gray-700 dark:hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 2: side-by-side workflow ─────────────────────────────────────────────

function SplitWorkflow({ policy: p, personnel, splitType, onBack, onClose, onSplitComplete }) {
  const isAgents = splitType === 'agents'

  // Original-side editable fields — pre-filled with current values
  const [origStatus,      setOrigStatus]      = useState(p.status ?? '')
  const [origIssuedApv,   setOrigIssuedApv]   = useState(p.issued_apv ?? '')
  const [origApplicant,   setOrigApplicant]   = useState(p.applicant ?? '')
  const [origPolicyNo,    setOrigPolicyNo]    = useState(p.policy_no ?? '')
  const [origAppNotes,    setOrigAppNotes]    = useState(p.application_notes ?? '')
  const [origPolicyNotes, setOrigPolicyNotes] = useState(p.policy_notes ?? '')

  // New-side editable fields — start blank
  const [newAgentId,      setNewAgentId]      = useState('')
  const [newApplicant,    setNewApplicant]    = useState('')
  const [newPolicyNo,     setNewPolicyNo]     = useState('')
  const [newStatus,       setNewStatus]       = useState('')
  const [newIssuedApv,    setNewIssuedApv]    = useState('')
  const [newAppNotes,     setNewAppNotes]     = useState('')
  const [newPolicyNotes,  setNewPolicyNotes]  = useState('')

  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)

  const origAgentName = personnel.find(pers => pers.sfg_id === p.sfg_id)?.name
    ?? personnel.find(pers => pers.sfg_id === p.sfg_id)?.preferred_name
    ?? p.agent ?? p.sfg_id

  function validate() {
    if (isAgents && !newAgentId) return 'Select the agent for the new policy.'
    if (!isAgents && !newApplicant.trim()) return 'Enter the client name for the new policy.'
    if (!isAgents && !newPolicyNo.trim()) return 'Enter the policy number for the new policy.'

    // Neither side edits Issue Date here — both inherit p.issue_date — so any
    // mismatch comes from the Status chosen for each side.
    const origErr = validateIssuedDateConsistency(origStatus, p.issue_date)
    if (origErr) return `Original policy: ${origErr}`
    const newErr = validateIssuedDateConsistency(newStatus, p.issue_date)
    if (newErr) return `New policy: ${newErr}`

    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { setSaveError(err); return }

    setSaving(true)
    setSaveError(null)
    try {
      const newBody = isAgents
        ? {
            sfg_id:       newAgentId,
            applicant:    p.applicant,
            carrier:      p.carrier,
            policy_type:  p.policy_type,
            policy_no:    p.policy_no,
            face_amt:     p.face_amt,
            subm_apv:     '',
            issued_apv:   newIssuedApv,
            status:       newStatus,
            submit_date:  p.submit_date,
            issue_date:   p.issue_date,
            app_notes:    '',
            policy_notes: p.policy_notes,
            split_reset:  true,
            last_update:  p.last_update,
          }
        : {
            sfg_id:       p.sfg_id,
            applicant:    newApplicant,
            carrier:      p.carrier,
            policy_type:  p.policy_type,
            policy_no:    newPolicyNo,
            face_amt:     p.face_amt,
            subm_apv:     '',
            issued_apv:   newIssuedApv,
            status:       newStatus,
            submit_date:  p.submit_date,
            issue_date:   p.issue_date,
            app_notes:    newAppNotes,
            policy_notes: newPolicyNotes,
            last_update:  p.last_update,
          }

      const createRes = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBody),
      })
      if (!createRes.ok) {
        const e = await createRes.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create the new policy')
      }

      const origUpdates = isAgents
        ? { status: origStatus, issued_apv: origIssuedApv, split_reset: true }
        : {
            applicant:         origApplicant,
            policy_number:     origPolicyNo,
            status:            origStatus,
            issued_apv:        origIssuedApv,
            application_notes: origAppNotes,
            policy_notes:      origPolicyNotes,
          }

      const updateRes = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, updates: origUpdates }),
      })
      if (!updateRes.ok) {
        const e = await updateRes.json().catch(() => ({}))
        throw new Error(
          `The new policy was created, but updating the original failed (${e.error || 'unknown error'}). ` +
          `Please check and correct the original policy manually.`
        )
      }

      onSplitComplete?.()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-white/10">
          <div>
            <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 dark:text-white/40 hover:text-accent transition-colors mb-2">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Change split type
            </button>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {isAgents ? 'Split Agents' : 'Split Clients'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">
              {p.policy_type || 'Policy'} · {p.policy_no || '—'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {saveError && (
          <div className="mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500 dark:text-red-300">
            {saveError}
          </div>
        )}

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Original</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">New</p>
          </div>

          {isAgents ? (
            <SplitRow label="Agent">
              <div className={INPUT_CLS + ' bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/50 cursor-not-allowed'}>
                {origAgentName}
              </div>
              <AgentLookup
                personnel={personnel}
                value={newAgentId}
                onSelect={person => setNewAgentId(person.sfg_id)}
                onClear={() => setNewAgentId('')}
              />
            </SplitRow>
          ) : (
            <>
              <SplitRow label="Client Name">
                <input type="text" value={origApplicant} onChange={e => setOrigApplicant(e.target.value)} className={INPUT_CLS} />
                <input type="text" value={newApplicant} onChange={e => setNewApplicant(e.target.value)} className={INPUT_CLS} placeholder="New client name" />
              </SplitRow>
              <SplitRow label="Policy Number">
                <input type="text" value={origPolicyNo} onChange={e => setOrigPolicyNo(e.target.value)} className={INPUT_CLS} />
                <input type="text" value={newPolicyNo} onChange={e => setNewPolicyNo(e.target.value)} className={INPUT_CLS} placeholder="New policy number" />
              </SplitRow>
            </>
          )}

          <SplitRow label="Status">
            <select value={origStatus} onChange={e => setOrigStatus(e.target.value)} className={INPUT_CLS}>
              <option value="">— select —</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={INPUT_CLS}>
              <option value="">— select —</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </SplitRow>

          <SplitRow label="Issued APV">
            <input type="number" step="0.01" value={origIssuedApv} onChange={e => setOrigIssuedApv(e.target.value)} className={INPUT_CLS} />
            <input type="number" step="0.01" value={newIssuedApv} onChange={e => setNewIssuedApv(e.target.value)} className={INPUT_CLS} />
          </SplitRow>

          {!isAgents && (
            <>
              <SplitRow label="Application Notes" align="start">
                <textarea value={origAppNotes} onChange={e => setOrigAppNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
                <textarea value={newAppNotes} onChange={e => setNewAppNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
              </SplitRow>
              <SplitRow label="Policy Notes" align="start">
                <textarea value={origPolicyNotes} onChange={e => setOrigPolicyNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
                <textarea value={newPolicyNotes} onChange={e => setNewPolicyNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
              </SplitRow>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SplitRow({ label, align = 'center', children }) {
  const [left, right] = children
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-1">{label}</p>
      <div className={`grid grid-cols-2 gap-6 ${align === 'start' ? 'items-start' : 'items-center'}`}>
        {left}
        {right}
      </div>
    </div>
  )
}
