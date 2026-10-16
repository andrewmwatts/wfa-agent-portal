import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { typeCfg, ageFromDob, getLeadTZ } from './leadHelpers'
import { fmtPhone, phoneDigits } from '../../utils/format'
import Icon from './icons'
import { CONDITIONS, RELATIONSHIPS, EMPTY_PREP, cqfPrefill, mergeCqf, setIn } from './cqfConfig'

// Client Qualification Form — opened from the lead card and filled in on the call.
// Health details that affect insurability live here, not on the lead card. Anything the
// lead card already knows (DOB, smoker, beneficiary…) is prefilled. Every change autosaves
// to leads.cqf / leads.carrier_prep after a short pause, and once more on close.

const INPUT = 'w-full text-base rounded-lg px-3 py-2.5 border bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-300 dark:border-white/15 placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors'
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1'

function Section({ title, hint, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-primary/30 shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-3 border-b border-gray-200 dark:border-white/10 border-l-4 border-l-accent dark:border-l-accent bg-primary/5 dark:bg-white/5">
        <h3 className="text-lg font-extrabold text-primary dark:text-white">{title}</h3>
        {hint && <p className="w-full sm:w-auto text-sm text-gray-500 dark:text-white/55">{hint}</p>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Text({ label, value, onChange, type = 'text', placeholder, className = '' }) {
  return (
    <div className={className}>
      {label && <label className={LABEL}>{label}</label>}
      <input type={type} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className={INPUT + (type === 'date' ? ' dark:[color-scheme:dark]' : '')} />
    </div>
  )
}

function Area({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <div>
      {label && <label className={LABEL}>{label}</label>}
      <textarea rows={rows} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={INPUT + ' resize-y'} />
    </div>
  )
}

// True when the form sits in the docked 640px lead pane (iPad landscape): the viewport is
// wide, but the form is not, so two-column rows would squeeze every field.
const PaneCtx = createContext(false)

function Two({ children }) {
  const pane = useContext(PaneCtx)
  return <div className={`grid grid-cols-1 ${pane ? '' : 'md:grid-cols-2'} gap-6`}>{children}</div>
}

function Col({ title, children }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-extrabold uppercase tracking-wider text-gray-700 dark:text-white/80 pb-1 border-b border-primary/15 dark:border-white/15">{title}</p>
      {children}
    </div>
  )
}

// pane: render inside the docked lead pane (no fixed overlay, no scripts column or toggle).
export default function CqfView({ lead, onClose, onSave, scriptsNode, scriptsOpen, onToggleScripts, pane = false }) {
  const prefill = useMemo(() => cqfPrefill(lead), [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const initialPrep = useMemo(() => {
    const p = lead.carrier_prep ?? {}
    const options = [0, 1, 2].map(i => p.options?.[i] ?? {})
    return { ...EMPTY_PREP, ...p, options }
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const [cqf, setCqf]   = useState(() => mergeCqf(prefill, lead.cqf ?? undefined))
  const [prep, setPrep] = useState(initialPrep)
  const [saveState, setSaveState] = useState('idle') // idle | dirty | saving | saved | error

  const latest = useRef({ cqf, prep })
  const dirty  = useRef({ cqf: false, prep: false })
  const timer  = useRef(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const d = dirty.current
    if (!d.cqf && !d.prep) return
    const fields = {}
    if (d.cqf)  fields.cqf = latest.current.cqf
    if (d.prep) fields.carrier_prep = latest.current.prep
    dirty.current = { cqf: false, prep: false }
    setSaveState('saving')
    const ok = await onSaveRef.current(lead.id, fields)
    if (ok === false) {
      dirty.current = { cqf: dirty.current.cqf || d.cqf, prep: dirty.current.prep || d.prep }
      setSaveState('error')
    } else if (!dirty.current.cqf && !dirty.current.prep) {
      setSaveState('saved')
    }
  }, [lead.id])

  function touch(kind, next) {
    latest.current[kind] = next
    dirty.current[kind]  = true
    setSaveState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 800)
  }

  const upd = (path, v) => { const next = setIn(latest.current.cqf, path, v); setCqf(next); touch('cqf', next) }
  const updPrep = (path, v) => { const next = setIn(latest.current.prep, path, v); setPrep(next); touch('prep', next) }

  // Save whatever is pending when the form closes
  useEffect(() => () => { flush() }, [flush])

  const tc     = typeCfg(lead.lead_type)
  const tz     = getLeadTZ(lead.state)
  const digits = phoneDigits(lead.phone)
  const c      = cqf.client ?? {}
  const sp     = cqf.spouse ?? {}

  function setDob(who, dob) {
    upd([who, 'dob'], dob)
    const a = ageFromDob(dob)
    if (a != null) upd([who, 'age'], a)
  }

  // Plain render functions (not components): defined inside the form, a component type
  // would remount on every keystroke and drop focus.
  const personCol = (who, label) => {
    const p = cqf[who] ?? {}
    return (
      <Col title={label}>
        {who === 'client' ? (
          <div className="grid grid-cols-2 gap-3">
            <Text label="First name" value={p.first_name} onChange={v => upd([who, 'first_name'], v)} />
            <Text label="Last name"  value={p.last_name}  onChange={v => upd([who, 'last_name'], v)} />
          </div>
        ) : (
          <Text label="Name" value={p.name} onChange={v => upd([who, 'name'], v)} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Text label="Birthday" type="date" value={p.dob} onChange={v => setDob(who, v)} />
          <Text label="Age" type="number" value={p.age} onChange={v => upd([who, 'age'], v === '' ? '' : Number(v))} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Text label="Height (ft)" type="number" value={p.ft}     onChange={v => upd([who, 'ft'], v)} />
          <Text label="(in)"        type="number" value={p.inch}   onChange={v => upd([who, 'inch'], v)} />
          <Text label="Weight (lb)" type="number" value={p.weight} onChange={v => upd([who, 'weight'], v)} />
        </div>
        <label className="flex items-center gap-3 rounded-lg border border-gray-300 dark:border-white/15 px-4 py-3 cursor-pointer select-none">
          <input type="checkbox" checked={!!p.smoker} onChange={e => upd([who, 'smoker'], e.target.checked)} className="w-5 h-5 rounded accent-accent" />
          <span className="text-base font-medium text-gray-800 dark:text-white/80">Smoker / tobacco</span>
        </label>
      </Col>
    )
  }

  const conditionsCol = (who, label) => {
    const state = cqf.conditions?.[who] ?? {}
    return (
      <Col title={label}>
        <div className="flex flex-wrap gap-2">
          {CONDITIONS.map(cond => {
            const on = !!state[cond.key]?.on
            return (
              <button key={cond.key} type="button"
                onClick={() => upd(['conditions', who, cond.key], { on: !on, a: state[cond.key]?.a ?? ['', '', ''] })}
                className={`text-base font-medium px-4 py-2 rounded-full border-2 transition-colors ${
                  on ? 'border-accent bg-accent/15 text-gray-900 dark:text-white font-semibold' : 'border-gray-300 dark:border-white/20 text-gray-700 dark:text-white/70 hover:border-accent/60'
                }`}
              >{on && <Icon name="check" className="inline w-4 h-4 mr-1.5 -mt-0.5 text-accent" />}{cond.label}</button>
            )
          })}
        </div>
        {CONDITIONS.filter(cond => state[cond.key]?.on).map(cond => (
          <div key={cond.key} className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
            <p className="text-base font-bold text-gray-900 dark:text-white">{cond.label} <span className="text-sm font-normal opacity-70">— all optional</span></p>
            {cond.qs.map((q, i) => (
              <Text key={i} label={q} value={state[cond.key]?.a?.[i]} onChange={v => upd(['conditions', who, cond.key, 'a', i], v)} />
            ))}
          </div>
        ))}
        <Text label="Other — any other conditions" value={cqf.other_conditions?.[who]} onChange={v => upd(['other_conditions', who], v)} />
      </Col>
    )
  }

  const saveLabel = { idle: '', dirty: 'Unsaved changes…', saving: 'Saving…', saved: '✓ Saved', error: '⚠ Couldn’t save' }[saveState]

  return (
    <PaneCtx.Provider value={pane}>
    <div className={pane
      ? 'flex-1 min-h-0 flex flex-col bg-gray-50 dark:bg-secondary'
      : 'fixed top-[var(--header-h)] right-0 bottom-0 left-0 lg:left-[var(--nav-w,4rem)] xl:left-[var(--nav-w,14rem)] z-40 flex flex-col bg-gray-50 dark:bg-secondary !mt-0'}>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-primary/30 shrink-0">
        {!pane && (
          <button onClick={() => { flush(); onClose() }} className="text-base font-semibold px-4 py-2 min-h-11 rounded-lg border border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10 transition-colors">← Back to lead</button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-white/60">Client Qualification Form</p>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white truncate">
            {lead.name} <span className={`ml-1 align-middle text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary dark:bg-white/10 dark:text-white/80`}>{tc.label}</span>
            {tz && <span className={`ml-3 text-sm font-semibold ${tz.goodTime ? 'text-gray-700 dark:text-white/80' : 'text-red-600 dark:text-red-300'}`}>{tz.label} {tz.timeStr}</span>}
          </h2>
        </div>
        <span className={`text-sm font-medium ${saveState === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-white/50'}`}>
          {saveLabel}
          {saveState === 'error' && <button onClick={flush} className="ml-2 underline font-semibold">Retry</button>}
        </span>
        {digits && (
          <a href={`tel:+1${digits}`} className="flex items-center gap-2 rounded-xl bg-primary text-white dark:bg-white dark:text-primary hover:opacity-90 px-5 py-2 text-lg font-bold shadow-sm transition-opacity"><Icon name="phone" className="w-5 h-5" />{fmtPhone(lead.phone)}</a>
        )}
        {onToggleScripts && !pane && (
          <button onClick={onToggleScripts}
            className={`text-base font-semibold px-4 py-2 min-h-11 rounded-lg transition-colors ${scriptsOpen ? 'bg-primary text-white dark:bg-white dark:text-primary' : 'border border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10'}`}
          ><span className="inline-flex items-center gap-2"><Icon name="script" className="w-5 h-5" />{scriptsOpen ? 'Hide scripts' : 'Scripts'}</span></button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {scriptsOpen && !pane && scriptsNode}

        <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain p-4 sm:p-6 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="max-w-5xl mx-auto space-y-5">

            <Section title="Client’s why" hint="Who are they protecting, and why does this coverage matter to them?">
              <Area value={cqf.why} onChange={v => upd(['why'], v)} rows={3} placeholder="e.g. Wants to protect spouse and two kids — doesn’t want them losing the house." />
            </Section>

            <Section title="General information" hint="Prefilled from the lead card where it was known.">
              <Two>
                {personCol('client', 'Client')}
                {personCol('spouse', 'Spouse / other')}
              </Two>
            </Section>

            <Section title="Medical concerns" hint="Tap any that apply — each opens its follow-up questions.">
              {lead.medical === true && (
                <p className="mb-4 rounded-lg border-l-4 border-accent bg-accent/10 text-gray-900 dark:text-white px-4 py-2 text-base font-medium">The lead form flagged major medical history.</p>
              )}
              <Two>
                {conditionsCol('client', 'Client')}
                {conditionsCol('spouse', 'Spouse / other')}
              </Two>
            </Section>

            <Section title="Medications">
              <Two>
                <Col title="Client"><Area value={cqf.medications?.client} onChange={v => upd(['medications', 'client'], v)} rows={4} placeholder="Medication, dose, what it’s for" /></Col>
                <Col title="Spouse / other"><Area value={cqf.medications?.spouse} onChange={v => upd(['medications', 'spouse'], v)} rows={4} placeholder="Medication, dose, what it’s for" /></Col>
              </Two>
            </Section>

            <Section title="Miscellaneous">
              <Two>
                <Text label="Occupation (client)" value={c.occupation} onChange={v => upd(['client', 'occupation'], v)} />
                <Text label="Occupation (spouse / other)" value={sp.occupation} onChange={v => upd(['spouse', 'occupation'], v)} />
                <Text label="Beneficiary full name" value={cqf.beneficiary_name} onChange={v => upd(['beneficiary_name'], v)} />
                <div>
                  <label className={LABEL}>Relationship</label>
                  <select value={cqf.beneficiary_relationship ?? ''} onChange={e => upd(['beneficiary_relationship'], e.target.value)} className={INPUT + ' cursor-pointer'}>
                    <option value="">Select</option>
                    {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Children?</label>
                  <select value={cqf.children ?? ''} onChange={e => upd(['children'], e.target.value)} className={INPUT + ' cursor-pointer'}>
                    <option value="">—</option><option>Yes</option><option>No</option>
                  </select>
                </div>
                <Text label="If yes, their ages" value={cqf.children_ages} onChange={v => upd(['children_ages'], v)} />
                <Text label="Coverage wanted" value={cqf.coverage_wanted} onChange={v => upd(['coverage_wanted'], v)} />
                <Text label="Monthly budget" value={cqf.monthly_budget} onChange={v => upd(['monthly_budget'], v)} />
                <Text label="Existing coverage" value={cqf.existing_coverage} onChange={v => upd(['existing_coverage'], v)} className="md:col-span-2" />
              </Two>
            </Section>

            <Section title="Carrier prep" hint="Who can write this client, and what you plan to present.">
              <div className="space-y-4">
                <Area label="Available carriers — who will take this client" value={prep.available} onChange={v => updPrep(['available'], v)} rows={2} placeholder="e.g. Mutual of Omaha (graded), Foresters, Americo — decline at Aetna for the stent" />
                <div>
                  <p className={LABEL}>Best choices to present</p>
                  <div className="space-y-2">
                    {prep.options.map((o, i) => (
                      <div key={i} className="grid grid-cols-1 sm:grid-cols-[2rem_1fr_1fr_1fr] gap-2 items-center">
                        <span className="hidden sm:flex w-8 h-8 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-white/10 dark:text-white font-bold">{i + 1}</span>
                        <input value={o.carrier ?? ''} onChange={e => updPrep(['options', i, 'carrier'], e.target.value)} placeholder="Carrier" className={INPUT} />
                        <input value={o.product ?? ''} onChange={e => updPrep(['options', i, 'product'], e.target.value)} placeholder="Product" className={INPUT} />
                        <input value={o.detail  ?? ''} onChange={e => updPrep(['options', i, 'detail'],  e.target.value)} placeholder="Coverage / premium" className={INPUT} />
                      </div>
                    ))}
                  </div>
                </div>
                <Area label="Notes" value={prep.notes} onChange={v => updPrep(['notes'], v)} rows={4} placeholder="Why these carriers, underwriting quirks, what to say if they push back…" />
              </div>
            </Section>

            <div className="h-10" />
          </div>
        </div>
      </div>
    </div>
    </PaneCtx.Provider>
  )
}
