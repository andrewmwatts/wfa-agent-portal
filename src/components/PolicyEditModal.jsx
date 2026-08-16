import { Component, useEffect, useMemo, useRef, useState } from 'react'
import AgentLookup from './AgentLookup'
import SplitPolicyModal from './SplitPolicyModal'
import { normalizeCarrier } from '../../shared/carriers'
import { validateIssuedDateConsistency } from '../../shared/policyValidation'
import { toInputDate, fmtDate, fmtCurrency as fmtAmt } from '../utils/format'
import { getPolicyStatusClass } from '../utils/status'

// ─── Chargeback-exempt auto-compute ──────────────────────────────────────────

const CB_RULE_CARRIERS = new Set(['americo', 'banner', 'fidelity and guaranty', 'sbli'])

const CB_SNAPSHOT_STATUSES = new Set([
  'declined, on snapshot', 'not taken, on snapshot', 'withdrawn, on snapshot',
])

function monthsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const fm = String(fromIso).match(/^(\d{4})-(\d{2})/)
  const tm = String(toIso).match(/^(\d{4})-(\d{2})/)
  if (!fm || !tm) return null
  return (parseInt(tm[1]) - parseInt(fm[1])) * 12 + (parseInt(tm[2]) - parseInt(fm[2]))
}

export function computeChargebackExempt(conservation_status, conservation_date, issue_date, carrier) {
  if (!conservation_status?.trim()) return null
  const status  = conservation_status.trim().toLowerCase()
  const normCar = (normalizeCarrier(carrier ?? '') ?? '').toLowerCase()
  const inRuleSet = CB_RULE_CARRIERS.has(normCar)

  if (CB_SNAPSHOT_STATUSES.has(status)) return false

  if (inRuleSet) {
    if (status === 'cancelled') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo < 12) return false
    }
    if (status === 'lapsed' || status === 'lapse pending') {
      const mo = monthsBetween(issue_date, conservation_date)
      if (mo !== null && mo < 14) return false
    }
  }

  return true
}

// ─── Days-to-lapse helpers (used by the "lapse" view's header pill) ──────────

function daysToLapse(conservationDate) {
  if (!conservationDate) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const lapse = new Date(conservationDate); lapse.setHours(0, 0, 0, 0)
  return Math.round((lapse - today) / (1000 * 60 * 60 * 24))
}

function getUrgency(days) {
  if (days === null) return 'none'
  if (days < 0)   return 'overdue'
  if (days <= 7)  return 'critical'
  if (days <= 30) return 'warning'
  return 'normal'
}

// ─── Status badge ─────────────────────────────────────────────────────────────

export function StatusBadge({ status }) {
  if (!status) return <span className="text-gray-400 dark:text-white/30 text-xs">—</span>
  return <span className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${getPolicyStatusClass(status)}`}>{status}</span>
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const POLICY_COL_MAP = {
  sfg_id:              'sfg_id',
  applicant:           'applicant',
  carrier:             'carrier',
  policy_type:         'policy_name',
  policy_no:           'policy_number',
  status:              'status',
  subm_apv:            'submitted_apv',
  issued_apv:          'issued_apv',
  face_amt:            'face_amount',
  submit_date:         'submit_date',
  submit_week:         'submit_week',
  issue_date:          'issue_date',
  last_update:         'last_update',
  application_notes:   'application_notes',
  policy_notes:        'policy_notes',
  not_in_opt:          'not_in_opt',
  split_reset:         'split_reset',
  chargeback_exempt:   'chargeback_exempt',
  conservation_status: 'conservation_status',
  conservation_date:   'conservation_date',
  cb_month:            'snapshot_chargeback_month',
  cb_apv:              'snapshot_chargeback_apv',
}

export const POLICY_NUMERIC_KEYS = new Set(['subm_apv', 'issued_apv', 'face_amt', 'cb_apv'])
export const POLICY_BOOLEAN_KEYS = new Set(['not_in_opt', 'split_reset', 'chargeback_exempt'])

export const INPUT_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-gray-200 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/60'
export const INPUT_ERR_CLS = 'w-full bg-gray-100 dark:bg-primary/60 border border-red-400 text-gray-900 dark:text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400/40'

export const STATUS_OPTIONS = ['Pending', 'Incomplete', 'Issued', 'Declined', 'Withdrawn', 'Not taken']

const CONSERVATION_STATUS_OPTIONS = [
  'Cancelled',
  'Death',
  'Declined, On Snapshot',
  'First Premium Not Paid',
  'Lapse pending',
  'Lapsed',
  'Not Taken, On Snapshot',
  'Withdrawn, On Snapshot',
]

// Seed for a brand-new policy (mode="create") — internal key names match
// POLICY_COL_MAP's left-hand side throughout, translated to the POST body's
// slightly different field names only at the point of building the request.
const EMPTY_DRAFT = {
  sfg_id: '', agent: '', agent_email: '',
  applicant: '', carrier: '', policy_type: '', policy_no: '',
  face_amt: '', subm_apv: '', issued_apv: '',
  status: 'Pending',
  submit_date: new Date().toISOString().slice(0, 10),
  issue_date: '',
  application_notes: '', policy_notes: '',
  not_in_opt: false, split_reset: false,
}

// ─── Helper sub-components ────────────────────────────────────────────────────

export function EditField({ label, value, onChange, type = 'text', error }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={(error ? INPUT_ERR_CLS : INPUT_CLS) + (type === 'date' ? ' dark:[color-scheme:dark]' : '')}
      />
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>}
    </div>
  )
}

export function CheckEditField({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent rounded cursor-pointer"
      />
      <span className="text-sm text-gray-700 dark:text-white/80">{label}</span>
    </label>
  )
}

export function ModalSection({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30 mb-3">{title}</p>
      {children}
    </div>
  )
}

export function DetailGrid({ children }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-3">{children}</div>
}

/**
 * Who a shared policy's APV is credited to. The Financials figures above are
 * always the whole sale — this is how it divides, so the two are never confused.
 * Shares are stored as percentages, so the dollar columns are derived and follow
 * the carrier's issued amount automatically.
 */
export function SplitBreakdown({ splits, submApv, issuedApv, showSubmitted, primarySfgId }) {
  const num = v => {
    if (v == null || v === '') return 0
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
    return isNaN(n) ? 0 : n
  }
  const sub    = num(submApv)
  const issued = num(issuedApv)
  const norm   = s => String(s ?? '').trim().toUpperCase()
  const ordered = [...splits].sort((a, b) => Number(b.credit_pct) - Number(a.credit_pct))

  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-white/15 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/10">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-white/40">Shared Credit</span>
        <span className="text-[11px] text-gray-400 dark:text-white/35">{ordered.length} agents</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-white/35">
            <th className="text-left  font-semibold px-3 py-1.5">Agent</th>
            <th className="text-right font-semibold px-3 py-1.5">Share</th>
            {showSubmitted && <th className="text-right font-semibold px-3 py-1.5">Submitted</th>}
            <th className="text-right font-semibold px-3 py-1.5">Issued</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-white/10">
          {ordered.map(s => {
            const pct = Number(s.credit_pct) || 0
            return (
              <tr key={s.sfg_id}>
                <td className="px-3 py-2 text-gray-900 dark:text-white">
                  {s.agent || s.sfg_id}
                  {norm(s.sfg_id) === norm(primarySfgId) && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">
                      Primary
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent">
                  {Math.round(pct * 1000) / 10}%
                </td>
                {showSubmitted && (
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-white/80">{fmtAmt(sub * pct)}</td>
                )}
                <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-white/80">{fmtAmt(issued * pct)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-gray-400 dark:text-white/35 border-t border-gray-100 dark:border-white/10">
        The application itself counts for the primary agent only.
      </p>
    </div>
  )
}

export function DetailItem({ label, value, accent }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${accent ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-white/80'}`}>{value}</p>
    </div>
  )
}

export function CheckItem({ label, value }) {
  const checked = typeof value === 'boolean'
    ? value
    : !!value && !['false', '0', 'no', 'n', ''].includes(String(value).trim().toLowerCase())
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
        ${checked ? 'bg-accent/20 border-accent/50' : 'bg-gray-50 dark:bg-white/5 border-gray-300 dark:border-white/20'}`}>
        {checked && (
          <svg className="w-2.5 h-2.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className={`text-sm ${checked ? 'text-gray-700 dark:text-white/80' : 'text-gray-400 dark:text-white/35'}`}>{label}</span>
    </div>
  )
}

// Free-text input with a filtered dropdown of suggestions — used for
// Carrier / Policy Type in create mode (ported from the old AddPolicyModal).
function SuggestInput({ value, onChange, suggestions, placeholder, error }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const filtered = useMemo(() => {
    const q = (value ?? '').trim().toLowerCase()
    const list = q ? suggestions.filter(s => s.toLowerCase().includes(q)) : suggestions
    return list.slice(0, 12)
  }, [value, suggestions])

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={value ?? ''}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={error ? INPUT_ERR_CLS : INPUT_CLS}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {filtered.map(s => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/10 text-gray-900 dark:text-white transition-colors"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Error boundary ───────────────────────────────────────────────────────────

export class PolicyModalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={this.props.onClose}>
          <div className="bg-gray-50 dark:bg-secondary border border-red-300 dark:border-red-700/50 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Could not display this policy</p>
            <p className="text-xs text-gray-500 dark:text-white/50">{String(this.state.error)}</p>
            <button onClick={this.props.onClose}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white/70 hover:bg-gray-300 dark:hover:bg-white/20 transition-colors">
              Close
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Policy Modal ─────────────────────────────────────────────────────────────
//
// Single component for every policy create/edit/lapse-tracking surface in the
// app, gated by two props instead of five near-duplicate components:
//
//   mode: 'edit' (default) — editing an existing policy, starts in view state
//         'create'         — a brand-new policy, starts directly in edit state,
//                             posts instead of putting, no Delete/Split
//
//   view: 'full'  (default) — every field (Application/Policy/Financials/
//                              Flags/Open Requirements/Policy Notes/Conservation)
//         'lapse'            — the Client Engagement / Lapse tracking subset:
//                              Agent/Client are header-only (never editable
//                              here), Status/Submit Date/Submitted APV/Open
//                              Requirements are hidden, Flags are always
//                              view-only, and the header gets a days-to-lapse
//                              pill plus a "Remove Conservation" shortcut.
//
// limitedFields hides Submit Date / Face Amount / Submitted APV within 'full'
// view (used by the Snapshot reconciliation's restricted read-then-fix flow).

const NOT_IN_OPT_DELETE_STATUSES = ['declined', 'withdrawn', 'not taken']

export default function PolicyModal({
  policy: p, personnel = [], onClose, onBack, canWrite, onUpdate, onCreate, onDelete,
  agentPhone, viewerSfgId, limitedFields = false, initialEdit = false,
  allowSplit = false, onSplitComplete,
  mode = 'edit', view = 'full',
  existingCarriers = [], existingPolicyTypes = [],
}) {
  const isCreate = mode === 'create'
  const isLapse  = view === 'lapse'

  const [editing,         setEditing]         = useState(isCreate)
  const [draft,           setDraft]           = useState(isCreate ? { ...EMPTY_DRAFT } : null)
  const [saving,          setSaving]          = useState(false)
  const [saveError,       setSaveError]       = useState(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [deleting,        setDeleting]        = useState(false)
  const [confirmNotInOpt, setConfirmNotInOpt] = useState(false)
  const [splitOpen,       setSplitOpen]       = useState(false)
  const [removing,        setRemoving]        = useState(false)
  const [crosswalk,       setCrosswalk]       = useState([])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Open in edit mode immediately when requested (e.g. from an Edit button).
  // Not relevant in create mode — that already starts editing.
  useEffect(() => {
    if (!isCreate && initialEdit && canWrite) startEdit()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Carrier/Policy Type suggestions — only fetched for the create-mode SuggestInput.
  useEffect(() => {
    if (!isCreate) return
    fetch('/api/policies?type=crosswalk')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d)) setCrosswalk(d) })
      .catch(() => {})
  }, [isCreate])

  const carrierSuggestions = useMemo(() => {
    const s = new Set([...existingCarriers, ...crosswalk.map(r => r.carrier).filter(Boolean)])
    return [...s].sort()
  }, [existingCarriers, crosswalk])

  const policyTypeSuggestions = useMemo(() => {
    const carrier = (draft?.carrier ?? '').trim().toLowerCase()
    const fromCrosswalk = carrier
      ? crosswalk.filter(r => r.carrier?.toLowerCase() === carrier).map(r => r.policy_name)
      : crosswalk.map(r => r.policy_name)
    const s = new Set([...fromCrosswalk, ...existingPolicyTypes].filter(Boolean))
    return [...s].sort()
  }, [crosswalk, existingPolicyTypes, draft?.carrier])

  function startEdit() {
    const initialDraft = { ...p }
    if (initialDraft.chargeback_exempt == null && initialDraft.conservation_status?.trim()) {
      const exempt = computeChargebackExempt(
        initialDraft.conservation_status,
        initialDraft.conservation_date,
        initialDraft.issue_date,
        initialDraft.carrier,
      )
      if (exempt !== null) initialDraft.chargeback_exempt = exempt
    }
    setDraft(initialDraft)
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    if (isCreate) { onClose(); return }
    setEditing(false)
    setDraft(null)
    setSaveError(null)
  }

  function setField(key, value) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function setConservationField(key, value) {
    setDraft(d => {
      const updated = { ...d, [key]: value }
      const exempt = computeChargebackExempt(
        updated.conservation_status,
        updated.conservation_date,
        updated.issue_date,
        updated.carrier,
      )
      if (exempt !== null) updated.chargeback_exempt = exempt
      return updated
    })
  }

  function handleSave() {
    if (!draft) return
    if (isCreate) { doCreate(); return }
    const s = draft.status?.toLowerCase()
    if (draft.not_in_opt && NOT_IN_OPT_DELETE_STATUSES.includes(s)) {
      setConfirmNotInOpt(true)
      return
    }
    doSave()
  }

  async function doCreate() {
    if (!draft) return
    if (!draft.sfg_id)          { setSaveError('Agent is required.'); return }
    if (!draft.applicant.trim()) { setSaveError('Client name is required.'); return }
    if (!draft.carrier.trim())   { setSaveError('Carrier is required.'); return }
    if (!draft.status)           { setSaveError('Status is required.'); return }
    if (!draft.submit_date)      { setSaveError('Submit Date is required.'); return }
    const consistencyError = validateIssuedDateConsistency(draft.status, draft.issue_date)
    if (consistencyError) { setSaveError(consistencyError); return }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          app_notes:   draft.application_notes,
          last_update: new Date().toISOString().slice(0, 10),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error ?? 'Unknown error'); return }
      onCreate?.()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function doSave() {
    if (!draft) return
    const consistencyError = validateIssuedDateConsistency(draft.status, draft.issue_date)
    if (consistencyError) { setSaveError(consistencyError); return }
    setSaving(true)
    setSaveError(null)
    try {
      const becomingIssued = draft.status?.toLowerCase() === 'issued' && p.status?.toLowerCase() !== 'issued'
      const effectiveDraft = becomingIssued
        ? { ...draft, application_notes: '', last_update: draft.issue_date || new Date().toISOString().slice(0, 10) }
        : draft

      const typedDraft = { ...effectiveDraft }
      for (const key of POLICY_NUMERIC_KEYS) {
        const v = typedDraft[key]
        typedDraft[key] = (v === '' || v === null || v === undefined) ? null : Number(v) || 0
      }

      const updates = {}
      for (const [key, col] of Object.entries(POLICY_COL_MAP)) {
        const v = typedDraft[key]
        if (POLICY_NUMERIC_KEYS.has(key)) {
          updates[col] = v
        } else if (POLICY_BOOLEAN_KEYS.has(key)) {
          updates[col] = !!v
        } else {
          const str = String(v ?? '')
          // Don't overwrite computed week fields with null when the policy was
          // loaded from a context that doesn't include them (snapshot, dashboard)
          if ((col === 'submit_week' || col === 'submit_week_num') && !str) continue
          updates[col] = str
        }
      }
      if (typedDraft.chargeback_exempt === null || typedDraft.chargeback_exempt === undefined) {
        delete updates['chargeback_exempt']
      }
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id, updates }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      onUpdate?.(typedDraft)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch('/api/policies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Delete failed')
      }
      onDelete?.(p.id)
      onClose()
    } catch (e) {
      setSaveError(e.message)
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // "lapse" view only — clears conservation tracking without opening the full
  // edit form, mirroring the old standalone Lapse modals' quick action.
  async function handleRemoveConservation() {
    setRemoving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, updates: { conservation_status: '', conservation_date: '' } }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Remove failed') }
      onUpdate?.({ ...p, conservation_status: '', conservation_date: '' })
      onClose()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setRemoving(false)
    }
  }

  const display = editing ? draft : p

  // "lapse" view header extras
  const lapseDays    = isLapse ? daysToLapse(display?.conservation_date) : null
  const lapseUrgency = getUrgency(lapseDays)
  const lapseDaysLabel = lapseDays === null ? null
    : lapseDays < 0   ? `${Math.abs(lapseDays)}d overdue`
    : lapseDays === 0 ? 'Due today'
    : `${lapseDays}d remaining`
  const lapseDaysCls = (lapseUrgency === 'overdue' || lapseUrgency === 'critical')
    ? 'bg-red-500/15 text-red-500 dark:text-red-300'
    : lapseUrgency === 'warning'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'

  if (!display) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-50 dark:bg-secondary border border-gray-200 dark:border-white/15 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-white/10">
          <div className="flex-1 min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-xs text-gray-400 dark:text-white/40 hover:text-accent transition-colors mb-2"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to search
              </button>
            )}
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {isCreate ? 'Add Policy' : (display.applicant || 'Unnamed Client')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-white/50 mt-0.5">
              {isCreate
                ? 'New policy'
                : isLapse
                  ? (display.agent || '—')
                  : `${display.policy_type || 'Policy'} · ${normalizeCarrier(display.carrier) || '—'}`}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            {isLapse && lapseDaysLabel && (
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap flex-shrink-0 ${lapseDaysCls}`}>
                {lapseDaysLabel}
              </span>
            )}
            {!editing && !isLapse && (() => {
              const sl = p.status?.toLowerCase()?.trim() ?? ''
              const notAgent = viewerSfgId && p.sfg_id && viewerSfgId.toLowerCase() !== p.sfg_id.toLowerCase()
              if (notAgent && agentPhone && ['', 'pending', 'incomplete'].includes(sl)) {
                return (
                  <a
                    href={`sms:${agentPhone}`}
                    onClick={e => e.stopPropagation()}
                    title="Text agent"
                    className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 dark:text-white/40 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </a>
                )
              }
              return null
            })()}
            {isLapse && agentPhone && viewerSfgId && p.sfg_id && viewerSfgId.toLowerCase() !== p.sfg_id.toLowerCase() && (
              <a
                href={`sms:${agentPhone}`}
                onClick={e => e.stopPropagation()}
                title="Text agent"
                className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 dark:text-white/40 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </a>
            )}
            {!editing && !isLapse && <StatusBadge status={display.status} />}
            {canWrite && !editing && isLapse && display.conservation_status && (
              <button
                onClick={handleRemoveConservation}
                disabled={removing}
                className="text-xs font-medium text-red-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {removing ? 'Removing…' : 'Remove Conservation'}
              </button>
            )}
            {canWrite && !editing && allowSplit && (
              <button
                onClick={() => setSplitOpen(true)}
                className="text-xs font-medium text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white transition-colors px-2 py-1 rounded-lg border border-gray-200 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/5"
              >
                {p?.splits?.length ? 'Edit Split' : 'Split'}
              </button>
            )}
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
                {!isCreate && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                )}
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
                  {saving ? 'Saving…' : isCreate ? 'Add Policy' : 'Save'}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors p-1">
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

        {confirmDelete && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-lg flex items-center justify-between gap-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              Permanently delete this policy? This cannot be undone.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        {confirmNotInOpt && (
          <div className="mx-6 mt-4 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              This policy is not in Opt. Would you like to delete it?
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => { setConfirmNotInOpt(false); doSave() }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20 text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                No, keep it
              </button>
              <button
                onClick={() => { setConfirmNotInOpt(false); handleDelete() }}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="p-6 space-y-6">

          {!isLapse && (
            <ModalSection title="Application">
              {editing ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Agent{isCreate && <span className="text-red-400 ml-0.5">*</span>}</p>
                    <AgentLookup
                      personnel={personnel}
                      value={draft.sfg_id ?? ''}
                      onSelect={person => setDraft(d => ({
                        ...d,
                        sfg_id:      person.sfg_id,
                        agent:       person.name || person.preferred_name || person.full_name || '',
                        agent_email: person.email || '',
                      }))}
                      onClear={() => setDraft(d => ({ ...d, sfg_id: '', agent: '', agent_email: '' }))}
                    />
                  </div>
                  <EditField label={isCreate ? 'Client *' : 'Client'} value={draft.applicant} onChange={v => setField('applicant', v)} />
                  <div className="col-span-2">
                    <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Status{isCreate && <span className="text-red-400 ml-0.5">*</span>}</p>
                    <select
                      value={draft.status ?? ''}
                      onChange={e => setField('status', e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="">— select —</option>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {!limitedFields && (
                    <EditField
                      label={isCreate ? 'Submit Date *' : 'Submit Date'}
                      value={toInputDate(draft.submit_date)}
                      onChange={v => setField('submit_date', v)}
                      type="date"
                    />
                  )}
                  <EditField label="Issue Date" value={toInputDate(draft.issue_date)} onChange={v => setField('issue_date', v)} type="date" />
                  {!isCreate && (
                    <EditField label="Last Update" value={toInputDate(draft.last_update)} onChange={v => setField('last_update', v)} type="date" />
                  )}
                </div>
              ) : (
                <DetailGrid>
                  <DetailItem label="Agent"       value={display.agent} />
                  <DetailItem label="Client"      value={display.applicant} />
                  {!limitedFields && <DetailItem label="Submit Date" value={fmtDate(display.submit_date)} />}
                  <DetailItem label="Issue Date"  value={fmtDate(display.issue_date)} />
                  <DetailItem label="Last Update" value={fmtDate(display.last_update)} />
                </DetailGrid>
              )}
            </ModalSection>
          )}

          <ModalSection title="Policy Details">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {isCreate ? (
                  <div>
                    <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Carrier <span className="text-red-400 ml-0.5">*</span></p>
                    <SuggestInput value={draft.carrier} onChange={v => setField('carrier', v)} suggestions={carrierSuggestions} placeholder="Banner, Foresters…" />
                  </div>
                ) : (
                  <EditField label="Carrier" value={draft.carrier} onChange={v => setField('carrier', v)} />
                )}
                {isCreate ? (
                  <div>
                    <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Policy Type</p>
                    <SuggestInput value={draft.policy_type} onChange={v => setField('policy_type', v)} suggestions={policyTypeSuggestions} placeholder="Term 20, WL…" />
                  </div>
                ) : (
                  <EditField label="Policy Type" value={draft.policy_type} onChange={v => setField('policy_type', v)} />
                )}
                <EditField label="Policy No." value={draft.policy_no} onChange={v => setField('policy_no', v)} />
                {!limitedFields && <EditField label="Face Amount" value={draft.face_amt} onChange={v => setField('face_amt', v)} />}
              </div>
            ) : (
              <DetailGrid>
                <DetailItem label="Carrier"     value={normalizeCarrier(display.carrier)} />
                <DetailItem label="Raw Carrier" value={normalizeCarrier(display.carrier) !== display.carrier ? display.carrier : null} />
                <DetailItem label="Policy Type" value={display.policy_type} />
                <DetailItem label="Policy No."  value={display.policy_no} />
                {!limitedFields && <DetailItem label="Face Amount" value={display.face_amt
                  ? '$' + Number(display.face_amt.toString().replace(/[$,]/g, '')).toLocaleString()
                  : '—'} />}
              </DetailGrid>
            )}
          </ModalSection>

          <ModalSection title="Financials">
            {editing ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {!limitedFields && !isLapse && <EditField label="Submitted APV" value={draft.subm_apv ?? ''} onChange={v => setField('subm_apv', v)} type="number" />}
                <EditField label="Issued APV" value={draft.issued_apv ?? ''} onChange={v => setField('issued_apv', v)} type="number" />
              </div>
            ) : (
              <DetailGrid>
                {!limitedFields && !isLapse && <DetailItem label="Submitted APV" value={fmtAmt(display.subm_apv)} accent />}
                <DetailItem label="Issued APV"    value={fmtAmt(display.issued_apv)} accent />
              </DetailGrid>
            )}
            {/* The figures above are the whole sale; this is who it's credited to */}
            {p?.splits?.length > 0 && (
              <SplitBreakdown
                splits={p.splits}
                submApv={display.subm_apv}
                issuedApv={display.issued_apv}
                showSubmitted={!limitedFields && !isLapse}
                primarySfgId={p.sfg_id}
              />
            )}
          </ModalSection>

          <ModalSection title="Flags">
            {editing && !isLapse ? (
              <div className="flex gap-6">
                <CheckEditField label="Not in Opt"   checked={!!draft.not_in_opt}  onChange={v => setField('not_in_opt',  v)} />
                <CheckEditField label="Split / Reset" checked={!!draft.split_reset} onChange={v => setField('split_reset', v)} />
              </div>
            ) : (
              <div className="flex gap-6">
                <CheckItem label="Not in Opt"   value={display.not_in_opt} />
                <CheckItem label="Split / Reset" value={display.split_reset} />
              </div>
            )}
          </ModalSection>

          {!isLapse && (
            <ModalSection title="Open Requirements">
              {editing ? (
                <div>
                  <p className="text-xs text-gray-400 dark:text-white/40 mb-1">Application Notes</p>
                  <textarea
                    value={draft.application_notes ?? ''}
                    onChange={e => setField('application_notes', e.target.value)}
                    rows={3}
                    className={INPUT_CLS + ' resize-y'}
                  />
                </div>
              ) : display.application_notes ? (
                <p className="text-sm text-amber-300/90 leading-relaxed">{display.application_notes}</p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-white/30">—</p>
              )}
            </ModalSection>
          )}

          <ModalSection title="Policy Notes">
            {editing ? (
              <div>
                <textarea
                  value={draft.policy_notes ?? ''}
                  onChange={e => setField('policy_notes', e.target.value)}
                  rows={3}
                  className={INPUT_CLS + ' resize-y'}
                />
              </div>
            ) : display.policy_notes ? (
              <p className="text-sm text-gray-700 dark:text-white/80 leading-relaxed">{display.policy_notes}</p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-white/30">—</p>
            )}
          </ModalSection>

          {!isCreate && (
            <ModalSection title="Conservation">
              {editing ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-white/40 mb-0.5">Conservation Status</p>
                    <select
                      value={draft.conservation_status ?? ''}
                      onChange={e => setConservationField('conservation_status', e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="">—</option>
                      {CONSERVATION_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <EditField label="Expected Date" value={toInputDate(draft.conservation_date)} onChange={v => setConservationField('conservation_date', v)} type="date" />
                  <EditField label="Snapshot Chargeback Month" value={draft.cb_month ?? ''} onChange={v => setField('cb_month', v)} />
                  <EditField label="Snapshot Chargeback APV" value={draft.cb_apv ?? ''} onChange={v => setField('cb_apv', v)} />
                  <div className="col-span-2 pt-1">
                    <CheckEditField
                      label="Chargeback Exempt"
                      checked={draft.chargeback_exempt === true}
                      onChange={v => setField('chargeback_exempt', v)}
                    />
                  </div>
                </div>
              ) : (display.conservation_status || display.conservation_date || display.cb_month || display.cb_apv || display.chargeback_exempt != null) ? (
                <DetailGrid>
                  <DetailItem label="Status"        value={display.conservation_status} />
                  <DetailItem label="Expected Date" value={fmtDate(display.conservation_date)} />
                  <DetailItem label="Snapshot Chargeback Month" value={display.cb_month} />
                  <DetailItem label="Snapshot Chargeback APV"   value={display.cb_apv} />
                  {display.chargeback_exempt != null && (
                    <CheckItem label="Chargeback Exempt" value={String(display.chargeback_exempt)} />
                  )}
                </DetailGrid>
              ) : (
                <p className="text-sm text-gray-400 dark:text-white/30">—</p>
              )}
            </ModalSection>
          )}

          {isCreate && !isLapse && (
            <p className="text-xs text-gray-400 dark:text-white/30">
              Conservation tracking becomes available once this policy is saved.
            </p>
          )}

        </div>
      </div>

      {allowSplit && splitOpen && (
        <SplitPolicyModal
          policy={p}
          personnel={personnel}
          onClose={() => setSplitOpen(false)}
          onSplitComplete={() => {
            setSplitOpen(false)
            onSplitComplete?.()
          }}
        />
      )}
    </div>
  )
}
