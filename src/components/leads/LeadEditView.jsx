import { useCallback, useEffect, useRef, useState } from 'react'
import { LEAD_SECTIONS } from './leadFields'
import { typeCfg, getLeadTZ, hasValue } from './leadHelpers'
import { fmtDate, fmtPhoneInput, phoneDigits } from '../../utils/format'

// Edit lead data — a full screen for changing the lead's own data (name, contact, details,
// source, household), opened from the lead card the same way the CQF is. Each field saves as
// soon as it is left; there is no Save button. The work actions (call, text, status, notes,
// activity) stay on the lead card.

const INPUT = 'w-full text-base rounded-lg px-3 py-2.5 border bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-300 dark:border-white/15 placeholder-gray-400 dark:placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors'
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1'

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-primary/30 shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-gray-200 dark:border-white/10 border-l-4 border-l-accent bg-primary/5 dark:bg-white/5">
        <h3 className="text-lg font-extrabold text-primary dark:text-white">{title}</h3>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

// pane: render inside the docked lead pane (no fixed overlay, always one column).
// onPatch(key, value) saves one field and resolves true when it was stored.
export default function LeadEditView({ lead, onClose, onPatch, pane = false, sections = LEAD_SECTIONS, badge = null }) {
  const [form, setForm] = useState({})
  const [state, setState] = useState('idle') // idle | saving | saved | error

  // Start from the lead as it is whenever a different lead is opened
  useEffect(() => {
    const init = { name: lead.name ?? '' }
    for (const s of sections) for (const f of s.fields) {
      init[f.key] = f.kind === 'tel' ? fmtPhoneInput(lead[f.key]) : (lead[f.key] ?? '')
    }
    setForm(init)
    setState('idle')
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Latest in-flight save, so "Saved" never shows while an earlier one is still failing
  const inflight = useRef(0)
  const save = useCallback(async (key, value) => {
    const n = ++inflight.current
    setState('saving')
    let ok = false
    try { ok = (await onPatch(key, value)) !== false } catch { ok = false }
    if (n === inflight.current) setState(ok ? 'saved' : 'error')
  }, [onPatch])

  function commit(f) {
    let val = form[f.key]
    if (f.kind === 'tel') val = phoneDigits(val)
    val = (val === '' || val == null) ? null : val
    if (val !== null && f.kind === 'int') val = parseInt(val, 10) || null
    if (val !== null && f.kind === 'state') val = String(val).toUpperCase().slice(0, 2)
    const orig = hasValue(lead[f.key]) ? (f.kind === 'tel' ? phoneDigits(lead[f.key]) : lead[f.key]) : null
    if (orig !== val) save(f.key, val)
  }

  const badgeText = badge ?? typeCfg(lead.lead_type).label
  const tz = getLeadTZ(lead.state)
  const cols = pane ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
  const span = f => (f.span === 2 && !pane ? 'sm:col-span-2' : '')
  const status = { saving: 'Saving…', saved: '✓ Saved', error: '⚠ Couldn’t save', idle: 'Changes save as you go' }[state]

  return (
    <div className={pane
      ? 'flex-1 min-h-0 flex flex-col bg-gray-50 dark:bg-secondary'
      : 'fixed top-[var(--header-h)] right-0 bottom-0 left-0 lg:left-[var(--nav-w,4rem)] xl:left-[var(--nav-w,14rem)] z-40 flex flex-col bg-gray-50 dark:bg-secondary !mt-0'}>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-primary/30 shrink-0">
        <button onClick={onClose} className="text-base font-semibold px-4 py-2 min-h-11 rounded-lg border border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10 transition-colors">← Back to lead</button>
        <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-white/60">Edit lead data</p>
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white truncate">
            {lead.name} <span className="ml-1 align-middle text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary dark:bg-white/10 dark:text-white/80">{badgeText}</span>
            {tz && <span className={`ml-3 text-sm font-semibold ${tz.goodTime ? 'text-gray-700 dark:text-white/80' : 'text-red-600 dark:text-red-300'}`}>{tz.label} {tz.timeStr}</span>}
          </h2>
        </div>
        <span className={`max-sm:ml-auto text-sm font-medium ${state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-white/50'}`} aria-live="polite">{status}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="max-w-5xl mx-auto space-y-5">

          <Section title="Name">
            <input
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              onBlur={() => { const v = (form.name ?? '').trim(); if (v && v !== lead.name) save('name', v); else if (!v) set('name', lead.name ?? '') }}
              className={INPUT + ' text-lg font-semibold'}
              aria-label="Lead name"
            />
          </Section>

          {sections.map(sec => (
            <Section key={sec.key} title={sec.title}>
              <div className={`grid ${cols} gap-x-4 gap-y-4`}>
                {sec.fields.map(f => (
                  <div key={f.key} className={span(f)}>
                    <label className={LABEL}>{f.label}</label>
                    {f.readOnly ? (
                      <p className="text-base font-medium text-gray-900 dark:text-white py-2.5">{hasValue(lead[f.key]) ? (f.kind === 'date' ? fmtDate(lead[f.key]) : String(lead[f.key])) : '—'}</p>
                    ) : f.kind === 'select' ? (
                      <select value={form[f.key] ?? ''} className={INPUT + ' cursor-pointer'}
                        onChange={e => { set(f.key, e.target.value); save(f.key, e.target.value || null) }}>
                        <option value="">—</option>
                        {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        {hasValue(form[f.key]) && !f.options.some(o => o.value === form[f.key]) && <option value={form[f.key]}>{String(form[f.key])}</option>}
                      </select>
                    ) : (
                      <input
                        type={f.kind === 'date' ? 'date' : f.kind === 'int' ? 'number' : f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text'}
                        inputMode={f.kind === 'tel' ? 'tel' : f.kind === 'int' ? 'numeric' : undefined}
                        autoComplete="off"
                        value={form[f.key] ?? ''} placeholder={f.kind === 'tel' ? '555-555-5555' : '—'}
                        maxLength={f.kind === 'state' ? 2 : f.kind === 'tel' ? 12 : undefined}
                        onChange={e => set(f.key, f.kind === 'state' ? e.target.value.toUpperCase() : f.kind === 'tel' ? fmtPhoneInput(e.target.value) : e.target.value)}
                        onBlur={() => commit(f)}
                        className={INPUT + (f.kind === 'date' ? ' dark:[color-scheme:dark]' : '')}
                      />
                    )}
                  </div>
                ))}
              </div>
              {(sec.flags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-5 mt-5">
                  {sec.flags.map(fl => (
                    <label key={fl.key} className="flex items-center gap-2 cursor-pointer select-none min-h-11">
                      <input type="checkbox" checked={!!lead[fl.key]} onChange={e => save(fl.key, e.target.checked)} className="w-5 h-5 rounded accent-accent" />
                      <span className="text-base text-gray-800 dark:text-white/85">{fl.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </Section>
          ))}

          <div className="pt-1 pb-6">
            <button onClick={onClose} className="w-full sm:w-auto text-lg font-bold px-8 py-3 min-h-12 rounded-xl border border-accent bg-primary text-white dark:bg-white dark:text-primary hover:bg-primary/85 dark:hover:bg-white/90 transition-colors">Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}
