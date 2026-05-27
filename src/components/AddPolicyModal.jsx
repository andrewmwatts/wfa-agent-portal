import { useEffect, useRef, useState } from 'react'

const STATUS_OPTIONS = [
  'Pending', 'Incomplete', 'Issued', 'Declined',
  'Not Taken', 'Withdrawn', 'Cancelled', 'Lapsed',
  'Lapse Pending', 'First Premium Not Paid',
]

const EMPTY = {
  sfg_id:      '',
  agent:       '',
  agent_email: '',
  applicant:   '',
  carrier:     '',
  policy_type: '',
  policy_no:   '',
  face_amt:    '',
  subm_apv:    '',
  status:      'Pending',
  submit_date: new Date().toISOString().slice(0, 10),
  app_notes:   '',
  not_in_opt:  false,
  split_reset: false,
}

const INPUT_CLS = 'w-full text-sm rounded-lg px-3 py-1.5 border focus:outline-none focus:ring-2 transition-colors bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/15 focus:ring-accent/30 focus:border-accent/60'
const INPUT_ERR = 'w-full text-sm rounded-lg px-3 py-1.5 border focus:outline-none focus:ring-2 transition-colors bg-white dark:bg-white/5 text-gray-900 dark:text-white border-red-400 focus:ring-red-400/30 focus:border-red-400'

export default function AddPolicyModal({ personnel, onClose, onPolicyAdded }) {
  const [form,     setForm]     = useState(EMPTY)
  const [errors,   setErrors]   = useState({})
  const [saving,   setSaving]   = useState(false)
  const [apiError, setApiError] = useState('')

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.sfg_id)    e.sfg_id    = 'Required'
    if (!form.applicant.trim()) e.applicant = 'Required'
    if (!form.carrier.trim())   e.carrier   = 'Required'
    if (!form.status)    e.status    = 'Required'
    if (!form.submit_date) e.submit_date = 'Required'
    return e
  }

  async function handleSave() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }

    setSaving(true)
    setApiError('')
    try {
      const res = await fetch('/api/policies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...form,
          last_update: new Date().toISOString().slice(0, 10),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setApiError(data.error ?? 'Unknown error'); return }
      onPolicyAdded()
    } catch (err) {
      setApiError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add Policy</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">

          {/* Agent */}
          <FormSection label="Agent">
            <Field label="Agent" required error={errors.sfg_id}>
              <AgentLookup
                personnel={personnel}
                value={form.sfg_id}
                onSelect={p => {
                  setForm(f => ({
                    ...f,
                    sfg_id:      p.sfg_id,
                    agent:       p.name || p.preferred_name || p.full_name || '',
                    agent_email: p.email || '',
                  }))
                  if (errors.sfg_id) setErrors(e => ({ ...e, sfg_id: '' }))
                }}
                onClear={() => setForm(f => ({ ...f, sfg_id: '', agent: '', agent_email: '' }))}
                error={errors.sfg_id}
              />
            </Field>
          </FormSection>

          {/* Application */}
          <FormSection label="Application">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client Name" required error={errors.applicant}>
                <input type="text" value={form.applicant} onChange={e => set('applicant', e.target.value)}
                  placeholder="Jane Smith" className={errors.applicant ? INPUT_ERR : INPUT_CLS} />
              </Field>
              <Field label="Submit Date" required error={errors.submit_date}>
                <input type="date" value={form.submit_date} onChange={e => set('submit_date', e.target.value)}
                  className={(errors.submit_date ? INPUT_ERR : INPUT_CLS) + ' dark:[color-scheme:dark]'} />
              </Field>
            </div>
          </FormSection>

          {/* Policy */}
          <FormSection label="Policy">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier" required error={errors.carrier}>
                <input type="text" value={form.carrier} onChange={e => set('carrier', e.target.value)}
                  placeholder="Banner, Foresters…" className={errors.carrier ? INPUT_ERR : INPUT_CLS} />
              </Field>
              <Field label="Policy Type">
                <input type="text" value={form.policy_type} onChange={e => set('policy_type', e.target.value)}
                  placeholder="Term 20, WL…" className={INPUT_CLS} />
              </Field>
              <Field label="Policy No.">
                <input type="text" value={form.policy_no} onChange={e => set('policy_no', e.target.value)}
                  className={INPUT_CLS} />
              </Field>
              <Field label="Face Amount">
                <input type="text" value={form.face_amt} onChange={e => set('face_amt', e.target.value)}
                  placeholder="250000" className={INPUT_CLS} />
              </Field>
            </div>
          </FormSection>

          {/* Financials & Status */}
          <FormSection label="Financials & Status">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Submitted APV">
                <input type="number" value={form.subm_apv} onChange={e => set('subm_apv', e.target.value)}
                  placeholder="0" className={INPUT_CLS} />
              </Field>
              <Field label="Status" required error={errors.status}>
                <select value={form.status} onChange={e => set('status', e.target.value)}
                  className={errors.status ? INPUT_ERR : INPUT_CLS}>
                  <option value="">— select —</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </FormSection>

          {/* Flags */}
          <FormSection label="Flags">
            <div className="flex gap-6">
              <CheckboxField
                label="Not in Opt"
                checked={form.not_in_opt}
                onChange={v => set('not_in_opt', v)}
              />
              <CheckboxField
                label="Split / Reset"
                checked={form.split_reset}
                onChange={v => set('split_reset', v)}
              />
            </div>
          </FormSection>

          {/* Notes */}
          <FormSection label="Application Notes">
            <textarea
              value={form.app_notes}
              onChange={e => set('app_notes', e.target.value)}
              rows={3}
              placeholder="Open requirements, follow-up items…"
              className={INPUT_CLS + ' resize-y'}
            />
          </FormSection>

          {apiError && <p className="text-sm text-red-500 dark:text-red-400">{apiError}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-white/10 flex justify-end gap-3 shrink-0">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-white/20 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="text-sm px-5 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? 'Saving…' : 'Add Policy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Agent name-lookup typeahead ────────────────────────────────────────────────

function AgentLookup({ personnel, value, onSelect, onClear, error }) {
  const selected = value ? personnel.find(p => p.sfg_id === value) ?? null : null

  const [query, setQuery] = useState(
    selected ? (selected.name || selected.preferred_name || selected.full_name || '') : ''
  )
  const [open,  setOpen]  = useState(false)
  const containerRef      = useRef(null)

  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  useEffect(() => { if (!value) setQuery('') }, [value])

  const results = query.trim().length > 0
    ? personnel
        .filter(p => {
          const name = (p.name || p.preferred_name || p.full_name || '').toLowerCase()
          const id   = (p.sfg_id ?? '').toLowerCase()
          const q    = query.trim().toLowerCase()
          return name.includes(q) || id.startsWith(q)
        })
        .slice(0, 8)
    : []

  function handleInputChange(e) {
    setQuery(e.target.value)
    onClear()
    setOpen(true)
  }

  function handleSelect(person) {
    setQuery(person.name || person.preferred_name || person.full_name || person.sfg_id)
    onSelect(person)
    setOpen(false)
  }

  function handleClear() {
    setQuery('')
    onClear()
    setOpen(false)
  }

  const cls = error
    ? INPUT_ERR + ' pr-14'
    : INPUT_CLS + ' pr-14'

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        placeholder="Search by name…"
        className={cls}
        autoComplete="off"
      />

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {selected && <span className="text-green-500 text-xs font-bold">✓</span>}
        {query && (
          <button type="button" onClick={handleClear} tabIndex={-1}
            className="text-gray-300 hover:text-gray-500 dark:text-white/30 dark:hover:text-white/60 text-xs leading-none transition-colors">
            ✕
          </button>
        )}
      </div>

      {selected && (
        <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5 font-mono">{selected.sfg_id}</p>
      )}

      {open && results.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl overflow-hidden">
          {results.map(p => (
            <li key={p.sfg_id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleSelect(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/10 flex items-center justify-between gap-3 transition-colors"
              >
                <span className="text-gray-900 dark:text-white truncate">
                  {p.name || p.preferred_name || p.full_name}
                </span>
                <span className="text-xs text-gray-400 dark:text-white/40 shrink-0 font-mono">{p.sfg_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-400 dark:text-white/40">
          No matches found
        </div>
      )}
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function FormSection({ label, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider mb-3">{label}</p>
      {children}
    </div>
  )
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-accent cursor-pointer"
      />
      <span className="text-sm text-gray-700 dark:text-white/70">{label}</span>
    </label>
  )
}

function Field({ label, required, error, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>}
    </div>
  )
}
