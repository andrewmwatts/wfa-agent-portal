import { useEffect, useRef, useState } from 'react'

const EMPTY = {
  sfg_id:         '',
  opt_name:       '',
  preferred_name: '',
  npn:            '',
  hire_date:      '',
  birth_date:     '',
  upline_sfg_id:  '',
  status:         '',
  phone:          '',
  city:           '',
  state:          '',
  address:        '',
  zip:            '',
}

export default function AddAgentModal({ existingPersonnel, onClose, onAgentAdded }) {
  const [form,     setForm]     = useState(EMPTY)
  const [errors,   setErrors]   = useState({})
  const [saving,   setSaving]   = useState(false)
  const [apiError, setApiError] = useState('')

  const existingSfgIds = new Set(
    existingPersonnel.map(p => p.sfg_id?.toLowerCase()).filter(Boolean)
  )

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const e = {}
    if (!form.sfg_id.trim())
      e.sfg_id  = 'Required'
    else if (existingSfgIds.has(form.sfg_id.trim().toLowerCase()))
      e.sfg_id  = 'Already exists in personnel'
    if (!form.opt_name.trim())
      e.opt_name = 'Required'
    if (!form.upline_sfg_id.trim())
      e.upline_sfg_id = 'Required'
    return e
  }

  async function handleSave() {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }

    setSaving(true)
    setApiError('')
    try {
      const uplineId      = form.upline_sfg_id.trim()
      const uplineMissing = uplineId && !existingSfgIds.has(uplineId.toLowerCase())

      const payload = {
        rows: [{
          sfg_id:         form.sfg_id.trim(),
          opt_name:       form.opt_name.trim()       || null,
          preferred_name: form.preferred_name.trim() || null,
          npn:            form.npn.trim()            || null,
          hire_date:      form.hire_date             || null,
          birth_date:     form.birth_date            || null,
          upline_sfg_id:  uplineId                   || null,
          status:         form.status.trim()         || null,
          phone:          form.phone.trim()          || null,
          city:           form.city.trim()           || null,
          state:          form.state.trim()          || null,
          address:        form.address.trim()        || null,
          zip:            form.zip.trim()            || null,
        }],
      }

      const res  = await fetch('/api/import-agents', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) { setApiError(data.error ?? 'Unknown error'); return }
      if (data.inserted === 0 && data.skipped > 0) {
        setErrors({ sfg_id: 'Already exists in personnel' })
        return
      }

      onAgentAdded({ uplineWarning: uplineMissing })
    } catch (err) {
      setApiError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-primary rounded-2xl shadow-2xl w-full max-w-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/10 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add Agent</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">

          {/* Identity */}
          <Section label="Identity">
            <Row>
              <Field label="SFG ID" required error={errors.sfg_id}>
                <input type="text" value={form.sfg_id} onChange={e => set('sfg_id', e.target.value)}
                  placeholder="SFG0000000" className={inputCls(errors.sfg_id)} />
              </Field>
              <Field label="Status">
                <input type="text" value={form.status} onChange={e => set('status', e.target.value)}
                  placeholder="Active" className={inputCls()} />
              </Field>
            </Row>
            <Row>
              <Field label="Opt Name (full name in HQ)" required error={errors.opt_name}>
                <input type="text" value={form.opt_name} onChange={e => set('opt_name', e.target.value)}
                  placeholder="Smith, John A" className={inputCls(errors.opt_name)} />
              </Field>
              <Field label="Display Name">
                <input type="text" value={form.preferred_name} onChange={e => set('preferred_name', e.target.value)}
                  placeholder="John Smith" className={inputCls()} />
              </Field>
            </Row>
          </Section>

          {/* Credentials */}
          <Section label="Credentials">
            <Row>
              <Field label="NPN">
                <input type="text" value={form.npn} onChange={e => set('npn', e.target.value)}
                  className={inputCls()} />
              </Field>
              <Field label="Upline" required error={errors.upline_sfg_id}>
                <UplineLookup
                  personnel={existingPersonnel}
                  value={form.upline_sfg_id}
                  onChange={sfgId => set('upline_sfg_id', sfgId)}
                  error={errors.upline_sfg_id}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Hire Date">
                <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)}
                  className={inputCls()} />
              </Field>
              <Field label="Birth Date">
                <input type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)}
                  className={inputCls()} />
              </Field>
            </Row>
          </Section>

          {/* Contact */}
          <Section label="Contact">
            <Row>
              <Field label="Phone">
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)}
                  className={inputCls()} />
              </Field>
              <Field label="City">
                <input type="text" value={form.city} onChange={e => set('city', e.target.value)}
                  className={inputCls()} />
              </Field>
            </Row>
            <Row>
              <Field label="Street Address">
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)}
                  className={inputCls()} />
              </Field>
              <Field label="State">
                <input type="text" value={form.state} onChange={e => set('state', e.target.value)}
                  placeholder="TX" className={inputCls()} />
              </Field>
              <Field label="Zip">
                <input type="text" value={form.zip} onChange={e => set('zip', e.target.value)}
                  className={inputCls()} />
              </Field>
            </Row>
          </Section>

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
            {saving ? 'Saving…' : 'Add Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Upline name-lookup typeahead ───────────────────────────────────────────────

function UplineLookup({ personnel, value, onChange, error }) {
  // value = sfg_id of the currently selected upline ('' if none)
  const selected = value ? personnel.find(p => p.sfg_id === value) ?? null : null

  const [query, setQuery] = useState(
    selected ? (selected.name || selected.preferred_name || selected.full_name || '') : ''
  )
  const [open, setOpen] = useState(false)
  const containerRef    = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // If parent resets value to '' (e.g. form reset), clear query too
  useEffect(() => {
    if (!value) setQuery('')
  }, [value])

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
    onChange('')     // deselect until user picks from list
    setOpen(true)
  }

  function handleSelect(person) {
    setQuery(person.name || person.preferred_name || person.full_name || person.sfg_id)
    onChange(person.sfg_id)
    setOpen(false)
  }

  function handleClear() {
    setQuery('')
    onChange('')
    setOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        placeholder="Search by name…"
        className={inputCls(error) + ' pr-14'}
        autoComplete="off"
      />

      {/* Right-side indicators */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {selected && <span className="text-green-500 text-xs font-bold">✓</span>}
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="text-gray-300 hover:text-gray-500 dark:text-white/30 dark:hover:text-white/60 text-xs leading-none transition-colors"
            tabIndex={-1}
          >✕</button>
        )}
      </div>

      {/* Selected SFG ID hint */}
      {selected && (
        <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5 font-mono">{selected.sfg_id}</p>
      )}

      {/* Dropdown */}
      {open && results.length > 0 && (
        <ul className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl overflow-hidden">
          {results.map(p => (
            <li key={p.sfg_id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()} // prevent input blur before click
                onClick={() => handleSelect(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/10 flex items-center justify-between gap-3 transition-colors"
              >
                <span className="text-gray-900 dark:text-white truncate">
                  {p.name || p.preferred_name || p.full_name}
                </span>
                <span className="text-xs text-gray-400 dark:text-white/40 shrink-0 font-mono">
                  {p.sfg_id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* No results hint */}
      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white dark:bg-[#002b2e] border border-gray-200 dark:border-white/15 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-400 dark:text-white/40">
          No matches found
        </div>
      )}
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-white/40 uppercase tracking-wider mb-3">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ children }) {
  return <div className="flex gap-3 flex-wrap">{children}</div>
}

function Field({ label, required, error, children }) {
  return (
    <div className="flex-1 min-w-32">
      <label className="block text-xs text-gray-500 dark:text-white/50 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>}
    </div>
  )
}

function inputCls(error) {
  const base = 'w-full text-sm rounded-lg px-3 py-1.5 border focus:outline-none focus:ring-2 transition-colors bg-white dark:bg-white/5 text-gray-900 dark:text-white'
  return error
    ? `${base} border-red-400 focus:ring-red-400/30 focus:border-red-400`
    : `${base} border-gray-200 dark:border-white/15 focus:ring-accent/30 focus:border-accent/60`
}
