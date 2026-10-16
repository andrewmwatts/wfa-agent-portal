import { useMemo, useState } from 'react'
import AgentLookup from './AgentLookup'
import { INPUT_CLS, STATUS_OPTIONS } from './PolicyEditModal'
import { validateIssuedDateConsistency } from '../../shared/policyValidation'
import { validateSplits } from '../../shared/policySplit'
import { fmtCurrency as fmtAmt } from '../utils/format'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

// ─── Split Policy workflow ─────────────────────────────────────────────────────
//
// Two variants, chosen up front:
//
//   Split Agents  — two agents share credit for ONE sale. The policy stays a
//                   single row; shares are recorded in policy_splits and every
//                   APV rollup pro-rates by them. Apps import from Opt under the
//                   primary only, so this is nearly always applied after import.
//   Split Clients — one agent's submission covered two different clients that
//                   got merged into a single Opt row. Genuinely two policies, so
//                   this still creates a sibling row.

export default function SplitPolicyModal({ policy, personnel, onClose, onSplitComplete }) {
  const [splitType, setSplitType] = useState(null) // null | 'agents' | 'clients'

  if (!splitType) {
    return <SplitChoiceDialog onChoose={setSplitType} onClose={onClose} />
  }

  const Workflow = splitType === 'agents' ? SplitAgentsWorkflow : SplitClientsWorkflow
  return (
    <Workflow
      policy={policy}
      personnel={personnel}
      onBack={() => setSplitType(null)}
      onClose={onClose}
      onSplitComplete={onSplitComplete}
    />
  )
}

// ─── Step 1: choose split type ─────────────────────────────────────────────────

function SplitChoiceDialog({ onChoose, onClose }) {
  useBodyScrollLock(true)
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 sm:backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 max-sm:border-x-0 max-sm:border-b-0 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md p-6 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Split Policy</h2>
          <p className="text-sm text-gray-600 dark:text-white/60 mt-1">
            Choose how this policy record needs to be split.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onChoose('agents')}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 dark:border-white/15 hover:border-accent hover:bg-accent/5 transition-colors"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Split Agents</p>
            <p className="text-[13px] text-gray-600 dark:text-white/60 mt-0.5">
              Two agents share credit for this one sale. Stays a single policy; APV is split between them.
            </p>
          </button>

          <button
            onClick={() => onChoose('clients')}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 dark:border-white/15 hover:border-accent hover:bg-accent/5 transition-colors"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Split Clients</p>
            <p className="text-[13px] text-gray-600 dark:text-white/60 mt-0.5">
              One agent's submission covered two different clients merged into a single Opt record. Creates a second policy.
            </p>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="text-sm sm:text-xs font-medium text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors px-3 sm:px-2 h-11 sm:h-auto sm:py-1 touch:sm:min-h-[44px] rounded-lg hover:bg-gray-100 dark:hover:bg-white/10">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared chrome ─────────────────────────────────────────────────────────────

function ModalShell({ title, subtitle, onBack, onClose, error, children, footer, wide = false }) {
  useBodyScrollLock(true)
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/60 sm:backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`flex flex-col w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-2xl'} h-dvh sm:h-auto sm:max-h-[90vh] bg-gray-50 dark:bg-secondary sm:border border-gray-200 dark:border-white/15 sm:rounded-2xl shadow-2xl overflow-hidden`}>
        <div className="shrink-0 flex items-start justify-between gap-2 px-4 sm:px-6 py-3 sm:py-6 max-sm:pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-200 dark:border-white/10 max-sm:bg-white dark:max-sm:bg-primary">
          <div className="min-w-0">
            <button onClick={onBack} className="flex items-center gap-1 text-sm sm:text-xs text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white transition-colors sm:mb-2 h-11 sm:h-auto touch:sm:min-h-[44px] -ml-1 pl-1 pr-2">
              <svg className="w-4 h-4 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Change split type
            </button>
            <h2 className="text-lg sm:text-base font-bold text-gray-900 dark:text-white">{title}</h2>
            <p className="text-sm text-gray-600 dark:text-white/60 mt-0.5 break-words">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 dark:text-white/50 hover:text-gray-900 dark:hover:text-white transition-colors p-1 max-sm:w-11 max-sm:h-11 max-sm:flex max-sm:items-center max-sm:justify-center touch:sm:p-2.5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {error && (
            <div className="mx-4 sm:mx-6 mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="px-4 py-4 sm:p-6 space-y-5">{children}</div>
        </div>

        {/* Phones: the primary button takes a full row on top, secondary buttons share the row below; one row from sm up */}
        <div className="shrink-0 px-4 sm:px-6 pt-3 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-gray-200 dark:border-white/10 max-sm:bg-white dark:max-sm:bg-primary flex flex-wrap sm:flex-nowrap sm:justify-end gap-2 sm:gap-3">{footer}</div>
      </div>
    </div>
  )
}

function num(v) {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return isNaN(n) ? 0 : n
}

// ─── Split Agents — shared credit on a single policy ───────────────────────────

const PRESETS = [
  { label: '50 / 50', primary: 50 },
  { label: '60 / 40', primary: 60 },
  { label: '40 / 60', primary: 40 },
]

function SplitAgentsWorkflow({ policy: p, personnel, onBack, onClose, onSplitComplete }) {
  const existing = p.splits ?? []
  const primaryId = String(p.sfg_id ?? '').trim().toUpperCase()

  // Seed from an existing split so re-opening edits rather than starts over.
  const seedPartner = existing.find(s => String(s.sfg_id).toUpperCase() !== primaryId)
  const seedPrimary = existing.find(s => String(s.sfg_id).toUpperCase() === primaryId)

  const [partnerId,  setPartnerId]  = useState(seedPartner?.sfg_id ?? '')
  const [primaryPct, setPrimaryPct] = useState(
    seedPrimary ? String(Math.round(Number(seedPrimary.credit_pct) * 1000) / 10) : '50'
  )
  const [saving,    setSaving]    = useState(false)
  const [removing,  setRemoving]  = useState(false)
  const [saveError, setSaveError] = useState(null)

  const submApv   = num(p.subm_apv ?? p.submitted_apv)
  const issuedApv = num(p.issued_apv)

  const pPct = Math.max(0, Math.min(100, num(primaryPct)))
  const sPct = Math.round((100 - pPct) * 10) / 10

  const nameOf = id => {
    const person = personnel.find(x => String(x.sfg_id).toUpperCase() === String(id).toUpperCase())
    return person?.name || person?.preferred_name || person?.opt_name || id
  }
  const primaryName = nameOf(p.sfg_id)

  // Editing a dollar amount back-computes the percentage, so manual entry stays
  // available without storing dollars (which would go stale when the carrier
  // issues at an amount different from what was submitted).
  function setPrimaryFromAmount(value, total) {
    if (!total) return
    setPrimaryPct(String(Math.round((num(value) / total) * 1000) / 10))
  }

  const clientError = useMemo(() => {
    if (!partnerId) return null
    return validateSplits(
      [{ sfg_id: primaryId, credit_pct: pPct / 100 }, { sfg_id: partnerId, credit_pct: sPct / 100 }],
      primaryId,
    )
  }, [partnerId, primaryId, pPct, sPct])

  async function save() {
    if (!partnerId) { setSaveError('Select the agent sharing this policy.'); return }
    if (clientError) { setSaveError(clientError); return }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies?type=splits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy_id: p.id,
          splits: [
            { sfg_id: primaryId,  credit_pct: pPct / 100 },
            { sfg_id: partnerId,  credit_pct: sPct / 100 },
          ],
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to save the split')
      }
      onSplitComplete?.()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeSplit() {
    if (!confirm('Remove the split? This policy will credit 100% to ' + primaryName + '.')) return
    setRemoving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies?type=splits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_id: p.id, splits: [] }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to remove the split')
      }
      onSplitComplete?.()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <ModalShell
      wide
      title="Split Agents"
      subtitle={`${p.applicant || 'Policy'} · ${p.carrier || '—'} · ${p.policy_no || '—'}`}
      onBack={onBack}
      onClose={onClose}
      error={saveError ?? clientError}
      footer={
        <>
          {existing.length > 0 && (
            <button onClick={removeSplit} disabled={saving || removing}
              className="sm:mr-auto max-sm:flex-1 text-sm px-4 py-2 max-sm:h-12 touch:sm:min-h-[44px] rounded-lg border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-40 transition-colors">
              {removing ? 'Removing…' : 'Remove Split'}
            </button>
          )}
          <button onClick={onClose} className="max-sm:flex-1 text-sm px-4 py-2 max-sm:h-12 touch:sm:min-h-[44px] rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving || removing || !partnerId || !!clientError}
            className="max-sm:order-first max-sm:basis-full text-sm px-5 py-2 max-sm:h-12 touch:sm:min-h-[44px] rounded-lg border border-accent bg-primary text-white dark:bg-white dark:text-primary font-semibold hover:bg-primary/85 dark:hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? 'Saving…' : existing.length > 0 ? 'Update Split' : 'Save Split'}
          </button>
        </>
      }
    >
      <p className="text-xs text-gray-500 dark:text-white/50">
        This stays a single policy. Each agent is credited their share of the APV; the
        application itself continues to count for {primaryName} only.
      </p>

      <div>
        <p className="text-xs max-sm:text-[13px] max-sm:font-medium text-gray-500 dark:text-white/60 mb-1">Sharing with</p>
        <AgentLookup
          personnel={personnel.filter(x => String(x.sfg_id).toUpperCase() !== primaryId)}
          value={partnerId}
          onSelect={person => setPartnerId(person.sfg_id)}
          onClear={() => setPartnerId('')}
        />
      </div>

      <div>
        <p className="text-xs max-sm:text-[13px] max-sm:font-medium text-gray-500 dark:text-white/60 mb-1.5">Preset ratios</p>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(preset => (
            <button
              key={preset.label}
              onClick={() => setPrimaryPct(String(preset.primary))}
              className={`px-3 py-1.5 max-sm:px-4 max-sm:h-11 touch:min-h-[44px] rounded-lg text-xs max-sm:text-sm font-semibold border transition-colors ${
                pPct === preset.primary
                  ? 'bg-accent/20 text-gray-900 dark:text-white border-accent'
                  : 'border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:border-accent'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phone: one card per agent */}
      <div className="sm:hidden space-y-3">
        <ShareCard
          label={primaryName}
          badge="Primary"
          pct={pPct}
          onPct={setPrimaryPct}
          submApv={submApv}
          issuedApv={issuedApv}
          onIssuedAmount={v => setPrimaryFromAmount(v, issuedApv)}
          onSubmAmount={v => setPrimaryFromAmount(v, submApv)}
        />
        <ShareCard
          label={partnerId ? nameOf(partnerId) : <span className="text-gray-500 dark:text-white/50">Select an agent…</span>}
          pct={sPct}
          onPct={v => setPrimaryPct(String(Math.round((100 - num(v)) * 10) / 10))}
          submApv={submApv}
          issuedApv={issuedApv}
          onIssuedAmount={v => setPrimaryFromAmount(issuedApv - num(v), issuedApv)}
          onSubmAmount={v => setPrimaryFromAmount(submApv - num(v), submApv)}
          disabled={!partnerId}
        />
        <p className="text-sm text-gray-600 dark:text-white/60 tabular-nums">
          Total {Math.round((pPct + sPct) * 10) / 10}% · Submitted {fmtAmt(submApv)} · Issued {fmtAmt(issuedApv)}
        </p>
      </div>

      <div className="hidden sm:block rounded-xl border border-gray-200 dark:border-white/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
            <tr>
              {['Agent', 'Share', 'Submitted APV', 'Issued APV'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500 dark:text-white/50">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            <ShareRow
              label={primaryName}
              badge="Primary"
              pct={pPct}
              onPct={setPrimaryPct}
              submApv={submApv}
              issuedApv={issuedApv}
              onIssuedAmount={v => setPrimaryFromAmount(v, issuedApv)}
              onSubmAmount={v => setPrimaryFromAmount(v, submApv)}
            />
            <ShareRow
              label={partnerId ? nameOf(partnerId) : <span className="text-gray-400 dark:text-white/30">Select an agent…</span>}
              pct={sPct}
              onPct={v => setPrimaryPct(String(Math.round((100 - num(v)) * 10) / 10))}
              submApv={submApv}
              issuedApv={issuedApv}
              onIssuedAmount={v => setPrimaryFromAmount(issuedApv - num(v), issuedApv)}
              onSubmAmount={v => setPrimaryFromAmount(submApv - num(v), submApv)}
              disabled={!partnerId}
            />
          </tbody>
          <tfoot className="bg-gray-100 dark:bg-white/5 border-t border-gray-200 dark:border-white/10">
            <tr>
              <td className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-white/50">Total</td>
              <td className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-white/80 tabular-nums">
                {Math.round((pPct + sPct) * 10) / 10}%
              </td>
              <td className="px-3 py-2 text-xs text-gray-500 dark:text-white/50 tabular-nums">{fmtAmt(submApv)}</td>
              <td className="px-3 py-2 text-xs text-gray-500 dark:text-white/50 tabular-nums">{fmtAmt(issuedApv)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ModalShell>
  )
}

// Phone layout of ShareRow: the same four values, stacked so every input is full-width.
function ShareCard({ label, badge, pct, onPct, submApv, issuedApv, onIssuedAmount, onSubmAmount, disabled }) {
  const input = 'w-full h-12 rounded-xl border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white text-base px-3 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40 tabular-nums'
  const lbl   = 'block mb-1 text-[13px] font-medium text-gray-500 dark:text-white/60'
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/15 bg-white dark:bg-primary/30 p-4">
      <p className="text-base font-semibold text-gray-900 dark:text-white mb-3">
        {label}
        {badge && <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 align-middle">{badge}</span>}
      </p>
      <label className="block mb-3">
        <span className={lbl}>Share (%)</span>
        <input type="number" inputMode="decimal" min="0" max="100" step="0.1" value={pct} disabled={disabled}
          onChange={e => onPct(e.target.value)} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={lbl}>Submitted APV</span>
          <input type="number" inputMode="decimal" step="0.01" disabled={disabled || !submApv}
            value={Math.round(submApv * pct) / 100} onChange={e => onSubmAmount(e.target.value)} className={input} />
        </label>
        <label className="block">
          <span className={lbl}>Issued APV</span>
          <input type="number" inputMode="decimal" step="0.01" disabled={disabled || !issuedApv}
            value={Math.round(issuedApv * pct) / 100} onChange={e => onIssuedAmount(e.target.value)} className={input} />
        </label>
      </div>
    </div>
  )
}

function ShareRow({ label, badge, pct, onPct, submApv, issuedApv, onIssuedAmount, onSubmAmount, disabled }) {
  const cellInput = 'w-28 rounded-lg border border-gray-300 dark:border-white/20 bg-white dark:bg-white/5 text-gray-900 dark:text-white text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40 tabular-nums'
  return (
    <tr>
      <td className="px-3 py-2.5 text-gray-900 dark:text-white">
        {label}
        {badge && <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">{badge}</span>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <input type="number" min="0" max="100" step="0.1" value={pct} disabled={disabled}
            onChange={e => onPct(e.target.value)} className={cellInput.replace('w-28', 'w-20')} />
          <span className="text-xs text-gray-400 dark:text-white/40">%</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <input type="number" step="0.01" disabled={disabled || !submApv}
          value={Math.round(submApv * pct) / 100}
          onChange={e => onSubmAmount(e.target.value)} className={cellInput} />
      </td>
      <td className="px-3 py-2.5">
        <input type="number" step="0.01" disabled={disabled || !issuedApv}
          value={Math.round(issuedApv * pct) / 100}
          onChange={e => onIssuedAmount(e.target.value)} className={cellInput} />
      </td>
    </tr>
  )
}

// ─── Split Clients — genuinely two policies ────────────────────────────────────

function SplitClientsWorkflow({ policy: p, personnel, onBack, onClose, onSplitComplete }) {
  const [origStatus,      setOrigStatus]      = useState(p.status ?? '')
  const [origIssuedApv,   setOrigIssuedApv]   = useState(p.issued_apv ?? '')
  const [origApplicant,   setOrigApplicant]   = useState(p.applicant ?? '')
  const [origPolicyNo,    setOrigPolicyNo]    = useState(p.policy_no ?? '')
  const [origAppNotes,    setOrigAppNotes]    = useState(p.application_notes ?? '')
  const [origPolicyNotes, setOrigPolicyNotes] = useState(p.policy_notes ?? '')

  const [newApplicant,   setNewApplicant]   = useState('')
  const [newPolicyNo,    setNewPolicyNo]    = useState('')
  const [newStatus,      setNewStatus]      = useState('')
  const [newIssuedApv,   setNewIssuedApv]   = useState('')
  const [newAppNotes,    setNewAppNotes]    = useState('')
  const [newPolicyNotes, setNewPolicyNotes] = useState('')

  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)

  function validate() {
    if (!newApplicant.trim()) return 'Enter the client name for the new policy.'
    if (!newPolicyNo.trim())  return 'Enter the policy number for the new policy.'

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
      const createRes = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })
      if (!createRes.ok) {
        const e = await createRes.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to create the new policy')
      }

      const updateRes = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id,
          updates: {
            applicant:         origApplicant,
            policy_number:     origPolicyNo,
            status:            origStatus,
            issued_apv:        origIssuedApv,
            application_notes: origAppNotes,
            policy_notes:      origPolicyNotes,
          },
        }),
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
    <ModalShell
      wide
      title="Split Clients"
      subtitle={`${p.policy_type || 'Policy'} · ${p.policy_no || '—'}`}
      onBack={onBack}
      onClose={onClose}
      error={saveError}
      footer={
        <>
          <button onClick={onClose} className="max-sm:flex-1 text-sm px-4 py-2 max-sm:h-12 touch:sm:min-h-[44px] rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="max-sm:order-first max-sm:basis-full text-sm px-5 py-2 max-sm:h-12 touch:sm:min-h-[44px] rounded-lg border border-accent bg-primary text-white dark:bg-white dark:text-primary font-semibold hover:bg-primary/85 dark:hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="hidden sm:grid grid-cols-2 gap-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/50">Original</p>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-white/50">New</p>
      </div>

      <SplitRow label="Client Name">
        <input type="text" value={origApplicant} onChange={e => setOrigApplicant(e.target.value)} className={INPUT_CLS} />
        <input type="text" value={newApplicant} onChange={e => setNewApplicant(e.target.value)} className={INPUT_CLS} placeholder="New client name" />
      </SplitRow>
      <SplitRow label="Policy Number">
        <input type="text" value={origPolicyNo} onChange={e => setOrigPolicyNo(e.target.value)} className={INPUT_CLS} />
        <input type="text" value={newPolicyNo} onChange={e => setNewPolicyNo(e.target.value)} className={INPUT_CLS} placeholder="New policy number" />
      </SplitRow>

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

      <SplitRow label="Application Notes" align="start">
        <textarea value={origAppNotes} onChange={e => setOrigAppNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
        <textarea value={newAppNotes} onChange={e => setNewAppNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
      </SplitRow>
      <SplitRow label="Policy Notes" align="start">
        <textarea value={origPolicyNotes} onChange={e => setOrigPolicyNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
        <textarea value={newPolicyNotes} onChange={e => setNewPolicyNotes(e.target.value)} rows={3} className={INPUT_CLS + ' resize-y'} />
      </SplitRow>
    </ModalShell>
  )
}

function SplitRow({ label, align = 'center', children }) {
  const [left, right] = children
  return (
    <div>
      <p className="text-xs max-sm:text-[13px] max-sm:font-medium text-gray-500 dark:text-white/60 mb-1">{label}</p>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 ${align === 'start' ? 'items-start' : 'items-center'}`}>
        <div>
          <span className="sm:hidden block mb-1 text-xs text-gray-500 dark:text-white/50">Original</span>
          {left}
        </div>
        <div>
          <span className="sm:hidden block mb-1 text-xs text-gray-500 dark:text-white/50">New</span>
          {right}
        </div>
      </div>
    </div>
  )
}
